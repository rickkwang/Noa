import { describe, expect, it } from 'vitest';
import { bodyCaretTarget } from '../../src/components/editor/bodyCaret';

describe('bodyCaretTarget', () => {
  it('lands after the space of the first empty task line', () => {
    const doc = "## Today's Focus\n- [ ] \n\n## Notes\n";
    expect(bodyCaretTarget(doc)).toEqual({ anchor: doc.indexOf('- [ ] ') + '- [ ] '.length });
  });

  it('adds the missing space when the line was saved without one', () => {
    const doc = '## Focus\n- [ ]\n\nmore';
    const lineEnd = doc.indexOf('- [ ]') + '- [ ]'.length;
    expect(bodyCaretTarget(doc)).toEqual({ anchor: lineEnd + 1, insert: ' ' });
  });

  it('skips tasks that already have text and falls back to the end', () => {
    const doc = '- [ ] written\n- [x] done\n';
    expect(bodyCaretTarget(doc)).toEqual({ anchor: doc.length });
  });
});
