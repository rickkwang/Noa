import { Note } from '../types';
import { buildTitleToIdsMap } from './noteUtils';

export type GraphModelNote = Pick<Note, 'id' | 'title' | 'links' | 'linkRefs' | 'tags'>;

export interface GraphModelNode {
  id: string;
  title: string;
  degree: number;
  tags: string[];
}

export interface GraphModelLink {
  source: string;
  target: string;
  bidirectional: boolean;
}

export interface GraphModelOptions {
  activeNoteId?: string;
  hideIsolated?: boolean;
  localDepth?: number;
  tagFilter?: string[];
  searchQuery?: string;
}

export interface GraphModel {
  nodes: GraphModelNode[];
  links: GraphModelLink[];
  stats: {
    totalNotes: number;
    totalLinks: number;
    isolated: number;
    ranked: Array<[string, number]>;
    degreeMap: Map<string, number>;
  };
  activeConnections: string[];
}

const edgeKeyFor = (sourceId: string, targetId: string): string =>
  [sourceId, targetId].sort().join('\u2192');

const directionKeyFor = (sourceId: string, targetId: string): string =>
  `${sourceId}\u2192${targetId}`;

function intersectIds(left: Set<string> | null, right: Set<string>): Set<string> {
  return left ? new Set([...left].filter((id) => right.has(id))) : right;
}

export function buildGraphModel(notes: GraphModelNote[], options: GraphModelOptions = {}): GraphModel {
  const nodes = notes.map((note): GraphModelNode => ({
    id: note.id,
    title: note.title,
    degree: 0,
    tags: note.tags ?? [],
  }));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const degreeMap = new Map(nodes.map((node) => [node.id, 0]));
  const titleToIds = buildTitleToIdsMap(notes);
  const edgeMap = new Map<string, { source: string; target: string; directions: Set<string> }>();

  notes.forEach((note) => {
    const targetIds = new Set<string>();
    (note.linkRefs ?? []).forEach((id) => {
      if (nodeMap.has(id)) targetIds.add(id);
    });
    (note.links ?? []).forEach((linkTitle) => {
      const ids = titleToIds.get(linkTitle) ?? [];
      ids.forEach((id) => {
        if (nodeMap.has(id)) targetIds.add(id);
      });
    });

    targetIds.forEach((targetId) => {
      const edgeKey = edgeKeyFor(note.id, targetId);
      const directionKey = directionKeyFor(note.id, targetId);
      const existing = edgeMap.get(edgeKey);
      if (existing) {
        existing.directions.add(directionKey);
        return;
      }
      edgeMap.set(edgeKey, {
        source: note.id,
        target: targetId,
        directions: new Set([directionKey]),
      });
    });
  });

  const allLinks: GraphModelLink[] = [];
  edgeMap.forEach((edge) => {
    const reverseKey = directionKeyFor(edge.target, edge.source);
    const bidirectional = edge.source !== edge.target && edge.directions.has(reverseKey);
    allLinks.push({ source: edge.source, target: edge.target, bidirectional });
    degreeMap.set(edge.source, (degreeMap.get(edge.source) ?? 0) + 1);
    if (edge.target !== edge.source) {
      degreeMap.set(edge.target, (degreeMap.get(edge.target) ?? 0) + 1);
    }
  });

  nodes.forEach((node) => {
    node.degree = degreeMap.get(node.id) ?? 0;
  });

  const activeTagSet = options.tagFilter && options.tagFilter.length > 0 ? new Set(options.tagFilter) : null;
  let keepIds: Set<string> | null = null;
  if (activeTagSet) {
    keepIds = new Set(
      nodes
        .filter((node) => node.tags.some((tag) => activeTagSet.has(tag)))
        .map((node) => node.id)
    );
  }

  const searchTerm = options.searchQuery?.toLowerCase().trim() ?? '';
  if (searchTerm) {
    const matches = new Set(
      nodes
        .filter((node) =>
          node.title.toLowerCase().includes(searchTerm) ||
          node.tags.some((tag) => tag.toLowerCase().includes(searchTerm))
        )
        .map((node) => node.id)
    );
    keepIds = intersectIds(keepIds, matches);
  }

  if ((options.localDepth ?? 0) > 0 && options.activeNoteId && nodeMap.has(options.activeNoteId)) {
    const adj = new Map<string, Set<string>>();
    for (const link of allLinks) {
      if (!adj.has(link.source)) adj.set(link.source, new Set());
      if (!adj.has(link.target)) adj.set(link.target, new Set());
      adj.get(link.source)!.add(link.target);
      adj.get(link.target)!.add(link.source);
    }

    const reach = new Set<string>([options.activeNoteId]);
    let frontier: string[] = [options.activeNoteId];
    for (let depth = 0; depth < (options.localDepth ?? 0); depth += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const neighbour of adj.get(id) ?? []) {
          if (!reach.has(neighbour)) {
            reach.add(neighbour);
            next.push(neighbour);
          }
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    keepIds = intersectIds(keepIds, reach);
    keepIds.add(options.activeNoteId);
  }

  let visibleNodes = keepIds ? nodes.filter((node) => keepIds!.has(node.id)) : nodes;
  if (options.hideIsolated) {
    visibleNodes = visibleNodes.filter((node) =>
      node.degree > 0 || (options.localDepth ?? 0) > 0 && node.id === options.activeNoteId
    );
  }

  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleLinks = allLinks.filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target));
  const visibleDegreeMap = new Map(visibleNodes.map((node) => [node.id, 0]));
  visibleLinks.forEach((link) => {
    visibleDegreeMap.set(link.source, (visibleDegreeMap.get(link.source) ?? 0) + 1);
    if (link.target !== link.source) {
      visibleDegreeMap.set(link.target, (visibleDegreeMap.get(link.target) ?? 0) + 1);
    }
  });
  visibleNodes = visibleNodes.map((node) => ({
    ...node,
    degree: visibleDegreeMap.get(node.id) ?? 0,
  }));

  const isolated = visibleNodes.filter((node) => (visibleDegreeMap.get(node.id) ?? 0) === 0).length;
  const ranked = [...visibleDegreeMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .filter(([, degree]) => degree > 0);

  const activeConnections = options.activeNoteId && visibleIds.has(options.activeNoteId)
    ? [...new Set(visibleLinks.flatMap((link) => {
        if (link.source === options.activeNoteId) return [link.target];
        if (link.target === options.activeNoteId) return [link.source];
        return [];
      }))]
    : [];

  return {
    nodes: visibleNodes,
    links: visibleLinks,
    stats: {
      totalNotes: visibleNodes.length,
      totalLinks: visibleLinks.length,
      isolated,
      ranked,
      degreeMap: visibleDegreeMap,
    },
    activeConnections,
  };
}
