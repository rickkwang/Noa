import type { useCommandPalette } from '../hooks/useCommandPalette';

type CommandPalette = ReturnType<typeof useCommandPalette>;

export default function CommandPaletteDialog({ palette }: { palette: CommandPalette }) {
  return (
    <div className="fixed inset-0 z-[70] bg-black/30 flex items-start justify-center pt-24 px-4" onClick={palette.close}>
      <div
        className="w-full max-w-xl border border-[#2D2D2B] bg-[#F9F9F7] noa-floating-panel slide-down"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[#2D2D2B] p-3 bg-[#EFEAE3]">
          <input
            ref={palette.inputRef}
            type="text"
            value={palette.query}
            onChange={(e) => palette.setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                palette.close();
                return;
              }
              if (e.key === 'Enter' && palette.items[0]) {
                e.preventDefault();
                palette.run(palette.items[0].action);
              }
            }}
            placeholder="Type a command or note title..."
            className="w-full bg-[#F9F9F7] border border-[#2D2D2B] px-3 py-2 text-sm font-redaction outline-none focus:border-[#CC7D5E]"
          />
        </div>
        <div className="max-h-80 overflow-y-auto [scrollbar-gutter:stable] p-2 space-y-1">
          {palette.items.length === 0 ? (
            <div className="px-2 py-3 text-xs text-[#2D2D2B]/60">No matching commands.</div>
          ) : (
            palette.items.map((item) => (
              <button
                key={item.id}
                onClick={() => palette.run(item.action)}
                className="w-full text-left px-3 py-2 text-sm border border-transparent hover:border-[#2D2D2B]/30 hover:bg-[#EFEAE3]/50 font-redaction"
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
