import { describe, expect, it } from 'vitest';
import { dateFromCalendarKey } from '../../src/hooks/useDailyNotes';
import { applyTemplate, builtinTemplates, formatDate, type Template } from '../../src/lib/templates';

const dateTemplate: Template = {
  id: 'date-check',
  name: 'Date check',
  content: '{{title}} | {{date}} | {{week}} | {{weeknum}}',
};

describe('applyTemplate', () => {
  it('keeps a calendar-selected day consistent with a custom daily-note format and template', () => {
    const selectedDate = dateFromCalendarKey('2026-08-25');
    const title = formatDate('DD/MM/YYYY', selectedDate);
    const result = applyTemplate(dateTemplate, title, 'DD/MM/YYYY', selectedDate);

    expect(result).toBe('25/08/2026 | 25/08/2026 | Tuesday | 35');
  });

  it('lets {{date:FORMAT}} and {{time:FORMAT}} override the settings format for one placeholder', () => {
    const at = new Date(2026, 7, 25, 9, 5);
    const template: Template = { id: 'override', name: 'Override', content: '{{date:YYYY/MM/DD}} {{time:HH:mm}} {{date}}' };

    expect(applyTemplate(template, 'T', 'DD.MM.YYYY', at)).toBe('2026/08/25 09:05 25.08.2026');
  });

  it('leaves a {{date:FORMAT}} placeholder as written when it uses tokens Noa does not support', () => {
    const at = new Date(2026, 7, 25, 9, 5);
    const template: Template = { id: 'unsupported', name: 'Unsupported', content: '{{date:MMMM}} {{time:h:mm A}}' };

    expect(applyTemplate(template, 'T', 'YYYY-MM-DD', at)).toBe('{{date:MMMM}} {{time:h:mm A}}');
  });

  it('replaces every occurrence of a token in a format', () => {
    expect(formatDate('MM/MM DD', new Date(2026, 7, 25))).toBe('08/08 25');
  });
});

describe('builtinTemplates', () => {
  // The editor already renders the title, so a leading heading would duplicate it.
  it.each(builtinTemplates.filter(template => template.content))('$name does not open with a heading', template => {
    expect(template.content.trimStart()).not.toMatch(/^#\s/);
  });

  it.each(builtinTemplates.filter(template => /^- \[ \]/m.test(template.content)))('$name leaves a space after each empty task marker', template => {
    expect(template.content).not.toMatch(/^- \[ \]$/m);
  });
});
