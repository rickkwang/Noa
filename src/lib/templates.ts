export interface Template {
  id: string;
  name: string;
  content: string;
  isBuiltin?: boolean;
}

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
    content: `# {{date}}

## Today's Focus
- [ ]

## Notes


## Reflections

`,
    isBuiltin: true,
  },
  {
    id: 'meeting',
    name: 'Meeting Notes',
    content: `# Meeting: {{title}}

**Date**: {{date}}
**Attendees**:

## Agenda
-

## Notes


## Action Items
- [ ]

`,
    isBuiltin: true,
  },
  {
    id: 'reading',
    name: 'Reading Notes',
    content: `# {{title}}

**Author**:
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

export function formatDate(dateFormat: string, date?: Date): string {
  const d = date ?? new Date();
  return dateFormat
    .replace('YYYY', String(d.getFullYear()))
    .replace('YY', String(d.getFullYear()).slice(-2))
    .replace('MM', pad(d.getMonth() + 1))
    .replace('DD', pad(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()));
}

export function applyTemplate(template: Template, title: string, dateFormat: string = 'YYYY-MM-DD'): string {
  const now = new Date();
  const date = formatDate(dateFormat, now);
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const week = dayNames[now.getDay()];
  const tmp = new Date(now); tmp.setHours(0, 0, 0, 0);
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7));
  const w1 = new Date(tmp.getFullYear(), 0, 4);
  const weeknum = String(1 + Math.round(((tmp.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7));
  return template.content
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{time\}\}/g, time)
    .replace(/\{\{week\}\}/g, week)
    .replace(/\{\{weeknum\}\}/g, weeknum);
}
