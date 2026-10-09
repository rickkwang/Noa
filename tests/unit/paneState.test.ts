import { describe, expect, it } from 'vitest';
import { MAX_OPEN_PANES, parseOpenPanes, togglePane } from '../../src/lib/paneState';

describe('right-column pane state', () => {
  it('opens a second card beside the first and replaces the oldest past the cap', () => {
    const two = togglePane({ open: true, panes: ['tasks'] }, 'backlinks');
    expect(two).toEqual({ open: true, panes: ['tasks', 'backlinks'] });
    const three = togglePane(two, 'graph');
    expect(three.panes).toEqual(['backlinks', 'graph']);
    expect(three.panes).toHaveLength(MAX_OPEN_PANES);
  });

  it('closes one card, and collapses the column when the last one closes', () => {
    const one = togglePane({ open: true, panes: ['tasks', 'backlinks'] }, 'tasks');
    expect(one).toEqual({ open: true, panes: ['backlinks'] });
    // The last card stays remembered so the column can restore it.
    expect(togglePane(one, 'backlinks')).toEqual({ open: false, panes: ['backlinks'] });
  });

  it('opens a collapsed column on the pressed card alone', () => {
    expect(togglePane({ open: false, panes: ['tasks', 'backlinks'] }, 'graph'))
      .toEqual({ open: true, panes: ['graph'] });
    expect(togglePane({ open: false, panes: ['tasks', 'backlinks'] }, 'tasks'))
      .toEqual({ open: true, panes: ['tasks'] });
  });

  it('reads the saved list, and migrates the single tab stored before cards', () => {
    expect(parseOpenPanes('["graph","tasks"]', 'backlinks')).toEqual(['graph', 'tasks']);
    expect(parseOpenPanes(null, 'graph')).toEqual(['graph']);
    expect(parseOpenPanes(null, null)).toEqual(['tasks']);
    expect(parseOpenPanes('not json', 'outgoing')).toEqual(['outgoing']);
    expect(parseOpenPanes('["nope","graph","graph","tasks","backlinks"]', null)).toEqual(['tasks', 'backlinks']);
    expect(parseOpenPanes('[]', 'properties')).toEqual(['properties']);
  });
});
