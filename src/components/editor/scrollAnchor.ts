export interface ScrollAnchor {
  lineIndex: number;
  progress: number;
  top?: boolean;
}

const BLOCK_SELECTOR = '[data-source-line][data-source-end-line]';
const CHUNK_SELECTOR = '[data-preview-chunk]';

function clampProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
}

function sourceLine(block: HTMLElement): number {
  return Number(block.dataset.sourceLine);
}

function blockForLine(container: HTMLElement, lineIndex: number): HTMLElement | undefined {
  const blocks = Array.from(container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  return blocks.find(block => Number(block.dataset.sourceEndLine) >= lineIndex) ?? blocks.at(-1);
}

// Measure chunks through the target so placeholder heights do not offset distant anchors.
function measureThroughBlock(container: HTMLElement, block: HTMLElement): void {
  const targetChunk = block.closest<HTMLElement>(CHUNK_SELECTOR);
  if (!targetChunk) return;
  const chunks: { element: HTMLElement; visibility: string }[] = [];
  for (const element of container.querySelectorAll<HTMLElement>(CHUNK_SELECTOR)) {
    chunks.push({ element, visibility: element.style.contentVisibility });
    element.style.contentVisibility = 'visible';
    if (element === targetChunk) break;
  }
  const heights = chunks.map(({ element }) => element.getBoundingClientRect().height);
  chunks.forEach(({ element, visibility }, index) => {
    // Retain measured placeholder heights when restoring automatic content visibility.
    element.style.containIntrinsicSize = `auto ${heights[index]}px`;
    element.style.contentVisibility = visibility;
  });
}

function scrollToBlock(container: HTMLElement, block: HTMLElement, progress: number): void {
  measureThroughBlock(container, block);
  const rect = block.getBoundingClientRect();
  const viewportTop = container.getBoundingClientRect().top + container.clientTop;
  container.scrollTop += rect.top - viewportTop + rect.height * clampProgress(progress);
}

export function getPreviewScrollAnchor(container: HTMLElement): ScrollAnchor {
  const viewportTop = container.getBoundingClientRect().top + container.clientTop;
  const chunks = Array.from(container.querySelectorAll<HTMLElement>(CHUNK_SELECTOR));
  // Only measure the chunk at the viewport top, leaving other chunks lazily laid out.
  const scope = chunks.find(chunk => chunk.getBoundingClientRect().bottom > viewportTop) ?? chunks.at(-1) ?? container;
  const blocks = Array.from(scope.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const rect = block.getBoundingClientRect();
    if (rect.bottom <= viewportTop && index < blocks.length - 1) continue;
    const start = sourceLine(block);
    const lineCount = Math.max(1, Number(block.dataset.sourceEndLine) - start + 1);
    const offset = (rect.height > 0 ? clampProgress((viewportTop - rect.top) / rect.height) : 0) * lineCount;
    const lineOffset = Math.min(lineCount - 1, Math.floor(offset));
    return {
      lineIndex: start + lineOffset,
      progress: offset - lineOffset,
      ...(container.scrollTop <= 0 ? { top: true } : {}),
    };
  }
  return { lineIndex: 0, progress: 0, ...(container.scrollTop <= 0 ? { top: true } : {}) };
}

export function restorePreviewScrollAnchor(container: HTMLElement, anchor: ScrollAnchor): void {
  if (anchor.top) {
    container.scrollTop = 0;
    return;
  }
  const block = blockForLine(container, anchor.lineIndex);
  if (!block) return;
  const start = sourceLine(block);
  const lineCount = Number(block.dataset.sourceEndLine) - start + 1;
  scrollToBlock(container, block, (anchor.lineIndex - start + clampProgress(anchor.progress)) / Math.max(1, lineCount));
}

export function scrollPreviewToLine(container: HTMLElement, lineIndex: number): void {
  const block = blockForLine(container, lineIndex);
  if (!block) return;
  const start = sourceLine(block);
  const lineCount = Number(block.dataset.sourceEndLine) - start + 1;
  scrollToBlock(container, block, (lineIndex - start) / Math.max(1, lineCount));
}
