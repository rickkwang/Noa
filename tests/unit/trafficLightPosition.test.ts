import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const electronMainPath = fileURLToPath(new URL('../../electron/main.cjs', import.meta.url));

describe('macOS traffic-light position', () => {
  it('centres the close button on the sidebar icon rail and in the titlebar', async () => {
    const electronMain = await readFile(electronMainPath, 'utf8');

    expect(electronMain).toContain('const TRAFFIC_LIGHT_POSITION = { x: 15, y: 15 };');
    expect(electronMain).toContain('trafficLightPosition: isMac ? TRAFFIC_LIGHT_POSITION : undefined,');
    // Runtime repositioning is only for page zoom, not re-applied on show/fullscreen.
    expect(electronMain).not.toMatch(/win\.on\('(show|enter-full-screen|leave-full-screen)'/);
  });
});
