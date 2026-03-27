import { Note, GlobalTask, Priority } from '../types';

export const parseTasksFromNotes = (notes: Note[]): GlobalTask[] => {
  const tasks: GlobalTask[] = [];
  
  // Matches Markdown task lists: "- [ ]", "* [x]", "+ [X]"
  // Group 1: leading whitespace + list marker + space
  // Group 2: checkbox content (space, x, or X)
  // Group 3: rest of the line
  const taskRegex = /^(\s*(?:-|\*|\+)\s+)\[( |x|X)\]\s+(.*)$/;
  
  // Matches dates: 📅 2026-03-25 or [due: 2026-03-25] or due:2026-03-25
  const dueRegex = /(?:📅|\[due:)\s*(\d{4}-\d{2}-\d{2})(?:\]?)|due:(\d{4}-\d{2}-\d{2})/i;

  const priorityHighRegex = /(?:🔺|⏫|\[p1\]|!high)/i;
  const priorityMedRegex = /(?:🔼|\[p2\]|!medium)/i;
  const priorityLowRegex = /(?:🔽|\[p3\]|!low)/i;

  notes.forEach(note => {
    const lines = note.content.split('\n');
    lines.forEach((line, index) => {
      const match = line.match(taskRegex);
      if (match) {
        const isCompleted = match[2].toLowerCase() === 'x';
        let text = match[3];

        // Extract due date
        let dueDate;
        const dueMatch = text.match(dueRegex);
        if (dueMatch) {
          const raw = dueMatch[1] || dueMatch[2];
          const parsed = new Date(raw);
          dueDate = isNaN(parsed.getTime()) ? undefined : raw;
          text = text.replace(dueRegex, '').trim();
        }

        // Extract priority
        let priority: Priority = 'none';
        if (priorityHighRegex.test(text)) {
          priority = 'high';
          text = text.replace(priorityHighRegex, '').trim();
        } else if (priorityMedRegex.test(text)) {
          priority = 'medium';
          text = text.replace(priorityMedRegex, '').trim();
        } else if (priorityLowRegex.test(text)) {
          priority = 'low';
          text = text.replace(priorityLowRegex, '').trim();
        }

        tasks.push({
          id: `${note.id}-${index}`,
          noteId: note.id,
          noteTitle: note.title,
          content: text.trim(), // Clean text without tags
          completed: isCompleted,
          dueDate,
          priority,
          lineIndex: index,
          originalString: line
        });
      }
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
