/* The browser's default drag ghost is a snapshot of the row element, and a
   sidebar row is a full-width flex container: the ghost comes out as a wide
   slab of empty space, carrying whatever the row happened to be showing at
   mousedown — including the hover-only delete button — and with the title
   still clipped by the row's own `truncate`. This builds a compact chip
   instead — icon plus the full label, sized to its text — the way Obsidian
   builds its own `.drag-ghost` rather than dragging the row. */

const ICONS = {
  note: '<path d="M8.25 1.75H4a1 1 0 0 0-1 1v10.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6.5zM8.25 1.75V6.5H13" /><path d="M5.5 9h5M5.5 11.25h3.5" />',
  folder: '<path d="M2 12.75v-9.5a.5.5 0 0 1 .5-.5h3.2a.5.5 0 0 1 .4.2l1.1 1.45a.5.5 0 0 0 .4.2h5.9a.5.5 0 0 1 .5.5v7.65a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5Z" />',
};

export function setTreeItemDragImage(
  e: React.DragEvent,
  kind: 'note' | 'folder',
  label: string,
) {
  const row = e.currentTarget;
  const doc = row.ownerDocument;
  const view = doc.defaultView;
  if (!view || typeof e.dataTransfer.setDragImage !== 'function') return;

  const rowStyle = view.getComputedStyle(row);
  const ghost = doc.createElement('div');
  ghost.setAttribute('aria-hidden', 'true');
  // Surface, padding and radius live in `.noa-tree-drag-ghost` (index.css) so
  // the dark theme can adjust them; only the type is copied from the row, so
  // the chip is set in whatever face the user picked.
  ghost.className = 'noa-tree-drag-ghost';
  ghost.style.fontFamily = rowStyle.fontFamily;
  ghost.style.fontSize = rowStyle.fontSize;
  // Off-screen but laid out: setDragImage has to be able to rasterise it.
  ghost.style.top = '-1000px';
  ghost.style.left = '-1000px';

  const icon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto;opacity:0.7">${ICONS[kind]}</svg>`;
  ghost.innerHTML = `${icon}<span style="overflow:hidden;text-overflow:ellipsis"></span>`;
  // Label is user content — never interpolated into the markup above.
  ghost.lastElementChild!.textContent = label;

  doc.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 14, ghost.offsetHeight / 2);
  view.setTimeout(() => ghost.remove(), 0);
}
