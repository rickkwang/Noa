import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const graphViewPath = new URL('../../src/components/GraphView.tsx', import.meta.url);

describe('graph layout lifecycle', () => {
  it('captures the initial layout from the force-engine completion signal', async () => {
    const source = await readFile(graphViewPath, 'utf8');

    expect(source).toContain('onEngineStop={captureInitialLayout}');
    expect(source).not.toContain('const timer = setTimeout(() => {');
    expect(source).not.toContain('snapshotTimer = setTimeout(() => {');
  });
});
