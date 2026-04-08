export function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta: Record<string, string> = {};
  match[1].split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      meta[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
    }
  });
  return { meta, body: match[2] };
}

export function stringifyFrontmatter(meta: Record<string, string>, body: string): string {
  const entries = Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join('\n');
  if (!entries) return body;
  return `---\n${entries}\n---\n${body}`;
}

export function hasFrontmatter(content: string): boolean {
  return /^---\r?\n[\s\S]*?\r?\n---/.test(content);
}
