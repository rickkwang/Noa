import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const electronMainPath = fileURLToPath(new URL('../../electron/main.cjs', import.meta.url));

describe('macOS traffic-light position', () => {
  it('aligns with the sidebar’s original menu rail', async () => {
    const electronMain = await readFile(electronMainPath, 'utf8');

    expect(electronMain).toContain('trafficLightPosition: isMac ? { x: 12, y: 9 } : undefined,');
    expect(electronMain).not.toContain('setWindowButtonPosition');
  });
});
