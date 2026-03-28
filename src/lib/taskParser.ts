import { Note, GlobalTask, Priority } from '../types';

const TASK_REGEX = /^(\s*(?:-|\*|\+|\d+\.)\s+)\[( |x|X)\]\s+(.*)$/;
const DUE_REGEX = /(?:📅|\[due:)\s*(\d{4}-\d{2}-\d{2})(?:\]?)|due:(\d{4}-\d{2}-\d{2})/i;
const PRIORITY_HIGH_REGEX = /(?:🔺|⏫|\[p1\]|!high)/i;
const PRIORITY_MED_REGEX = /(?:🔼|\[p2\]|!medium)/i;
const PRIORITY_LOW_REGEX = /(?:🔽|\[p3\]|!low)/i;
const TASK_ID_REGEX = /<!--\s*noa-task:([A-Za-z0-9_-]+)\s*-->/;

type ParsedTaskLine = {
  index: number;
  marker: string;
  completed: boolean;
  content: string;
  taskId?: string;
  originalLine: string;
  occurrenceIndex: number;
};

function parseTaskLine(line: string, index: number, occurrenceMap: Map<string, number>): ParsedTaskLine | null {
  const match = line.match(TASK_REGEX);
  if (!match) return null;

  const marker = match[1].trim();
  const isCompleted = match[2].toLowerCase() === 'x';
  const rawText = match[3];
  const taskIdMatch = rawText.match(TASK_ID_REGEX);
  const taskId = taskIdMatch?.[1];

  let text = rawText.replace(TASK_ID_REGEX, '').trim();

  // Remove due-date tokens from task content.
  const dueMatch = text.match(DUE_REGEX);
  if (dueMatch) {
    text = text.replace(DUE_REGEX, '').trim();
  }

  // Remove priority tokens from task content.
  if (PRIORITY_HIGH_REGEX.test(text)) {
    text = text.replace(PRIORITY_HIGH_REGEX, '').trim();
  } else if (PRIORITY_MED_REGEX.test(text)) {
    text = text.replace(PRIORITY_MED_REGEX, '').trim();
  } else if (PRIORITY_LOW_REGEX.test(text)) {
    text = text.replace(PRIORITY_LOW_REGEX, '').trim();
  }

  const occurrenceKey = `${text}::${isCompleted ? 'done' : 'todo'}`;
  const occurrenceIndex = occurrenceMap.get(occurrenceKey) ?? 0;
  occurrenceMap.set(occurrenceKey, occurrenceIndex + 1);

  return {
    index,
    marker,
    completed: isCompleted,
    content: text.trim(),
    taskId,
    originalLine: line,
    occurrenceIndex,
  };
}

function toggleCheckbox(line: string, completed: boolean): string {
  return completed ? line.replace(/\[x\]/i, '[ ]') : line.replace('[ ]', '[x]');
}

function withTaskId(line: string): string {
  if (TASK_ID_REGEX.test(line)) return line;
  return `${line} <!-- noa-task:${crypto.randomUUID()} -->`;
}

export function toggleTaskInNoteContent(content: string, task: GlobalTask): { updatedContent: string; updated: boolean } {
  const lines = content.split('\n');
  const occurrenceMap = new Map<string, number>();
  const parsedLines = lines
    .map((line, index) => parseTaskLine(line, index, occurrenceMap))
    .filter((item): item is ParsedTaskLine => Boolean(item));

  let target = task.taskId
    ? parsedLines.find((item) => item.taskId === task.taskId)
    : undefined;

  if (!target) {
    // Fallback for legacy tasks: same text + state + occurrence + structure marker.
    target = parsedLines.find(
      (item) =>
        item.content === task.content &&
        item.completed === task.completed &&
        item.occurrenceIndex === task.occurrenceIndex &&
        item.marker === task.originalString.match(TASK_REGEX)?.[1].trim(),
    );
  }

  if (!target) {
    // Fallback for legacy tasks where marker shape changed (e.g. "-" -> "*").
    target = parsedLines.find(
      (item) =>
        item.content === task.content &&
        item.completed === task.completed &&
        item.occurrenceIndex === task.occurrenceIndex,
    );
  }

  if (!target) {
    // Last fallback: exact previous line.
    target = parsedLines.find((item) => item.originalLine === task.originalString);
  }

  if (!target) {
    return { updatedContent: content, updated: false };
  }

  const toggled = toggleCheckbox(lines[target.index], task.completed);
  lines[target.index] = withTaskId(toggled);
  return { updatedContent: lines.join('\n'), updated: true };
}

export const parseTasksFromNotes = (notes: Note[]): GlobalTask[] => {
  const tasks: GlobalTask[] = [];

  notes.forEach((note) => {
    const lines = note.content.split('\n');
    const occurrenceMap = new Map<string, number>();

    lines.forEach((line, index) => {
      const parsed = parseTaskLine(line, index, occurrenceMap);
      if (!parsed) return;

      // Re-extract due date for parsed task payload.
      const dueMatch = line.match(DUE_REGEX);
      let dueDate: string | undefined;
      if (dueMatch) {
        const raw = dueMatch[1] || dueMatch[2];
        const parsedDate = new Date(raw);
        dueDate = Number.isNaN(parsedDate.getTime()) ? undefined : raw;
      }

      let priority: Priority = 'none';
      if (PRIORITY_HIGH_REGEX.test(line)) {
        priority = 'high';
      } else if (PRIORITY_MED_REGEX.test(line)) {
        priority = 'medium';
      } else if (PRIORITY_LOW_REGEX.test(line)) {
        priority = 'low';
      }

      tasks.push({
        id: `${note.id}-${index}`,
        noteId: note.id,
        noteTitle: note.title,
        content: parsed.content,
        taskId: parsed.taskId,
        completed: parsed.completed,
        dueDate,
        priority,
        lineIndex: index,
        occurrenceIndex: parsed.occurrenceIndex,
        originalString: line,
      });
    });
  });

  // Default sort: incomplete first, high priority first, due date first
  return tasks.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;

    const priorityWeight = { high: 3, medium: 2, low: 1, none: 0 };
    if (priorityWeight[a.priority] !== priorityWeight[b.priority]) {
      return priorityWeight[b.priority] - priorityWeight[a.priority];
    }

    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;

    return 0;
  });
};
