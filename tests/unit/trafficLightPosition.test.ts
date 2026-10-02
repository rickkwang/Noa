import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const electronMainPath = fileURLToPath(new URL('../../electron/main.cjs', import.meta.url));

describe('macOS traffic-light position', () => {
  it('sits evenly inside the window corner, centred in the titlebar', async () => {
    const electronMain = await readFile(electronMainPath, 'utf8');

    expect(electronMain).toContain('trafficLightPosition: isMac ? { x: 15, y: 15 } : undefined,');
    expect(electronMain).not.toContain('setWindowButtonPosition');
  });
});
