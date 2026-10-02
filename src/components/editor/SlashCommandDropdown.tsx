import React, { useEffect, useRef, useState } from 'react';

interface SlashQuery {
  query: string;
  index: number;
  x: number;
  y: number;
}

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  insert: string; // text to insert; {cursor} marks cursor position
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: 'h1',     label: 'Heading 1',   description: 'Large section heading',  insert: '# '          },
  { id: 'h2',     label: 'Heading 2',   description: 'Medium section heading', insert: '## '         },
  { id: 'h3',     label: 'Heading 3',   description: 'Small section heading',  insert: '### '        },
  { id: 'bold',   label: 'Bold',        description: 'Bold text',              insert: '**{cursor}**' },
  { id: 'italic', label: 'Italic',      description: 'Italic text',            insert: '*{cursor}*'  },
  { id: 'quote',  label: 'Quote',       description: 'Blockquote',             insert: '> '          },
  { id: 'code',   label: 'Code block',  description: 'Fenced code block',      insert: '```\n{cursor}\n```' },
  { id: 'task',   label: 'Task',        description: 'Checkbox task item',     insert: '- [ ] '      },
  { id: 'link',    label: 'Link',    description: 'Hyperlink',         insert: '[{cursor}](url)' },
  { id: 'table',   label: 'Table',   description: '3×3 Markdown table', insert: '| {cursor}Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n' },
  { id: 'divider', label: 'Divider', description: 'Horizontal rule',    insert: '\n---\n' },
  { id: 'callout', label: 'Callout', description: 'Callout block',      insert: '> [!NOTE]\n> {cursor}' },
];

interface SlashCommandDropdownProps {
  slashQuery: SlashQuery;
  onInsert: (command: SlashCommand, index: number) => void;
  onDismiss: () => void;
}

export function SlashCommandDropdown({ slashQuery, onInsert, onDismiss }: SlashCommandDropdownProps) {
  const [visible, setVisible] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [slashQuery.index]);

  // Reset selection when query changes
  useEffect(() => { setSelectedIndex(0); }, [slashQuery.query]);

  const filtered = SLASH_COMMANDS.filter(
    cmd => cmd.id.includes(slashQuery.query) || cmd.label.toLowerCase().includes(slashQuery.query)
  );

  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  useEffect(() => {
    if (filtered.length === 0) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => (i + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onInsert(filtered[selectedIndex], slashQuery.index);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener('keydown', handleKey, { capture: true });
    return () => window.removeEventListener('keydown', handleKey, { capture: true });
  }, [filtered, selectedIndex, slashQuery.index, onInsert, onDismiss]);

  if (filtered.length === 0) return null;

  return (
    <div
      className={`absolute z-50 bg-[#F9F9F7] border border-[var(--divider-subtle)] rounded-[10px] p-1 noa-floating-panel font-redaction w-56 max-h-64 overflow-y-auto [scrollbar-gutter:stable] transition-opacity duration-100 ${visible ? 'opacity-100' : 'opacity-0'}`}
      style={{ top: slashQuery.y, left: slashQuery.x }}
    >
      <div className="flex h-6 items-center px-2 text-[11px] text-[#2D2D2B]/50">
        Insert block
      </div>
      {filtered.map((cmd, i) => (
        // The active row is the same quiet wash every popup menu uses, mixed
        // from the token so it follows the theme (see MentionDropdown).
        <div
          key={cmd.id}
          ref={i === selectedIndex ? selectedRef : undefined}
          className={`px-2 py-1.5 rounded-md cursor-pointer flex items-center gap-2 ${i === selectedIndex ? 'bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_8%,transparent)]' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onInsert(cmd, slashQuery.index);
          }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <div className="flex-1 min-w-0">
            <div className="text-[13px] text-[#2D2D2B]/90 truncate">{cmd.label}</div>
            <div className="text-[11px] truncate text-[#2D2D2B]/50">{cmd.description}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
