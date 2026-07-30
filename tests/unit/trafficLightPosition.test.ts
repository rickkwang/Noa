import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const electronMainPath = fileURLToPath(new URL('../../electron/main.cjs', import.meta.url));

describe('macOS traffic-light position', () => {
  it('leaves the position to macOS defaults', async () => {
    const electronMain = await readFile(electronMainPath, 'utf8');

    expect(electronMain).not.toContain('trafficLightPosition:');
    expect(electronMain).not.toContain('setWindowButtonPosition');
  });
});
