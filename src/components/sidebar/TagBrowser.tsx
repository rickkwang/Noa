import React, { useMemo, useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Hash } from 'lucide-react';
import { Note } from '../../types';
import { useResizeDrag } from '../../hooks/useResizeDrag';

interface TagNode {
  name: string;
  fullPath: string;
  count: number;
  children: Map<string, TagNode>;
}

interface TagBrowserProps {
  notes: Note[];
  onSearchTag?: (tag: string) => void;
}

export function TagBrowser({ notes, onSearchTag }: TagBrowserProps) {
  const [isTagsOpen, setIsTagsOpen] = useState(false);
  const { size: tagsHeight, setIsDragging } = useResizeDrag(
    250, 100, 600,
    (e: MouseEvent) => Math.min(window.innerHeight * 0.8, window.innerHeight - e.clientY),
    'row-resize'
  );

  const tagTree = useMemo(() => {
    const roots = new Map<string, TagNode>();

    const getOrCreate = (map: Map<string, TagNode>, name: string, fullPath: string): TagNode => {
      if (!map.has(name)) map.set(name, { name, fullPath, count: 0, children: new Map() });
      return map.get(name)!;
    };

    notes.forEach(note => {
      note.tags?.forEach(tag => {
        const parts = tag.split('/');
        let currentMap = roots;
        let path = '';
        parts.forEach((part, i) => {
          path = path ? `${path}/${part}` : part;
          const node = getOrCreate(currentMap, part, path);
          if (i === parts.length - 1) node.count += 1;
          currentMap = node.children;
        });
      });
    });

    const propagate = (node: TagNode): number => {
      let total = node.count;
      node.children.forEach(child => { total += propagate(child); });
      node.count = total;
      return total;
    };
    roots.forEach(propagate);

    return roots;
  }, [notes]);

  const [expandedTagNodes, setExpandedTagNodes] = useState<Set<string>>(new Set());

  const toggleTagNode = useCallback((fullPath: string) => {
    setExpandedTagNodes(prev => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
  }, []);

  const renderTagNode = (node: TagNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.size > 0;
    const isExpanded = expandedTagNodes.has(node.fullPath);
    return (
      <div key={node.fullPath}>
        <div
          className="flex items-center gap-1 px-1 py-0.5 hover:bg-[#DCD9CE]/50 group"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {hasChildren ? (
            <button
              onClick={() => toggleTagNode(node.fullPath)}
              className="shrink-0 text-[#2D2D2D]/40 hover:text-[#2D2D2D] active:opacity-70"
            >
              {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          ) : (
            <span className="w-[10px] shrink-0" />
          )}
          <button
            onClick={() => onSearchTag && onSearchTag(node.fullPath)}
            className="flex-1 text-left text-xs font-redaction text-[#2D2D2D] hover:text-[#B89B5E] active:opacity-70 truncate flex items-center gap-0.5"
          >
            <span className="opacity-40">#</span>{node.name}
          </button>
          <span className="text-[10px] text-[#2D2D2D]/40 shrink-0">{node.count}</span>
        </div>
        {hasChildren && isExpanded && (
          <div>
            {Array.from(node.children.values()).map(child => renderTagNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="flex shrink-0 border-t border-[#2D2D2D] relative flex-col bg-[#DCD9CE]/30"
      style={{ height: isTagsOpen ? tagsHeight : 'auto' }}
    >
      {isTagsOpen && (
        <div
          className="h-3 w-full bg-transparent hover:bg-[#B89B5E]/20 cursor-row-resize absolute top-0 left-0 right-0 z-20 -translate-y-1/2 transition-colors"
          onMouseDown={() => setIsDragging(true)}
        />
      )}
      <button
        className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest text-[#2D2D2D]/40 hover:text-[#2D2D2D]/70 border-b border-[#2D2D2D]/20 flex items-center shrink-0 transition-colors cursor-pointer"
        onClick={() => setIsTagsOpen(v => !v)}
      >
        <Hash size={12} className="mr-1 shrink-0" />
        Tags Explorer
        <ChevronDown size={11} className={`ml-auto transition-transform duration-200 ${isTagsOpen ? '' : '-rotate-90'}`} />
      </button>
      {isTagsOpen && (
        <div className="flex-1 overflow-y-auto p-2">
          {tagTree.size === 0 ? (
            <div className="text-xs text-[#2D2D2D]/50 p-1 font-redaction">No tags found in notes</div>
          ) : (
            Array.from(tagTree.values()).map(node => renderTagNode(node, 0))
          )}
        </div>
      )}
    </div>
  );
}
