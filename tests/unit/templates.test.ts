import { describe, expect, it } from 'vitest';
import { dateFromCalendarKey } from '../../src/hooks/useDailyNotes';
import { applyTemplate, formatDate, type Template } from '../../src/lib/templates';

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
});
