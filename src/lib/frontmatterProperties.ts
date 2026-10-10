// Line-preserving editing of a raw YAML frontmatter block (no --- delimiters).
// Only the property being changed is rewritten; every other line stays
// byte-for-byte, so editing one value in a vault file never reformats the rest.

export type PropertyValue = string | string[];

export interface FrontmatterProperty {
  key: string;
  value: PropertyValue;
  /** False for shapes this editor can't round-trip (nested maps, block scalars). */
  editable: boolean;
}

interface PropertySpan {
  key: string;
  start: number;
  /** Exclusive; trailing blank lines are left outside the span. */
  end: number;
}

const LIST_KEYS = new Set(['tags', 'aliases', 'cssclasses']);
const TOP_LEVEL_KEY = /^([^\s#-][^:]*?)\s*:(?:\s|$)/;
const LIST_ITEM = /^\s*-\s+(.*)$/;

function splitLines(block: string): string[] {
  return block === '' ? [] : block.split(/\r?\n/);
}

function findSpans(lines: string[]): PropertySpan[] {
  const spans: PropertySpan[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(TOP_LEVEL_KEY);
    if (!match) continue;
    let end = i + 1;
    while (end < lines.length && !TOP_LEVEL_KEY.test(lines[end]) && (lines[end].trim() === '' || /^[\s-]/.test(lines[end]))) {
      end += 1;
    }
    while (end > i + 1 && lines[end - 1].trim() === '') end -= 1;
    spans.push({ key: match[1].trim(), start: i, end });
    i = end - 1;
  }
  return spans;
}

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

function parseSpan(lines: string[], span: PropertySpan): FrontmatterProperty {
  const head = lines[span.start];
  const inline = head.slice(head.indexOf(':') + 1).trim();
  const rest = lines.slice(span.start + 1, span.end).filter((line) => line.trim() !== '');

  if (inline.startsWith('[') && inline.endsWith(']') && rest.length === 0) {
    const inner = inline.slice(1, -1);
    // Quoted items may hide commas; leave those to the source rather than split them wrong.
    if (/[[\]{}"']/.test(inner)) return { key: span.key, value: inline, editable: false };
    const items = inner.trim() === '' ? [] : inner.split(',').map(unquote).filter(Boolean);
    return { key: span.key, value: items, editable: true };
  }
  if (inline === '') {
    if (rest.length > 0 && rest.every((line) => LIST_ITEM.test(line))) {
      return { key: span.key, value: rest.map((line) => unquote(line.match(LIST_ITEM)![1])), editable: true };
    }
    if (rest.length === 0) {
      return { key: span.key, value: LIST_KEYS.has(span.key) ? [] : '', editable: true };
    }
    return { key: span.key, value: rest.map((line) => line.trim()).join('\n'), editable: false };
  }
  // Block scalars (`|`, `>`) and multi-line plain scalars aren't round-tripped.
  const editable = rest.length === 0 && !/^[|>]/.test(inline) && !inline.startsWith('{');
  return { key: span.key, value: editable ? unquote(inline) : [inline, ...rest.map((l) => l.trim())].join('\n'), editable };
}

export function parseProperties(block: string): FrontmatterProperty[] {
  const lines = splitLines(block);
  return findSpans(lines).map((span) => parseSpan(lines, span));
}

const RESERVED_WORDS = /^(?:true|false|yes|no|on|off|null|~)$/i;

export function yamlScalar(value: string): string {
  if (value === '') return '""';
  const needsQuotes = /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(value)
    || /\s$/.test(value)
    || /: |\s#|[\n\r\t]/.test(value)
    || /:$/.test(value);
  return needsQuotes ? JSON.stringify(value) : value;
}

function serialize(key: string, value: PropertyValue): string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${key}: []`];
    return [`${key}:`, ...value.map((item) => `  - ${yamlScalar(item)}`)];
  }
  if (value === '') return [`${key}:`];
  // Keep booleans/null literal so a checkbox writes `done: true`, not `"true"`.
  return [`${key}: ${RESERVED_WORDS.test(value) ? value : yamlScalar(value)}`];
}

function detectEol(block: string): string {
  return block.includes('\r\n') ? '\r\n' : '\n';
}

export function setProperty(block: string, key: string, value: PropertyValue): string {
  const lines = splitLines(block);
  const span = findSpans(lines).find((item) => item.key === key);
  const replacement = serialize(key, value);
  if (span) {
    lines.splice(span.start, span.end - span.start, ...replacement);
  } else {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push(...replacement);
  }
  return lines.join(detectEol(block));
}

export function removeProperty(block: string, key: string): string {
  const lines = splitLines(block);
  const span = findSpans(lines).find((item) => item.key === key);
  if (!span) return block;
  lines.splice(span.start, span.end - span.start);
  return lines.join(detectEol(block));
}

/** Tags as Noa stores them on the note: from the `tags` property, without a leading `#`. */
export function tagsFromProperties(block: string): string[] {
  const tags = parseProperties(block).find((prop) => prop.key === 'tags')?.value;
  const list = Array.isArray(tags) ? tags : tags ? [tags] : [];
  return list.map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean);
}
