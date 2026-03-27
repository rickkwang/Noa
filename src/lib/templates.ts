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

export function formatDate(dateFormat: string, date?: Date): string {
  const d = date ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return dateFormat
    .replace('YYYY', String(d.getFullYear()))
    .replace('YY', String(d.getFullYear()).slice(-2))
    .replace('MM', pad(d.getMonth() + 1))
    .replace('DD', pad(d.getDate()))
    .replace('HH', pad(d.getHours()))
    .replace('mm', pad(d.getMinutes()));
}

export function applyTemplate(template: Template, title: string, dateFormat: string = 'YYYY-MM-DD'): string {
  const date = formatDate(dateFormat);
  return template.content
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{title\}\}/g, title);
}
