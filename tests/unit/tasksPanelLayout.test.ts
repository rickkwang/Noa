import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const tasksPanelPath = fileURLToPath(new URL('../../src/components/rightPanel/TasksPanel.tsx', import.meta.url));

describe('tasks panel information hierarchy', () => {
  it('keeps the completed count compact while exposing its full meaning to assistive technology', async () => {
    const source = await readFile(tasksPanelPath, 'utf8');

    expect(source).toContain('aria-label={`${completedTasks.length} completed of ${total} tasks`}');
    expect(source).toContain('<span className={dimmer}>/</span>');
    expect(source).not.toContain('<span className={dimmer}>Completed</span>');
    expect(source).not.toContain('<span className={dimmer}>Total</span>');
  });

  it('reveals each task source only when its row is intentionally inspected', async () => {
    const source = await readFile(tasksPanelPath, 'utf8');

    expect(source).toContain('aria-label={`Open source note: ${task.noteTitle}`}');
    expect(source).toContain('opacity-0 group-hover:opacity-100 focus-visible:opacity-100');
    expect(source).toContain('<ExternalLink size={11} />');
    expect(source).not.toContain('<span className="max-w-[12ch] truncate">{task.noteTitle}</span>');
    expect(source).not.toContain('const chipBg');
  });

  it('uses compact rows with a clearly visible checkbox and focus ring', async () => {
    const source = await readFile(tasksPanelPath, 'utf8');

    expect(source).toContain('py-1.5');
    expect(source).toContain('focus-visible:ring-2 focus-visible:ring-[#CC7D5E]/60');
    expect(source).toContain("const checkboxBorder = isDark ? 'border-[rgba(249,249,247,0.48)]' : 'border-[#2D2D2B]/50';");
    expect(source).toContain("const rowHover = 'hover:bg-transparent';");
  });

  it('keeps the completed section label unruled', async () => {
    const source = await readFile(tasksPanelPath, 'utf8');

    const completedSection = source.slice(source.indexOf('Completed section'), source.indexOf('completedExpanded &&'));
    expect(completedSection).not.toContain('flex-1 h-px');
  });

  it('names the rolling date filter for its actual seven-day behavior', async () => {
    const source = await readFile(tasksPanelPath, 'utf8');

    expect(source).toContain("const DUE_OPTIONS = ['all', 'today', 'next7', 'overdue'] as const;");
    expect(source).toContain("dueDateFilterEff === 'next7'");
    expect(source).toContain("opt === 'next7' ? '7 days' : opt");
    expect(source).not.toContain("'week'");
  });
});
