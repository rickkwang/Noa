import { applyTemplate, builtinTemplates, type Template } from '../lib/templates';

interface TemplatePickerDialogProps {
  noteTitle: string;
  dateFormat: string;
  userTemplates: Template[];
  onApply: (content: string) => void;
  onClose: () => void;
}

export default function TemplatePickerDialog({
  noteTitle,
  dateFormat,
  userTemplates,
  onApply,
  onClose,
}: TemplatePickerDialogProps) {
  const allTemplates = [...builtinTemplates, ...userTemplates];
  return (
    <div className="fixed inset-0 z-[65] bg-black/30 flex items-center justify-center px-4" onClick={onClose}>
      <div className="w-full max-w-sm border border-[#2D2D2B] bg-[#F9F9F7] noa-floating-panel slide-down" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-[#2D2D2B] px-4 py-3 bg-[#EFEAE3] flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-[#2D2D2B]/60 font-bold">Choose Template</div>
            <div className="text-sm text-[#2D2D2B] mt-0.5">Pick a template for this note</div>
          </div>
          <button onClick={onClose} className="text-[#2D2D2B]/50 hover:text-[#2D2D2B] text-lg leading-none active:opacity-70">×</button>
        </div>
        <div className="p-2 space-y-1 max-h-80 overflow-y-auto [scrollbar-gutter:stable]">
          {allTemplates.map(t => (
            <button
              key={t.id}
              onClick={() => {
                if (t.id !== 'blank') {
                  onApply(applyTemplate(t, noteTitle, dateFormat));
                }
                onClose();
              }}
              className="w-full text-left border border-[#2D2D2B]/20 hover:border-[#2D2D2B]/50 px-3 py-2 bg-[#F9F9F7] hover:bg-[#EFEAE3]/40 active:opacity-70"
            >
              <div className="text-sm font-bold text-[#2D2D2B]">{t.name}</div>
              {t.content && (
                <div className="text-xs text-[#2D2D2B]/50 mt-0.5 truncate">{t.content.slice(0, 60)}{t.content.length > 60 ? '…' : ''}</div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
