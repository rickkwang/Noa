import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourcePath = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));

describe('task source navigation', () => {
  it('carries the parsed task line from the task panel into the editor', async () => {
    const [tasksPanel, rightPanel, app, editor] = await Promise.all([
      readFile(sourcePath('../../src/components/rightPanel/TasksPanel.tsx'), 'utf8'),
      readFile(sourcePath('../../src/components/RightPanel.tsx'), 'utf8'),
      readFile(sourcePath('../../src/App.tsx'), 'utf8'),
      readFile(sourcePath('../../src/components/Editor.tsx'), 'utf8'),
    ]);

    expect(tasksPanel).toContain('onNavigateToNoteById: (id: string, lineIndex?: number) => void;');
    expect(tasksPanel).toContain('onNavigateToNoteById(task.noteId, task.lineIndex)');
    expect(rightPanel).toContain('onNavigateToNoteById: (id: string, lineIndex?: number) => void;');
    expect(app).toContain('handleRightPanelNavigate = useCallback((id: string, lineIndex?: number)');
    expect(app).toContain('lineJumpRequest={editorLineJumpRequest}');
    expect(editor).toContain('jumpToLine(lineJumpRequest.lineIndex)');
    expect(editor).toContain('onLineJumpHandled?.(lineJumpRequest.requestId)');
  });
});
