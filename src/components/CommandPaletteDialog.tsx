import { useEffect } from 'react';
import type { useCommandPalette } from '../hooks/useCommandPalette';
import { useDialogKeyboard } from '../hooks/useDialogKeyboard';

type CommandPalette = ReturnType<typeof useCommandPalette>;

export default function CommandPaletteDialog({ palette }: { palette: CommandPalette }) {
  const { dialogRef, onKeyDown } = useDialogKeyboard(palette.close);
  const selectedItem = palette.items[palette.selectedIndex];
  const selectedOptionId = selectedItem ? `command-palette-option-${selectedItem.id}` : undefined;

  // Focus on mount, not from the hook on `isOpen`: the dialog is lazy, so on
  // the first open the input does not exist yet when that flag flips.
  useEffect(() => {
    palette.inputRef.current?.focus();
    palette.inputRef.current?.select();
  }, [palette.inputRef]);

  // getElementById, not querySelector: the id embeds an unvalidated note id, and a `"` in it made the selector throw.
  useEffect(() => {
    if (!selectedOptionId) return;
    document.getElementById(selectedOptionId)?.scrollIntoView({ block: 'nearest' });
  }, [selectedOptionId]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/30 flex items-start justify-center pt-24 px-4" onClick={palette.close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="outline-none w-full max-w-xl border border-[var(--divider-subtle)] bg-[#F9F9F7] noa-floating-panel slide-down rounded-[14px] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--divider-subtle)] px-4 py-3">
          <input
            ref={palette.inputRef}
            type="text"
            value={palette.query}
            onChange={(e) => palette.setQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-activedescendant={selectedOptionId}
            aria-autocomplete="list"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                palette.close();
                return;
              }
              // Focus never leaves the input: the arrows move the highlight,
              // and Enter runs whatever is highlighted.
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                palette.moveSelection(e.key === 'ArrowDown' ? 1 : -1);
                return;
              }
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && selectedItem) {
                e.preventDefault();
                palette.run(selectedItem.action);
              }
            }}
            placeholder="Type a command or note title..."
            className="w-full bg-transparent text-sm font-redaction outline-none placeholder:text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_40%,transparent)]"
          />
        </div>
        <div id="command-palette-list" role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto [scrollbar-gutter:stable] p-2 space-y-1">
          {palette.items.length === 0 ? (
            <div className="px-2 py-3 text-xs text-[#2D2D2B]/60">No matching commands.</div>
          ) : (
            palette.items.map((item, index) => (
              <button
                key={item.id}
                id={`command-palette-option-${item.id}`}
                role="option"
                aria-selected={index === palette.selectedIndex}
                onClick={() => palette.run(item.action)}
                // onMouseMove, not onMouseEnter, so scrolling under a resting pointer doesn't steal the arrow-key highlight.
                onMouseMove={() => { if (index !== palette.selectedIndex) palette.setSelectedIndex(index); }}
                className={`w-full text-left px-3 py-2 text-sm rounded-md font-redaction ${index === palette.selectedIndex ? 'bg-[#EFEAE3]' : ''}`}
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
