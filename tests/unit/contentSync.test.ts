import { describe, expect, it } from 'vitest';
import { buildMinimalReplaceChange } from '../../src/components/editor/contentSync';

describe('buildMinimalReplaceChange', () => {
  it('returns null for unchanged content', () => {
    expect(buildMinimalReplaceChange('abc', 'abc')).toBeNull();
  });

  it('creates a minimal insertion change', () => {
    expect(buildMinimalReplaceChange('hello world', 'hello brave world')).toEqual({
      from: 6,
      to: 6,
      insert: 'brave ',
    });
  });

  it('creates a minimal deletion change', () => {
    expect(buildMinimalReplaceChange('hello brave world', 'hello world')).toEqual({
      from: 6,
      to: 12,
      insert: '',
    });
  });

  it('creates a minimal middle replacement change', () => {
    expect(buildMinimalReplaceChange('abc123xyz', 'abc456xyz')).toEqual({
      from: 3,
      to: 6,
      insert: '456',
    });
  });

  it('falls back to full replacement when no prefix/suffix matches', () => {
    expect(buildMinimalReplaceChange('foo', 'bar')).toEqual({
      from: 0,
      to: 3,
      insert: 'bar',
    });
  });
});
