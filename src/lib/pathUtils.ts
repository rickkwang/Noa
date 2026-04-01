export function getFolderParentPath(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

export function getFolderLeafName(path: string): string {
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] || path || 'Untitled Folder';
}

export function isDescendantPath(path: string, ancestorPath: string): boolean {
  if (path === ancestorPath) return true;
  const ancestorSegments = ancestorPath.split('/').filter(Boolean);
  const pathSegments = path.split('/').filter(Boolean);
  if (pathSegments.length <= ancestorSegments.length) return false;
  return ancestorSegments.every((segment, index) => pathSegments[index] === segment);
}
