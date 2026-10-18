import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from '@/src/lib/icons';

interface SettingsSelectOption<T extends string> {
  value: T;
  label: string;
}

interface SettingsSelectProps<T extends string> {
  value: T;
  options: readonly SettingsSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

/**
 * Closed pill with a popover list, matching FontPicker's trigger and popover so the two read as one control family.
 * Used instead of a native <select>, whose OS-drawn popup doesn't fit the app's surfaces.
 */
export default function SettingsSelect<T extends string>({ value, options, onChange, ariaLabel }: SettingsSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const current = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Opening puts focus on the current option so the list can be driven from the keyboard.
  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.focus();
    // Only on open; arrow-key moves already focus the row they land on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openList = () => {
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };

  const closeList = (refocusTrigger: boolean) => {
    setOpen(false);
    if (refocusTrigger) triggerRef.current?.focus();
  };

  const moveActive = (index: number) => {
    const next = (index + options.length) % options.length;
    setActiveIndex(next);
    optionRefs.current[next]?.focus();
  };

  const select = (next: T) => {
    onChange(next);
    closeList(true);
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    // Enter and Space already fire the button's click, which toggles the list.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openList();
    }
  };

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeList(true);
      return;
    }
    if (event.key === 'Tab') {
      closeList(false);
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(activeIndex - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      moveActive(options.length - 1);
    }
  };

  return (
    <div ref={rootRef} className="relative inline-block max-w-xs" onKeyDown={onListKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${baseId}-listbox` : undefined}
        onClick={() => (open ? closeList(false) : openList())}
        onKeyDown={onTriggerKeyDown}
        className={`flex items-center max-w-full border border-[#2D2D2B] rounded-chip pl-3 pr-9 py-1.5 text-sm font-medium text-left outline-none relative hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)] ${open ? 'bg-[var(--bg-sidebar-raised,#ECEBE8)]' : 'bg-[var(--bg-primary,#F9F9F7)]'}`}
      >
        <span className="min-w-0 truncate">{current?.label ?? value}</span>
        <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_70%,transparent)]" />
      </button>

      {open && (
        <ul
          id={`${baseId}-listbox`}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 top-full z-50 mt-1 min-w-full w-max bg-[var(--surface-page,#F9F9F7)] rounded-panel noa-floating-panel overflow-hidden py-1"
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            return (
              <li key={option.value} role="presentation">
                <button
                  ref={(node) => { optionRefs.current[index] = node; }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => select(option.value)}
                  onFocus={() => setActiveIndex(index)}
                  className="w-full flex items-center justify-between gap-6 px-3 py-1.5 text-left text-sm text-[var(--text-primary,#2D2D2B)] transition-colors hover:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)] focus:bg-[color-mix(in_srgb,var(--text-primary,#2D2D2B)_5%,transparent)] outline-none"
                >
                  <span className="whitespace-nowrap">{option.label}</span>
                  {isSelected && <Check size={13} className="shrink-0 text-[var(--text-primary,#2D2D2B)]" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
