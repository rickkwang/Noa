import type { IconProps } from '@phosphor-icons/react';
import React, { useLayoutEffect, useRef, useState } from 'react';

interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ComponentType<IconProps>;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  options: readonly SegmentedControlOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

/**
 * Inset track, raised selection: the chosen segment is the only one on the
 * page's own surface, the rest sit in a well one step below it. That reads as
 * "one of these is on" without spending a colour or a border on it, which is
 * why it suits small closed sets — theme, view mode — better than a dropdown
 * (hides the alternatives behind a click) or a row of outlined buttons (every
 * option shouts equally).
 *
 * Radios, not buttons: the options are mutually exclusive and arrow keys move
 * between them, which is what a radiogroup already means to a screen reader.
 */
export default function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: SegmentedControlProps<T>) {
  const itemRefs = useRef(new Map<T, HTMLButtonElement>());
  // One shared pill slides between the segments rather than each segment
  // painting its own background: a background cannot animate from one element
  // to another, and cross-fading two of them reads as a blink, not a move.
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const node = itemRefs.current.get(value);
      if (!node) return;
      // Bail out when nothing moved. Without this a caller passing an inline
      // options array would loop: new array identity → effect → setPill with a
      // fresh object → render → new array identity again.
      setPill((prev) => (prev && prev.left === node.offsetLeft && prev.width === node.offsetWidth
        ? prev
        : { left: node.offsetLeft, width: node.offsetWidth }));
    };
    measure();

    // Segment widths shift when a webfont swaps in or the dialog is resized;
    // remeasuring keeps the pill on its segment instead of stranding it.
    const observer = new ResizeObserver(measure);
    itemRefs.current.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [value, options]);

  const selectAt = (index: number) => {
    const next = options[(index + options.length) % options.length];
    onChange(next.value);
    window.requestAnimationFrame(() => {
      itemRefs.current.get(next.value)?.focus();
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      selectAt(index + 1);
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      selectAt(index - 1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      // inline-grid with equal auto columns: every segment takes the width of
      // the widest one, so the pill is the same size wherever it lands. A flex
      // row sized each segment to its own label, which made the pill grow and
      // shrink as it slid.
      className="noa-segmented-track relative inline-grid grid-flow-col [grid-auto-columns:1fr] items-center gap-0.5 rounded-[9px] p-0.5"
    >
      {/* Mounted only once a position is known, so the pill appears under the
          current segment instead of sliding in from the track's left edge. */}
      {pill && (
        <span
          aria-hidden="true"
          className="noa-segmented-pill absolute top-0.5 bottom-0.5 left-0 rounded-[7px] bg-[var(--bg-primary,#F9F9F7)] shadow-[0_1px_2px_rgba(45,45,43,0.12)]"
          style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
        />
      )}
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) itemRefs.current.set(option.value, node);
              else itemRefs.current.delete(option.value);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            aria-label={option.icon ? option.label : undefined}
            title={option.icon ? option.label : undefined}
            // z-10 keeps the labels above the sliding pill; the selected one
            // no longer carries a background of its own.
            className={`relative z-10 flex items-center justify-center rounded-[7px] py-1 text-sm font-medium transition-colors ${
              option.icon ? 'px-2.5' : 'px-3'
            } ${
              selected
                ? 'text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {option.icon ? <option.icon size={16} aria-hidden="true" /> : option.label}
          </button>
        );
      })}
    </div>
  );
}
