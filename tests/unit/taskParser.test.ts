import { describe, it, expect } from 'vitest';
import { parseTasksFromNotes, toggleTaskInNoteContent } from '../../src/lib/taskParser';

const note = (content: string) => ({
  id: 'n1',
  title: 'Test',
  content,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  folder: '',
  tags: [],
  links: [],
});

describe('parseTasksFromNotes', () => {
  it('parses basic incomplete task', () => {
    const tasks = parseTasksFromNotes([note('- [ ] do something')]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].completed).toBe(false);
    expect(tasks[0].content).toBe('do something');
  });

  it('parses completed task', () => {
    const tasks = parseTasksFromNotes([note('- [x] done')]);
    expect(tasks[0].completed).toBe(true);
  });

  it('parses [X] uppercase as completed', () => {
    const tasks = parseTasksFromNotes([note('- [X] done')]);
    expect(tasks[0].completed).toBe(true);
  });

  it('parses * [ ] list marker', () => {
    const tasks = parseTasksFromNotes([note('* [ ] star task')]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].content).toBe('star task');
  });

  it('parses + [ ] list marker', () => {
    const tasks = parseTasksFromNotes([note('+ [ ] plus task')]);
    expect(tasks).toHaveLength(1);
  });

  it('parses numbered list task 1. [ ]', () => {
    const tasks = parseTasksFromNotes([note('1. [ ] numbered task')]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].content).toBe('numbered task');
  });

  it('extracts due date (emoji syntax)', () => {
    const tasks = parseTasksFromNotes([note('- [ ] buy milk 📅 2026-03-25')]);
    expect(tasks[0].dueDate).toBe('2026-03-25');
    expect(tasks[0].content).not.toContain('📅');
  });

  it('extracts due date ([due: syntax])', () => {
    const tasks = parseTasksFromNotes([note('- [ ] buy milk [due: 2026-04-01]')]);
    expect(tasks[0].dueDate).toBe('2026-04-01');
  });

  it('extracts high priority', () => {
    const tasks = parseTasksFromNotes([note('- [ ] urgent 🔺')]);
    expect(tasks[0].priority).toBe('high');
    expect(tasks[0].content).not.toContain('🔺');
  });

  it('extracts medium priority', () => {
    const tasks = parseTasksFromNotes([note('- [ ] normal 🔼')]);
    expect(tasks[0].priority).toBe('medium');
  });

  it('extracts low priority', () => {
    const tasks = parseTasksFromNotes([note('- [ ] minor 🔽')]);
    expect(tasks[0].priority).toBe('low');
  });

  it('defaults to none priority', () => {
    const tasks = parseTasksFromNotes([note('- [ ] simple task')]);
    expect(tasks[0].priority).toBe('none');
  });

  it('sorts: incomplete before complete', () => {
    const tasks = parseTasksFromNotes([note('- [x] done\n- [ ] todo')]);
    expect(tasks[0].completed).toBe(false);
    expect(tasks[1].completed).toBe(true);
  });

  it('sorts: high priority before low within incomplete', () => {
    const tasks = parseTasksFromNotes([note('- [ ] low 🔽\n- [ ] high 🔺')]);
    expect(tasks[0].priority).toBe('high');
    expect(tasks[1].priority).toBe('low');
  });

  it('sorts: task with due date before task without', () => {
    const tasks = parseTasksFromNotes([note('- [ ] no date\n- [ ] has date 📅 2026-03-25')]);
    expect(tasks[0].dueDate).toBe('2026-03-25');
    expect(tasks[1].dueDate).toBeUndefined();
  });

  it('assigns correct lineIndex', () => {
    const tasks = parseTasksFromNotes([note('# Header\n- [ ] task one\n- [ ] task two')]);
    const lineIndices = tasks.map(t => t.lineIndex).sort((a, b) => a - b);
    expect(lineIndices).toEqual([1, 2]);
  });

  it('returns empty array for notes with no tasks', () => {
    const tasks = parseTasksFromNotes([note('# Just a heading\n\nSome text.')]);
    expect(tasks).toHaveLength(0);
  });

  it('sets task id as noteId-lineIndex', () => {
    const tasks = parseTasksFromNotes([note('- [ ] task')]);
    expect(tasks[0].id).toBe('n1-0');
  });

  it('parses noa task id marker without leaking into content', () => {
    const tasks = parseTasksFromNotes([note('- [ ] ship it <!-- noa-task:task-123 -->')]);
    expect(tasks[0].taskId).toBe('task-123');
    expect(tasks[0].content).toBe('ship it');
  });
});

describe('toggleTaskInNoteContent', () => {
  it('toggles by task id after line order changes', () => {
    const content = [
      '- [ ] moved later <!-- noa-task:t1 -->',
      '- [ ] untouched <!-- noa-task:t2 -->',
    ].join('\n');

    const [firstTask] = parseTasksFromNotes([note(content)]);
    const reordered = [
      '- [ ] untouched <!-- noa-task:t2 -->',
      '- [ ] moved later <!-- noa-task:t1 -->',
    ].join('\n');

    const result = toggleTaskInNoteContent(reordered, firstTask);
    expect(result.updated).toBe(true);
    expect(result.updatedContent).toContain('- [x] moved later <!-- noa-task:t1 -->');
    expect(result.updatedContent).toContain('- [ ] untouched <!-- noa-task:t2 -->');
  });

  it('falls back by content occurrence for legacy tasks and injects task id', () => {
    const legacy = '- [ ] repeat\n- [ ] repeat';
    const tasks = parseTasksFromNotes([note(legacy)]);
    const secondTask = tasks.find((task) => task.occurrenceIndex === 1)!;
    const result = toggleTaskInNoteContent(legacy, secondTask);
    const lines = result.updatedContent.split('\n');

    expect(result.updated).toBe(true);
    expect(lines[0]).toBe('- [ ] repeat');
    expect(lines[1]).toMatch(/^- \[x\] repeat <!-- noa-task:[A-Za-z0-9_-]+ -->$/);
  });

  it('does not update when target task cannot be matched', () => {
    const tasks = parseTasksFromNotes([note('- [ ] original')]);
    const result = toggleTaskInNoteContent('- [ ] changed text', tasks[0]);

    expect(result.updated).toBe(false);
    expect(result.updatedContent).toBe('- [ ] changed text');
  });
});
