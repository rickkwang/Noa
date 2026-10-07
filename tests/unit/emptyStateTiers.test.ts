import { describe, expect, it } from 'vitest';
import { tierForCount } from '../../src/components/emptyState/sceneParts';

describe('empty-state scene growth', () => {
  it.each([
    [0, 0], [1, 1], [9, 1], [10, 2], [49, 2], [50, 3], [199, 3], [200, 4], [499, 4], [500, 5], [12000, 5],
  ])('%i notes draws tier %i', (count, tier) => {
    expect(tierForCount(count)).toBe(tier);
  });
});
