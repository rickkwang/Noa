import React from 'react';
import { useNoteProperties } from '../../hooks/useNoteProperties';
import { Note } from '../../types';
import { PropertiesBlock } from '../editor/PropertiesBlock';

interface PropertiesPanelProps {
  activeNote?: Note;
  notes: Note[];
  onUpdateNote?: (content: string) => void;
  onFrontmatterChange?: (rawFrontmatter: string | undefined) => void;
  isDark?: boolean;
  /** Editor font size, so properties read at the same size here as under the note title. */
  fontSize?: number;
}

// Same editor as the one under the note title, so both stay in sync and write through the same paths.
export function PropertiesPanel({ activeNote, notes, onUpdateNote, onFrontmatterChange, isDark = false, fontSize }: PropertiesPanelProps) {
  const { frontmatter, onChange, canWrite, getSuggestions } = useNoteProperties(activeNote, notes, {
    onUpdate: onUpdateNote,
    onFrontmatterChange,
  });

  if (!activeNote || !frontmatter) {
    return (
      <div className="flex-1 overflow-y-auto noa-panel-scroll px-3 pb-3 pt-2">
        <div className={`text-xs font-redaction text-center py-8 ${isDark ? 'text-[rgba(249,249,247,0.4)]' : 'text-[#2D2D2B]/50'}`}>No note selected</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto noa-panel-scroll px-3 pb-3 pt-2" style={fontSize ? { fontSize: `${fontSize}px` } : undefined}>
      <PropertiesBlock compact block={frontmatter.block} readOnly={!canWrite} onChange={onChange} getSuggestions={getSuggestions} />
    </div>
  );
}
