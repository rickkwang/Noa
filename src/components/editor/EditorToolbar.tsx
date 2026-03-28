import React from 'react';
import { Bold, Italic, List, CheckSquare, Code, AlignLeft } from 'lucide-react';

interface EditorToolbarProps {
  onInsertFormatting: (before: string, after?: string) => void;
  hasToc: boolean;
  isTocOpen: boolean;
  onToggleToc: () => void;
}

export function EditorToolbar({
  onInsertFormatting,
  hasToc,
  isTocOpen,
  onToggleToc,
}: EditorToolbarProps) {
  return (
    <div className="h-8 border-b border-[#2D2D2D] flex items-center px-4 shrink-0 bg-[#EAE8E0] z-10 font-redaction space-x-2 text-[#2D2D2D]/70 relative overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      <button
        onClick={() => onInsertFormatting('**', '**')}
        className="p-1 hover:text-[#B89B5E] hover:bg-[#DCD9CE]/50 active:opacity-70 transition-colors shrink-0"
        title="Bold"
      >
        <Bold size={14} />
      </button>
      <button
        onClick={() => onInsertFormatting('*', '*')}
        className="p-1 hover:text-[#B89B5E] hover:bg-[#DCD9CE]/50 active:opacity-70 transition-colors shrink-0"
        title="Italic"
      >
        <Italic size={14} />
      </button>
      <div className="w-px h-4 bg-[#2D2D2D]/20 mx-1 shrink-0" />
      <button
        onClick={() => onInsertFormatting('- ')}
        className="p-1 hover:text-[#B89B5E] hover:bg-[#DCD9CE]/50 active:opacity-70 transition-colors shrink-0"
        title="List"
      >
        <List size={14} />
      </button>
      <button
        onClick={() => onInsertFormatting('- [ ] ')}
        className="p-1 hover:text-[#B89B5E] hover:bg-[#DCD9CE]/50 active:opacity-70 transition-colors shrink-0"
        title="Task List"
      >
        <CheckSquare size={14} />
      </button>
      <div className="w-px h-4 bg-[#2D2D2D]/20 mx-1 shrink-0" />
      <button
        onClick={() => onInsertFormatting('`', '`')}
        className="p-1 hover:text-[#B89B5E] hover:bg-[#DCD9CE]/50 active:opacity-70 transition-colors shrink-0"
        title="Inline Code"
      >
        <Code size={14} />
      </button>
      <button
        onClick={() => onInsertFormatting('\n```\n', '\n```\n')}
        className="p-1 hover:text-[#B89B5E] hover:bg-[#DCD9CE]/50 active:opacity-70 transition-colors text-xs font-bold shrink-0"
        title="Code Block"
      >
        {'</>'}
      </button>
      {hasToc && (
        <>
          <div className="w-px h-4 bg-[#2D2D2D]/20 mx-1 shrink-0" />
          <button
            onClick={onToggleToc}
            className={`p-1 hover:text-[#B89B5E] hover:bg-[#DCD9CE]/50 active:opacity-70 transition-colors shrink-0 ${isTocOpen ? 'text-[#B89B5E]' : ''}`}
            title="Outline"
          >
            <AlignLeft size={14} />
          </button>
        </>
      )}
    </div>
  );
}
