import React, { useEffect, useMemo, useState } from 'react';
import { parseProperties, removeProperty, setProperty, type FrontmatterProperty, type PropertyValue } from '../../lib/frontmatterProperties';
import { AlignLeft, Calendar, CheckSquare, ExternalLink, List, Plus, Tag, X } from '@/src/lib/icons';

interface PropertiesBlockProps {
  /** Raw YAML between the --- delimiters. */
  block: string;
  readOnly?: boolean;
  onChange: (block: string) => void;
  style?: React.CSSProperties;
  /** Properties used elsewhere in the workspace (one sample value each), offered by Add property. Called when it opens. */
  getSuggestions?: () => FrontmatterProperty[];
  /** Narrow side-pane layout: tighter key column, no heading (the pane has its own). */
  compact?: boolean;
}

type PropertyKind = 'tags' | 'list' | 'date' | 'datetime' | 'checkbox' | 'text';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function kindOf(prop: FrontmatterProperty): PropertyKind {
  if (Array.isArray(prop.value)) return prop.key === 'tags' ? 'tags' : 'list';
  if (DATE_RE.test(prop.value)) return 'date';
  if (DATETIME_RE.test(prop.value)) return 'datetime';
  if (/^(true|false)$/i.test(prop.value)) return 'checkbox';
  return 'text';
}

const KIND_ICON: Record<PropertyKind, React.ComponentType<{ size?: number | string; className?: string }>> = {
  tags: Tag,
  list: List,
  date: Calendar,
  datetime: Calendar,
  checkbox: CheckSquare,
  text: AlignLeft,
};

// Foreground colours go through the token (see CLAUDE.md "Theme colour remapping").
const fg = 'text-[var(--text-primary,#2D2D2B)]';
// One box for every value cell (inputs, chips, links) so rows share a height and text starts at one x.
const valueBox = 'min-h-[1.9em] flex items-center px-1.5 rounded';
const inputBase = `w-full min-w-0 bg-transparent outline-none ${valueBox} ${fg}`;
// Outline rather than fill, as in Obsidian, so tag chips keep their contrast while hovered.
const rowHighlight = 'border border-transparent hover:border-[var(--divider-subtle)] focus-within:border-[var(--divider-subtle)]';

function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A new property starts empty but keeps the type it has elsewhere in the workspace.
function emptyValueFor(key: string, sample?: FrontmatterProperty): PropertyValue {
  const kind = sample?.editable ? kindOf(sample) : undefined;
  if (kind === 'tags' || kind === 'list' || key === 'tags' || key === 'aliases') return [];
  if (kind === 'checkbox') return 'false';
  if (kind === 'date') return localDate();
  if (kind === 'datetime') return `${localDate()}T00:00`;
  return '';
}

// Enter/Backspace while an IME is composing (e.g. picking Chinese candidates) belong to the IME, not to us.
const isComposing = (e: React.KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;

const URL_RE = /^https?:\/\/\S+$/;

function TextValue({ value, readOnly, onCommit }: { value: string; readOnly?: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(value), [value]);

  // At rest the value wraps in full (an input would clip it at the column edge);
  // a click or Tab swaps in the input. URLs read as links, as in Obsidian.
  if (!editing) {
    return (
      <div
        tabIndex={readOnly ? undefined : 0}
        onClick={() => { if (!readOnly) setEditing(true); }}
        // Only the box's own focus (Tab): React focus bubbles, and clicking the link must open it, not edit.
        onFocus={(e) => { if (!readOnly && e.target === e.currentTarget) setEditing(true); }}
        className={`${valueBox} py-[0.2em] cursor-text break-all whitespace-pre-wrap outline-none ${fg}`}
      >
        {value === '' ? <span className="opacity-30">Empty</span> : URL_RE.test(value) ? (
          <span>
            <a
              href={value}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[#CC7D5E] underline underline-offset-2"
            >
              {value}
            </a>
            <ExternalLink size="0.85em" className="inline ml-0.5 align-baseline opacity-50" />
          </span>
        ) : value}
      </div>
    );
  }
  return (
    <input
      type="text"
      autoFocus={editing}
      value={draft}
      readOnly={readOnly}
      placeholder="Empty"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => {
        if (isComposing(e)) return;
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur(); }
      }}
      className={`${inputBase} placeholder:opacity-30`}
    />
  );
}

