export interface Template {
  id: string;
  name: string;
  content: string;
  isBuiltin?: boolean;
}

// No template starts with a `# heading`: the editor already shows the title
// (inlineTitle.ts), so an H1 would duplicate it. `${' '}` after `- [ ]` is
// spelled out so a trailing-whitespace trim can't remove the space.
export const builtinTemplates: Template[] = [
  {
    id: 'blank',
    name: 'Blank',
    content: '',
    isBuiltin: true,
  },
  {
    id: 'daily',
    name: 'Daily Note',
    content: `## Today's Focus
- [ ]${' '}

## Notes


## Reflections

`,
    isBuiltin: true,
  },
  {
    id: 'meeting',
    name: 'Meeting Notes',
    content: `**Date**: {{date}}
**Attendees**:

## Agenda
-

## Notes


## Action Items
- [ ]${' '}

`,
    isBuiltin: true,
  },
  {
    id: 'reading',
    name: 'Reading Notes',
    content: `**Author**:
**Date Read**: {{date}}

## Summary


## Key Takeaways
-

## Quotes


## My Thoughts

`,
    isBuiltin: true,
  },
];

const pad = (n: number) => String(n).padStart(2, '0');

// String.replace with a string only swaps the first match, so tokens are matched globally.
const FORMAT_TOKEN = /YYYY|YY|MM|DD|HH|mm/g;
// Each run of identical letters must be exactly one token: "MMMM" would otherwise read as two "MM".
const SUPPORTED_RUN = /^(?:YYYY|YY|MM|DD|HH|mm)$/;
const isSupportedFormat = (format: string): boolean =>
  (format.match(/([A-Za-z])\1*/g) ?? []).every((run) => SUPPORTED_RUN.test(run));

export function formatDate(dateFormat: string, date?: Date): string {
  const d = date ?? new Date();
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(-2),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
  };
  return dateFormat.replace(FORMAT_TOKEN, (token) => tokens[token]);
}

/**
 * Expand a template for a date (defaults to now). Daily-note navigation passes
 * the calendar-selected day so title and placeholders agree.
 */
export function applyTemplate(template: Template, title: string, dateFormat: string = 'YYYY-MM-DD', dateOverride: Date = new Date()): string {
  const now = dateOverride;
  const date = formatDate(dateFormat, now);
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const week = dayNames[now.getDay()];
  const tmp = new Date(now); tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const w1 = new Date(tmp.getFullYear(), 0, 4);
  const weeknum = String(1 + Math.round(((tmp.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7));
  // {{date:FORMAT}} and {{time:FORMAT}} override the format for one placeholder. Placeholders
  // with any other letters (e.g. MMMM) are left exactly as written.
  const overrideFormat = (placeholder: string, format: string) => (isSupportedFormat(format) ? formatDate(format, now) : placeholder);
  return template.content
    .replace(/\{\{date:([^}]+)\}\}/g, overrideFormat)
    .replace(/\{\{time:([^}]+)\}\}/g, overrideFormat)
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{time\}\}/g, time)
    .replace(/\{\{week\}\}/g, week)
    .replace(/\{\{weeknum\}\}/g, weeknum);
}
