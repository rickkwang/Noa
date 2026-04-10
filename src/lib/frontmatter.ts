export function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = parseFrontmatterBlock(match[1]);
  return { meta, body: match[2] };
}

export function parseFrontmatterBlock(block: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const lines = block.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx <= 0) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      meta[key] = rawValue
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
        .join(', ');
      continue;
    }

    if (rawValue === '') {
      const listItems: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const itemMatch = lines[j].match(/^\s*-\s+(.+)$/);
        if (!itemMatch) break;
        listItems.push(itemMatch[1].trim().replace(/^["']|["']$/g, ''));
        j += 1;
      }
      meta[key] = listItems.join(', ');
      i = j - 1;
      continue;
    }

    meta[key] = rawValue.replace(/^["']|["']$/g, '');
  }

  return meta;
}

function yamlValue(v: string): string {
  // Quote values that contain characters which break simple YAML parsing
  if (/[:#\n\r"']/.test(v) || v.startsWith(' ') || v.endsWith(' ')) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
  }
  return v;
}

export function stringifyFrontmatter(meta: Record<string, string>, body: string): string {
  const entries = Object.entries(meta).map(([k, v]) => `${k}: ${yamlValue(v)}`).join('\n');
  if (!entries) return body;
  return `---\n${entries}\n---\n${body}`;
}

export function hasFrontmatter(content: string): boolean {
  return /^---\r?\n[\s\S]*?\r?\n---/.test(content);
}

/**
 * Extract tags from Obsidian frontmatter.
 * Supports both inline array (`tags: [a, b]`) and YAML list (`tags:\n  - a`) formats.
 * Returns [] if no tags field is found.
 */
export function extractObsidianTags(content: string): string[] {
  if (!hasFrontmatter(content)) return [];
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  const block = match[1];

  // Find the tags line
  const lines = block.split(/\r?\n/);
  const tagsLineIdx = lines.findIndex(l => /^tags\s*:/i.test(l));
  if (tagsLineIdx === -1) return [];

  const tagsLine = lines[tagsLineIdx];
  const afterColon = tagsLine.slice(tagsLine.indexOf(':') + 1).trim();

  // Inline array: tags: [a, b, c]
  if (afterColon.startsWith('[') && afterColon.endsWith(']')) {
    return afterColon.slice(1, -1).split(',')
      .map(s => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }

  // YAML list: tags:\n  - a\n  - b
  if (afterColon === '') {
    const tags: string[] = [];
    for (let i = tagsLineIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(/^\s+-\s+(.+)$/);
      if (!m) break;
      tags.push(m[1].trim().replace(/^["']|["']$/g, ''));
    }
    return tags;
  }

  // Single tag value
  return afterColon ? [afterColon.replace(/^["']|["']$/g, '')] : [];
}

/**
 * Try to extract a creation date from Obsidian frontmatter.
 * Reads `created`, `date_created`, or `date` fields (common Obsidian conventions).
 * Returns an ISO string if a valid date is found, otherwise null.
 * Never modifies the note content.
 */
export function extractObsidianCreatedAt(content: string): string | null {
  if (!hasFrontmatter(content)) return null;
  const { meta } = parseFrontmatter(content);
  const raw = meta['created'] ?? meta['date_created'] ?? meta['date'] ?? null;
  if (!raw) return null;
  // Strip surrounding quotes added by some Obsidian plugins
  const cleaned = raw.replace(/^["']|["']$/g, '').trim();
  const ts = Date.parse(cleaned);
  if (isNaN(ts)) return null;
  return new Date(ts).toISOString();
}
