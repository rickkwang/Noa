import { useNoteProperties } from '../../hooks/useNoteProperties';
import { Note } from '../../types';
import { PropertiesBlock } from '../editor/PropertiesBlock';

interface PropertiesPanelProps {
  activeNote?: Note;
  notes: Note[];
  onUpdateNote?: (content: string) => void;
  onFrontmatterChange?: (rawFrontmatter: string | undefined) => void;
  /** Editor font size, so properties read at the same size here as under the note title. */
  fontSize?: number;
}

// Same editor as the one under the note title, so both stay in sync and write through the same paths.
export function PropertiesPanel({ activeNote, notes, onUpdateNote, onFrontmatterChange, fontSize }: PropertiesPanelProps) {
  const { frontmatter, onChange, canWrite, getSuggestions } = useNoteProperties(activeNote, notes, {
    onUpdate: onUpdateNote,
    onFrontmatterChange,
  });

  if (!activeNote || !frontmatter) {
    return (
      <div className="flex-1 overflow-y-auto noa-panel-scroll px-3 pb-3 pt-2">
        <div className="noa-hint-in text-xs font-ui text-center py-8 text-[var(--sidebar-text-muted,#898781)]">No note selected</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto noa-panel-scroll noa-edge-fade-y px-3 pb-3 pt-2" style={fontSize ? { fontSize: `${fontSize}px` } : undefined}>
      <PropertiesBlock compact block={frontmatter.block} readOnly={!canWrite} onChange={onChange} getSuggestions={getSuggestions} />
    </div>
  );
}
