import type { Note } from '../types';

interface NavigationConflictDialogProps {
  title: string;
  noteIds: string[];
  notes: Note[];
  folderNameById: Map<string, string>;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function NavigationConflictDialog({
  title,
  noteIds,
  notes,
  folderNameById,
  onSelect,
  onClose,
}: NavigationConflictDialogProps) {
  return (
    <div className="fixed inset-0 z-[80] bg-black/30 flex items-center justify-center px-4" onClick={onClose}>
      <div className="w-full max-w-lg border border-[#2D2D2B] bg-[#F9F9F7] noa-floating-panel slide-down" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-[#2D2D2B] px-4 py-3 bg-[#EFEAE3]">
          <div className="text-xs uppercase tracking-wider text-[#2D2D2B]/60 font-bold">Duplicate Title</div>
          <div className="text-sm text-[#2D2D2B] mt-1">
            Multiple notes match "<span className="font-bold">{title}</span>". Select one:
          </div>
        </div>
        <div className="max-h-72 overflow-y-auto [scrollbar-gutter:stable] p-2 space-y-1">
          {noteIds.map((id) => {
            const note = notes.find((item) => item.id === id);
            if (!note) return null;
            return (
              <button
                key={id}
                onClick={() => onSelect(id)}
                className="w-full text-left border border-[#2D2D2B]/20 hover:border-[#2D2D2B]/50 px-3 py-2 bg-[#F9F9F7] hover:bg-[#EFEAE3]/40"
              >
                <div className="text-sm font-bold text-[#2D2D2B] truncate">{note.title}</div>
                <div className="text-xs text-[#2D2D2B]/60 mt-0.5">
                  {folderNameById.get(note.folder) ?? 'No Folder'} · Created {new Date(note.createdAt).toLocaleString()}
                </div>
              </button>
            );
          })}
        </div>
        <div className="border-t border-[#2D2D2B]/20 px-4 py-2 flex justify-end">
          <button
            onClick={onClose}
            className="text-xs uppercase tracking-wider font-bold border border-[#2D2D2B]/30 px-2 py-1 text-[#2D2D2B]/70 hover:text-[#2D2D2B]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