// Edited in place segment by segment, as in Obsidian: no picker (hidden in index.css).
// Commits on blur so typing a year doesn't write intermediate values like 0002.
function DateValue({ value, withTime, readOnly, onCommit }: { value: string; withTime: boolean; readOnly?: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type={withTime ? 'datetime-local' : 'date'}
      value={draft}
      readOnly={readOnly}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft && draft !== value) onCommit(draft); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className={`${inputBase.replace('w-full ', '')} w-fit`}
    />
  );
}

function ListValue({ items, isTags, readOnly, onCommit }: { items: string[]; isTags: boolean; readOnly?: boolean; onCommit: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const next = draft.split(',').map((s) => s.trim().replace(isTags ? /^#/ : /^$/, '')).filter(Boolean);
    setDraft('');
    if (next.length) onCommit([...items, ...next.filter((item) => !items.includes(item))]);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-w-0 min-h-[1.9em] px-1.5 py-[0.2em]">
      {items.map((item) => (
        <span
          key={item}
          className={isTags
            ? 'noa-tag inline-flex items-center gap-[0.35em] !rounded-full !px-[0.65em] !font-medium leading-[1.7] !text-[1em]'
            : `inline-flex items-center gap-1 rounded bg-[var(--divider-subtle)] px-2 leading-[1.6] ${fg}`}
        >
          {item}
          {!readOnly && (
            <button type="button" aria-label={`Remove ${item}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onCommit(items.filter((i) => i !== item))} className="flex items-center opacity-45 hover:opacity-100">
              <X size="0.8em" weight="bold" />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <input
          type="text"
          value={draft}
          placeholder={items.length ? '' : 'Empty'}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (isComposing(e)) return;
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
            if (e.key === 'Backspace' && draft === '' && items.length) onCommit(items.slice(0, -1));
          }}
          className={`flex-1 min-w-[4rem] bg-transparent outline-none ${fg} placeholder:opacity-30`}
        />
      )}
    </div>
  );
}

function PropertyValueEditor({ prop, readOnly, onCommit }: { prop: FrontmatterProperty; readOnly?: boolean; onCommit: (v: PropertyValue) => void }) {
  if (!prop.editable) {
    return <div className={`${valueBox} whitespace-pre-wrap break-all opacity-60 ${fg}`} title="Edit this property in the note source">{prop.value as string}</div>;
  }
  const kind = kindOf(prop);
  if (kind === 'tags' || kind === 'list') {
    return <ListValue items={prop.value as string[]} isTags={kind === 'tags'} readOnly={readOnly} onCommit={onCommit} />;
  }
  const value = prop.value as string;
  if (kind === 'checkbox') {
    return (
      <div className={valueBox}>
        <input
          type="checkbox"
          checked={value.toLowerCase() === 'true'}
          disabled={readOnly}
          onChange={(e) => onCommit(e.target.checked ? 'true' : 'false')}
          className="accent-[#CC7D5E]"
        />
      </div>
    );
  }
  if (kind === 'date' || kind === 'datetime') {
    return <DateValue value={value} withTime={kind === 'datetime'} readOnly={readOnly} onCommit={onCommit} />;
  }
  return <TextValue value={value} readOnly={readOnly} onCommit={onCommit} />;
}

export function PropertiesBlock({ block, readOnly, onChange, style, getSuggestions, compact = false }: PropertiesBlockProps) {
  const grid = compact ? 'grid grid-cols-[6.5rem_1fr]' : 'grid grid-cols-[9rem_1fr]';
  const properties = useMemo(() => parseProperties(block), [block]);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [highlight, setHighlight] = useState(-1);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot once per Add property, not per keystroke
  const suggestions = useMemo(() => (adding && getSuggestions ? getSuggestions() : []), [adding]);

  const matches = useMemo(() => {
    const query = newKey.trim().toLowerCase();
    return suggestions.filter((s) => !properties.some((p) => p.key === s.key) && s.key.toLowerCase().includes(query));
  }, [newKey, properties, suggestions]);

  const closeAdding = () => { setAdding(false); setNewKey(''); setHighlight(-1); };

  const addKey = (rawKey: string) => {
    const key = rawKey.trim().replace(/:$/, '');
    closeAdding();
    if (!key || properties.some((p) => p.key === key)) return;
    onChange(setProperty(block, key, emptyValueFor(key, suggestions.find((s) => s.key === key))));
  };

  return (
    <div className={`noa-properties font-redaction leading-normal text-[0.875em] ${compact ? 'px-1.5' : 'pt-1 pb-3'}`} style={style}>
      {!compact && <div className={`font-semibold pb-1 ${fg}`}>Properties</div>}
      {properties.map((prop) => {
        const Icon = KIND_ICON[prop.editable ? kindOf(prop) : 'text'];
        return (
          <div key={prop.key} className={`group ${grid} items-start gap-1 -mx-1.5 px-1.5 my-[2px] rounded-md ${readOnly ? '' : rowHighlight}`}>
            <div className={`flex items-center gap-2 min-h-[1.9em] pr-1.5 min-w-0 opacity-55 ${fg}`} title={prop.key}>
              <Icon size="1.15em" className="shrink-0" />
              <span className="truncate">{prop.key}</span>
            </div>
            <div className="flex items-start min-w-0">
              <div className="flex-1 min-w-0">
                <PropertyValueEditor prop={prop} readOnly={readOnly} onCommit={(value) => onChange(setProperty(block, prop.key, value))} />
              </div>
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Remove property ${prop.key}`}
                  onClick={() => onChange(removeProperty(block, prop.key))}
                  className={`shrink-0 h-[1.9em] px-1.5 flex items-center opacity-0 group-hover:opacity-40 hover:!opacity-80 focus:opacity-60 ${fg}`}
                >
                  <X size="1em" />
                </button>
              )}
            </div>
          </div>
        );
      })}
      {!readOnly && (adding ? (
        <div className={`${grid} items-start gap-1 -mx-1.5 px-1.5 my-[2px] rounded-md border border-[var(--divider-subtle)]`}>
          <div className="relative">
            <div className={`flex items-center gap-2 ${fg}`}>
              <AlignLeft size="1.15em" className="shrink-0 opacity-55" />
              <input
                autoFocus
                type="text"
                value={newKey}
                placeholder="Property name"
                onChange={(e) => { setNewKey(e.target.value); setHighlight(-1); }}
                onBlur={() => addKey(newKey)}
                onKeyDown={(e) => {
                  if (isComposing(e)) return;
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (!matches.length) return;
                    const step = e.key === 'ArrowDown' ? 1 : -1;
                    setHighlight((h) => (h + step + matches.length) % matches.length);
                  }
                  if (e.key === 'Enter') addKey(highlight >= 0 && matches[highlight] ? matches[highlight].key : newKey);
                  if (e.key === 'Escape') closeAdding();
                }}
                className={`${inputBase} !px-0 placeholder:opacity-30`}
              />
            </div>
            {matches.length > 0 && (
              <div
                role="listbox"
                className="absolute left-0 top-full z-30 mt-1 w-56 max-h-72 overflow-y-auto rounded-lg border border-[var(--divider-subtle)] bg-[var(--bg-primary,#F9F9F7)] p-1 shadow-lg"
              >
                {matches.map((s, i) => {
                  const Icon = KIND_ICON[s.editable ? kindOf(s) : 'text'];
                  return (
                    <div
                      key={s.key}
                      role="option"
                      aria-selected={i === highlight}
                      // mousedown, not click: picking must land before the input's blur commits the typed text.
                      onMouseDown={(e) => { e.preventDefault(); addKey(s.key); }}
                      onMouseEnter={() => setHighlight(i)}
                      className={`flex items-center gap-2 rounded px-2 py-1 cursor-pointer ${fg} ${i === highlight ? 'bg-[var(--divider-subtle)]' : ''}`}
                    >
                      <Icon size="1.15em" className="shrink-0 opacity-55" />
                      <span className="truncate">{s.key}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className={`${valueBox} opacity-30 ${fg}`}>Empty</div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`mt-1 flex items-center gap-2 min-h-[1.9em] pr-1.5 opacity-45 hover:opacity-80 ${fg}`}
        >
          <Plus size="1.15em" />
          <span>Add property</span>
        </button>
      ))}
    </div>
  );
}
