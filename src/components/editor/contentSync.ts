export interface TextReplaceChange {
  from: number;
  to: number;
  insert: string;
}

export function buildMinimalReplaceChange(currentDoc: string, nextDoc: string): TextReplaceChange | null {
  if (currentDoc === nextDoc) return null;

  let prefix = 0;
  const maxPrefix = Math.min(currentDoc.length, nextDoc.length);
  while (prefix < maxPrefix && currentDoc.charCodeAt(prefix) === nextDoc.charCodeAt(prefix)) {
    prefix += 1;
  }

  let suffix = 0;
  const maxSuffix = Math.min(currentDoc.length - prefix, nextDoc.length - prefix);
  while (
    suffix < maxSuffix
    && currentDoc.charCodeAt(currentDoc.length - 1 - suffix) === nextDoc.charCodeAt(nextDoc.length - 1 - suffix)
  ) {
    suffix += 1;
  }

  return {
    from: prefix,
    to: currentDoc.length - suffix,
    insert: nextDoc.slice(prefix, nextDoc.length - suffix),
  };
}
