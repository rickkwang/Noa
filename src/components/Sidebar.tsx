import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useResizeDrag } from '../hooks/useResizeDrag';
import { ChevronRight, ChevronDown, FileText, Plus, Trash2, Folder, Settings, Calendar, AlertCircle, ArrowUpRight, CheckSquare, Hash, X } from 'lucide-react';
import { Note, Folder as FolderType } from '../types';
import { SearchEngine, SearchResult } from '../core/search';
import { builtinTemplates, applyTemplate } from '../lib/templates';
import DOMPurify from 'dompurify';
import CalendarPanel from './CalendarPanel';

interface FileNodeProps {
  name: string;
  isFolder?: boolean;
  children?: React.ReactNode;
  defaultOpen?: boolean;
  isActive?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  icon?: React.ElementType;
  iconColor?: string;
  onAdd?: () => void;
  addButtonProps?: Record<string, unknown>;
  depth?: number;
}

const FileNode = ({ name, isFolder, children, defaultOpen = false, isActive, onClick, onDelete, onRename, icon: Icon = FileText, iconColor, onAdd, addButtonProps = {}, depth = 0 }: FileNodeProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(name.replace('.md', ''));

  useEffect(() => {
    setIsOpen(defaultOpen);
  }, [defaultOpen]);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRename) {
      setIsEditing(true);
      setEditName(name.replace('.md', ''));
    }
  };

  const handleRenameSubmit = () => {
    setIsEditing(false);
    if (editName.trim() && editName !== name.replace('.md', '')) {
      onRename(editName.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditName(name.replace('.md', ''));
    }
  };

  return (
    <div className="font-redaction">
      <div 
        className={`flex items-center justify-between py-1 px-2 cursor-pointer select-none group ${isActive ? 'bg-[#EAE8E0]' : 'hover:bg-[#DCD9CE]/50'}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          if (isFolder) setIsOpen(!isOpen);
          if (onClick) onClick();
        }}
        onDoubleClick={handleDoubleClick}
      >
        <div className="flex items-center overflow-hidden flex-1">
          <span className="w-4 flex justify-center mr-1 shrink-0 text-[#2D2D2D]/50">
            {isFolder ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
          </span>
          <span className={`mr-2 shrink-0 ${isFolder ? 'text-[#B89B5E]' : (isActive ? 'text-[#B89B5E]' : (iconColor ? '' : 'text-[#2D2D2D]'))}`} style={iconColor && !isActive ? { color: iconColor } : {}}>
            <Icon size={14} fill={isFolder ? "currentColor" : "none"} />
          </span>
          {isEditing ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleKeyDown}
              className="bg-transparent border-b border-[#2D2D2D] outline-none w-full text-[#2D2D2D] font-redaction"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span 
              className={`truncate ${isActive ? 'font-bold' : ''}`}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(name) }}
            />
          )}
        </div>
        <div className="flex items-center opacity-0 group-hover:opacity-100 shrink-0 ml-2">
          {isFolder && onAdd && (
            <button
              {...addButtonProps}
              onClick={(e) => { e.stopPropagation(); onAdd(); }}
              className="hover:text-[#B89B5E] p-1"
              title="Add"
            >
              <Plus size={14} />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="hover:text-red-500 p-1"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      {isFolder && isOpen && children && (
        <div>
          {children}
        </div>
      )}
    </div>
  );
};

interface SidebarProps {
  notes: Note[];
  folders: FolderType[];
  searchQuery: string;
  activeNoteId: string;
  recentNoteIds?: string[];
  onSelectNote: (id: string) => void;
  onCreateNote: (folderId: string, initialContent?: string) => void;
  onDeleteNote: (id: string) => void;
  onRenameNote: (id: string, newName: string) => void;
  onCreateFolder: () => void;
  onRenameFolder: (id: string, newName: string) => void;
  onDeleteFolder: (id: string) => void;
  onUpdateNoteContent?: (id: string, content: string) => void;
  onOpenDailyNote?: (targetDate?: string) => void;
  onImportNote?: (title: string, content: string, folderId?: string) => void;
  onSearchTag?: (tag: string) => void;
  caseSensitive?: boolean;
  fuzzySearch?: boolean;
  dateFormat?: string;
}

export default function Sidebar({
  notes, folders, searchQuery, activeNoteId, recentNoteIds = [],
  onSelectNote, onCreateNote, onDeleteNote, onRenameNote,
  onCreateFolder, onRenameFolder, onDeleteFolder,
  onUpdateNoteContent, onOpenDailyNote,
  onImportNote, onSearchTag, caseSensitive = false, fuzzySearch = true, dateFormat = 'YYYY-MM-DD',
}: SidebarProps) {

  const [pendingDelete, setPendingDelete] = useState<{ type: 'note' | 'folder'; id: string; name: string } | null>(null);
  const [isRecentOpen, setIsRecentOpen] = useState(true);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const searchEngineRef = useRef<SearchEngine | null>(null);
  const [templateMenuFolderId, setTemplateMenuFolderId] = useState<string | null>(null);

  useEffect(() => {
    if (!templateMenuFolderId) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest('[data-template-menu]') && !target.closest('[data-template-btn]')) {
        setTemplateMenuFolderId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [templateMenuFolderId]);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rebuild index when notes/settings change (debounced)
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      if (!searchEngineRef.current) {
        searchEngineRef.current = new SearchEngine(notes, caseSensitive, fuzzySearch);
      } else {
        searchEngineRef.current.updateNotes(notes, caseSensitive, fuzzySearch);
      }
      if (searchQuery) {
        setSearchResults(searchEngineRef.current.search(searchQuery, caseSensitive));
      }
    }, 500);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [notes, caseSensitive, fuzzySearch]);

  // Execute search immediately when query changes
  useEffect(() => {
    if (!searchEngineRef.current) return;
    setSearchResults(searchEngineRef.current.search(searchQuery, caseSensitive));
  }, [searchQuery, caseSensitive]);

  const [isDragOver, setIsDragOver] = useState(false);
  const { size: tagsHeight, setIsDragging } = useResizeDrag(
    250, 100, window.innerHeight * 0.8,
    (e: MouseEvent) => window.innerHeight - e.clientY,
    'row-resize'
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (!onImportNote) return;

    const files = Array.from(e.dataTransfer.files).filter(
      file => file.name.endsWith('.md') || file.name.endsWith('.txt')
    );

    let failCount = 0;
    for (const file of files) {
      try {
        const text = await file.text();
        const title = file.name.replace(/\.(md|txt)$/i, '');
        const folderId = folders.length > 0 ? folders[0].id : 'diary';
        onImportNote(title, text, folderId);
      } catch {
        failCount++;
      }
    }
    if (failCount > 0) {
      console.warn(`[Noa] ${failCount} file(s) failed to import via drag-and-drop`);
    }
  };

  const allTags = useMemo(() => {
    const tagCounts: Record<string, number> = {};
    notes.forEach(note => {
      note.tags?.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });
    return Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
  }, [notes]);

  return (
    <div 
      className="w-full h-full border-r border-[#2D2D2D] flex flex-col bg-[#EAE8E0] shrink-0 relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 bg-[#B89B5E]/10 border-2 border-dashed border-[#B89B5E] z-50 flex items-center justify-center pointer-events-none">
          <div className="bg-[#EAE8E0] px-4 py-2 border border-[#B89B5E] shadow-lg font-redaction font-bold text-[#B89B5E] flex items-center">
            <Plus size={16} className="mr-2" />
            Drop markdown files to import
          </div>
        </div>
      )}
      {pendingDelete && (
        <div className="border-b-2 border-[#B89B5E] bg-[#B89B5E]/10 px-3 py-2 flex flex-col gap-1.5 font-redaction shrink-0 z-10">
          <p className="text-xs text-[#2D2D2D]">
            Delete "<span className="font-bold">{pendingDelete.name}</span>"?{' '}
            {pendingDelete.type === 'folder'
              ? (() => {
                  const count = notes.filter(n => n.folder === pendingDelete.id).length;
                  return count > 0
                    ? `This folder contains ${count} note${count !== 1 ? 's' : ''}. All notes will be permanently deleted.`
                    : 'This cannot be undone.';
                })()
              : 'This cannot be undone.'}
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={() => { pendingDelete.type === 'note' ? onDeleteNote(pendingDelete.id) : onDeleteFolder(pendingDelete.id); setPendingDelete(null); }}
              className="px-2 py-0.5 text-xs font-bold bg-red-500 text-white border border-[#2D2D2D] hover:opacity-90"
            >
              Delete
            </button>
            <button
              onClick={() => setPendingDelete(null)}
              className="px-2 py-0.5 text-xs font-bold bg-[#EAE8E0] border border-[#2D2D2D] hover:bg-[#DCD9CE]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="h-8 border-b border-[#2D2D2D] flex items-center px-2 justify-between shrink-0 bg-[#DCD9CE] z-10 font-redaction overflow-hidden">
        <div className="flex space-x-1 min-w-0 shrink">
          <span className="px-2 py-1 text-xs font-bold uppercase tracking-wider bg-[#2D2D2D] text-[#EAE8E0] truncate">
            Files
          </span>
        </div>
        <div className="flex space-x-1 shrink-0">
          <button
            onClick={() => onOpenDailyNote?.()}
            className="p-1 text-[#2D2D2D]/70 hover:text-[#B89B5E] transition-colors"
            title="Open today's daily note"
          >
            <Calendar size={14} />
          </button>
        </div>
      </div>
      
      {/* Main Content Section */}
      <div className="flex-1 overflow-y-auto">
        <div className="py-2">
          {searchQuery ? (
              <div className="px-2">
                <div className="text-xs text-[#2D2D2D]/50 mb-2 px-2 font-redaction uppercase tracking-wider">
                  Search Results ({searchResults.length})
                </div>
                {searchResults.map(result => (
                  <div 
                    key={result.note.id}
                    className={`p-2 mb-1 cursor-pointer border ${activeNoteId === result.note.id ? 'bg-[#DCD9CE] border-[#B89B5E]' : 'border-transparent hover:bg-[#DCD9CE]/50'} transition-colors`}
                    onClick={() => onSelectNote(result.note.id)}
                  >
                    <div className="font-bold font-redaction text-sm text-[#2D2D2D] mb-1 flex items-center">
                      <FileText size={12} className="mr-1.5 text-[#B89B5E] shrink-0" />
                      <span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(result.titleSnippet) || 'Untitled' }} className="truncate" />
                    </div>
                    <div 
                      className="text-xs text-[#2D2D2D]/70 font-redaction leading-relaxed break-words line-clamp-2"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(result.contentSnippet) }}
                    />
                    {result.note.tags && result.note.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {result.note.tags.map(tag => (
                          <span key={tag} className="text-[10px] font-redaction text-[#B89B5E] bg-[#B89B5E]/10 px-1">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {searchResults.length === 0 && (
                  <div className="text-[#2D2D2D]/50 px-2 py-4 font-redaction text-sm text-center">
                    No matches found
                  </div>
                )}
              </div>
            ) : (
              <>
              {recentNoteIds.length > 0 && (
                <div className="border-b border-[#2D2D2D]/20 mb-1">
                  <button
                    className="w-full flex items-center px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-[#2D2D2D]/60 hover:text-[#2D2D2D] transition-colors"
                    onClick={() => setIsRecentOpen(v => !v)}
                  >
                    {isRecentOpen ? <ChevronDown size={12} className="mr-1.5 shrink-0" /> : <ChevronRight size={12} className="mr-1.5 shrink-0" />}
                    Recent Notes
                  </button>
                  {isRecentOpen && (
                    <div className="pb-1">
                      {recentNoteIds.slice(0, 5).map(id => {
                        const note = notes.find(n => n.id === id);
                        if (!note) return null;
                        return (
                          <div
                            key={id}
                            className={`flex items-center px-3 py-1 cursor-pointer text-sm truncate ${activeNoteId === id ? 'bg-[#EAE8E0] font-bold text-[#B89B5E]' : 'hover:bg-[#DCD9CE]/50 text-[#2D2D2D]'}`}
                            onClick={() => onSelectNote(id)}
                          >
                            <FileText size={13} className={`mr-2 shrink-0 ${activeNoteId === id ? 'text-[#B89B5E]' : 'text-[#2D2D2D]/50'}`} />
                            <span className="truncate font-redaction">{note.title || 'Untitled'}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              <FileNode
                name="workspace"
                isFolder
                defaultOpen
                icon={Folder}
                onAdd={onCreateFolder}
                depth={0}
              >
                {folders.map(folder => {
                  const folderNotes = notes.filter(n => n.folder === folder.id);
                  
                  return (
                    <div key={folder.id} className="relative">
                    {templateMenuFolderId === folder.id && (
                      <div
                        data-template-menu
                        className="absolute right-0 top-7 z-50 bg-[#EAE8E0] border-2 border-[#2D2D2D] shadow-[4px_4px_0px_0px_rgba(0,0,0,0.15)] min-w-[160px]"
                      >
                        {builtinTemplates.map(t => (
                          <button
                            key={t.id}
                            className="w-full text-left px-3 py-1.5 text-sm font-redaction hover:bg-[#DCD9CE] text-[#2D2D2D]"
                            onClick={() => {
                              onCreateNote(folder.id, applyTemplate(t, 'New Note'));
                              setTemplateMenuFolderId(null);
                            }}
                          >
                            {t.name}
                          </button>
                        ))}
                      </div>
                    )}
                    <FileNode
                      name={folder.name}
                      isFolder
                      defaultOpen={false}
                      icon={Folder}
                      onAdd={() => setTemplateMenuFolderId(templateMenuFolderId === folder.id ? null : folder.id)}
                      addButtonProps={{ 'data-template-btn': folder.id }}
                      onRename={(newName: string) => onRenameFolder(folder.id, newName)}
                      onDelete={() => setPendingDelete({ type: 'folder', id: folder.id, name: folder.name })}
                      depth={1}
                    >
                      {folderNotes.length === 0 && <div className="text-[#2D2D2D]/50 px-6 py-1 font-redaction text-sm" style={{ paddingLeft: '44px' }}>Empty</div>}
                      {folderNotes.map(note => (
                        <FileNode
                          key={note.id}
                          name={(note.title || 'Untitled') + '.md'}
                          isActive={activeNoteId === note.id}
                          onClick={() => onSelectNote(note.id)}
                          onDelete={() => setPendingDelete({ type: 'note', id: note.id, name: note.title || 'Untitled' })}
                          onRename={(newName: string) => onRenameNote(note.id, newName)}
                          iconColor="#B89B5E"
                          depth={2}
                        />
                      ))}
                    </FileNode>
                    </div>
                  );
                })}
              </FileNode>
              </>
            )}
          </div>
        </div>

      {/* Calendar Panel */}
      {!searchQuery && (
        <CalendarPanel
          notes={notes}
          activeNoteId={activeNoteId}
          onSelectDate={(dateStr) => onOpenDailyNote?.(dateStr)}
          dateFormat={dateFormat}
        />
      )}

      {/* Tags Explorer Section replacing Activity Log */}
      <div
        className="flex shrink-0 border-t border-[#2D2D2D] relative flex-col bg-[#DCD9CE]/30"
        style={{ height: tagsHeight }}
      >
        <div 
          className="h-3 w-full bg-transparent hover:bg-[#B89B5E]/20 cursor-row-resize absolute top-0 left-0 right-0 z-50 -translate-y-1/2 transition-colors"
          onMouseDown={() => setIsDragging(true)}
        />
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-[#2D2D2D]/70 border-b border-[#2D2D2D]/20 flex items-center shrink-0">
          <Hash size={12} className="mr-1" />
          Tags Explorer
        </div>
        <div className="flex-1 overflow-y-auto p-3 flex flex-wrap gap-2 content-start">
          {allTags.length === 0 ? (
            <div className="text-xs text-[#2D2D2D]/50 p-1 font-redaction">No tags found in notes</div>
          ) : (
            allTags.map(([tag, count]) => (
              <button
                key={tag}
                onClick={() => onSearchTag && onSearchTag(tag)}
                className="text-xs font-redaction text-[#2D2D2D] bg-[#EAE8E0] border border-[#2D2D2D]/20 px-2 py-1 hover:border-[#B89B5E] hover:text-[#B89B5E] active:opacity-70 transition-colors flex items-center"
              >
                <span className="opacity-50 mr-0.5">#</span>
                {tag}
                <span className="ml-1.5 opacity-50 text-[10px] bg-[#2D2D2D]/5 px-1">{count}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
