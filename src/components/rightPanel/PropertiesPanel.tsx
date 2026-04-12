import React, { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Note } from '../../types';
import { parseFrontmatter, parseFrontmatterBlock, stringifyFrontmatter, hasFrontmatter } from '../../lib/frontmatter';

interface PropertiesPanelProps {
  activeNote?: Note;
  onUpdateNote?: (content: string) => void;
  isDark?: boolean;
}

const isObsidian = (note?: Note) => (note?.source ?? 'noa') === 'obsidian-import';

export function PropertiesPanel({ activeNote, onUpdateNote, isDark = false }: PropertiesPanelProps) {
  const [editedMeta, setEditedMeta] = useState<Record<string, string>>({});
  const editedMetaRef = useRef(editedMeta);
  const propBodyRef = useRef('');
  const [propBody, setPropBody] = useState('');
  const [newPropKey, setNewPropKey] = useState('');
  const [newPropValue, setNewPropValue] = useState('');
  const [addingProp, setAddingProp] = useState(false);

  const noteHasContentFrontmatter = activeNote ? hasFrontmatter(activeNote.content) : false;
  const noteHasRawFrontmatter = Boolean(activeNote?.rawFrontmatter?.trim());
  const noteHasFrontmatter = noteHasContentFrontmatter || noteHasRawFrontmatter;
  // Obsidian-imported notes are always read-only in the properties panel —
  // their frontmatter is owned by the vault file, not by Noa.
  const isReadOnlyFrontmatter = (activeNote?.source === 'obsidian-import') || (!noteHasContentFrontmatter && noteHasRawFrontmatter);

  const txtMuted = isDark ? 'text-[rgba(240,237,230,0.4)]' : 'text-[#2D2D2D]/50';
  const labelColor = isDark ? 'text-[rgba(240,237,230,0.3)]' : 'text-[#2D2D2D]/30';
  const keyColor = isDark ? 'text-[rgba(240,237,230,0.4)]' : 'text-[#2D2D2D]/40';
  const inputBg = isDark ? 'bg-[#2C2C28]' : 'bg-[#DCD9CE]/50';
  const inputBorder = isDark ? 'border-[rgba(240,237,230,0.15)]' : 'border-[#2D2D2D]/20';
  const deleteBtn = isDark ? 'text-[rgba(240,237,230,0.3)] hover:text-red-400' : 'text-[#2D2D2D]/30 hover:text-red-500';

  useEffect(() => {
    let meta: Record<string, string> = {};
    let body = '';
    if (activeNote && noteHasContentFrontmatter) {
      ({ meta, body } = parseFrontmatter(activeNote.content));
    } else if (activeNote?.rawFrontmatter) {
      meta = parseFrontmatterBlock(activeNote.rawFrontmatter);
      body = activeNote.content;
    }
    setEditedMeta(meta);
    setPropBody(body);
    editedMetaRef.current = meta;
    propBodyRef.current = body;
    setAddingProp(false);
  }, [activeNote?.id, activeNote?.content, activeNote?.rawFrontmatter, noteHasContentFrontmatter]);

  // Keep refs in sync so onBlur always reads the latest values
  useEffect(() => { editedMetaRef.current = editedMeta; }, [editedMeta]);
  useEffect(() => { propBodyRef.current = propBody; }, [propBody]);

  if (!activeNote) {
    return (
      <div className="flex-1 overflow-y-auto p-3">
        <div className={`text-xs font-redaction text-center py-8 ${txtMuted}`}>No note selected</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <div className="space-y-1">

        {/* Editable frontmatter from note content (raw --- block) */}
        {/* Noa notes: always visible so user can add properties; Obsidian: only when frontmatter exists */}
        {(noteHasFrontmatter || !isObsidian(activeNote)) && (
          <>
            <div className={`text-[10px] uppercase tracking-widest font-redaction pt-3 pb-1 ${labelColor}`}>
              {isObsidian(activeNote) ? 'Properties' : 'Frontmatter'}
            </div>
            {Object.entries(editedMeta).filter(([key]) => {
              // Obsidian: hide Noa-internal fields (id, linkRefs, createdAt); show everything else
              if (isObsidian(activeNote)) return !['id', 'linkRefs', 'createdAt'].includes(key);
              return true;
            }).map(([key, value]) => {
              const isTagField = key === 'tags';
              const tagList = isTagField ? value.split(',').map(t => t.trim()).filter(Boolean) : [];
              return (
              <div key={key} className={`flex gap-2 py-0.5 ${isTagField ? 'items-start' : 'items-center'}`}>
                <div className={`text-[10px] uppercase tracking-wider font-redaction w-20 shrink-0 truncate pt-0.5 ${keyColor}`} title={key}>{key}</div>
                {isTagField ? (
                  tagList.length > 0 ? (
                    <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                      {tagList.map(tag => (
                        <span key={tag} className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-redaction font-bold border border-[#B89B5E]/40 text-[#B89B5E] bg-[#B89B5E]/10 leading-none">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  ) : <span className="text-xs font-redaction opacity-30">—</span>
                ) : isReadOnlyFrontmatter ? (
                  <div className={`flex-1 text-xs font-redaction break-all min-w-0 ${isDark ? 'text-[rgba(240,237,230,0.6)]' : 'text-[#2D2D2D]/70'}`}>
                    {value || <span className="opacity-30">—</span>}
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => setEditedMeta(prev => ({ ...prev, [key]: e.target.value }))}
                      onBlur={() => { if (onUpdateNote) onUpdateNote(stringifyFrontmatter(editedMetaRef.current, propBodyRef.current)); }}
                      className={`flex-1 ${inputBg} border ${inputBorder} px-2 py-1 text-xs font-redaction outline-none focus:border-[#B89B5E] min-w-0 ${isDark ? 'text-[#F0EDE6]' : 'text-[#2D2D2D]'}`}
                    />
                    <button
                      onClick={() => {
                        const next = { ...editedMetaRef.current };
                        delete next[key];
                        setEditedMeta(next);
                        if (onUpdateNote) onUpdateNote(stringifyFrontmatter(next, propBodyRef.current));
                      }}
                      className={`${deleteBtn} active:opacity-70 shrink-0`}
                    >
                      <X size={12} />
                    </button>
                  </>
                )}
              </div>
              );
            })}
            {!isReadOnlyFrontmatter && addingProp ? (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text" placeholder="key" value={newPropKey}
                  onChange={(e) => setNewPropKey(e.target.value)}
                  className={`w-20 shrink-0 ${inputBg} border border-[#B89B5E]/50 px-2 py-1 text-xs font-redaction outline-none focus:border-[#B89B5E] ${isDark ? 'text-[#F0EDE6]' : 'text-[#2D2D2D]'}`}
                  autoFocus
                />
                <input
                  type="text" placeholder="value" value={newPropValue}
                  onChange={(e) => setNewPropValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newPropKey.trim()) {
                      const next = { ...editedMetaRef.current, [newPropKey.trim()]: newPropValue };
                      setEditedMeta(next);
                      if (onUpdateNote) onUpdateNote(stringifyFrontmatter(next, propBodyRef.current));
                      setNewPropKey(''); setNewPropValue(''); setAddingProp(false);
                    }
                    if (e.key === 'Escape') { setAddingProp(false); setNewPropKey(''); setNewPropValue(''); }
                  }}
                  className={`flex-1 ${inputBg} border border-[#B89B5E]/50 px-2 py-1 text-xs font-redaction outline-none focus:border-[#B89B5E] min-w-0 ${isDark ? 'text-[#F0EDE6]' : 'text-[#2D2D2D]'}`}
                />
                <button onClick={() => { setAddingProp(false); setNewPropKey(''); setNewPropValue(''); }}
                  className={`${isDark ? 'text-[rgba(240,237,230,0.3)] hover:text-[rgba(240,237,230,0.7)]' : 'text-[#2D2D2D]/30 hover:text-[#2D2D2D]'} active:opacity-70 shrink-0`}>
                  <X size={12} />
                </button>
              </div>
            ) : !isReadOnlyFrontmatter ? (
              <button onClick={() => setAddingProp(true)}
                className={`flex items-center gap-1 text-xs active:opacity-70 pt-1 ${isDark ? 'text-[rgba(240,237,230,0.4)] hover:text-[rgba(240,237,230,0.8)]' : 'text-[#2D2D2D]/40 hover:text-[#2D2D2D]'}`}>
                <Plus size={12} /><span className="font-redaction">Add property</span>
              </button>
            ) : null}
          </>
        )}
        {isObsidian(activeNote) && !noteHasFrontmatter && (
          <div className={`text-xs font-redaction py-2 ${isDark ? 'text-[rgba(240,237,230,0.35)]' : 'text-[#2D2D2D]/45'}`}>
            This note has no frontmatter properties.
          </div>
        )}
      </div>
    </div>
  );
}
