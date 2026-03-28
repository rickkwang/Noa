export const extractLinks = (content: string): string[] => {
  const matches = Array.from(content.matchAll(/\[\[(.*?)\]\]/g));
  return Array.from(new Set(matches.map(m => m[1])));
};

export const extractTags = (content: string): string[] => {
  const matches = Array.from(content.matchAll(/(?<=^|\s)#([\w\u4e00-\u9fa5]+)/g));
  return Array.from(new Set(matches.map(m => m[1])));
};
