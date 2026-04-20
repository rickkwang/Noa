import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { forceCollide, forceCenter } from 'd3-force';
import { Note, AppSettings } from '../types';
import { useIsDark } from '../hooks/useIsDark';
import { buildTitleToIdsMap, computeTopologySignature } from '../lib/noteUtils';

export type GraphColorMode = 'tag' | 'none';

interface GraphViewProps {
  notes: Note[];
  onNavigateToNoteById: (id: string) => void;
  settings: AppSettings;
  searchQuery?: string;
  activeNoteId?: string;
  width: number;
  height: number;
  hideIsolated?: boolean;
  localDepth?: number;
  tagFilter?: string[];
  colorMode?: GraphColorMode;
  sizeByDegree?: boolean;
}

const GRAPH_PERF_WARN_THRESHOLD = 200;
const PINNED_POSITIONS_KEY = 'noa-graph-pinned-positions-v1';

type PinnedPositions = Record<string, { x: number; y: number }>;

function loadPinnedPositions(): PinnedPositions {
  // Guarded for non-browser environments (SSR, tests without jsdom).
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PINNED_POSITIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function savePinnedPositions(positions: PinnedPositions) {
  try {
    localStorage.setItem(PINNED_POSITIONS_KEY, JSON.stringify(positions));
  } catch {
    /* quota exceeded or privacy mode — drop silently */
  }
}

// Tag palette — cycles through these for the first N unique tags
const TAG_PALETTE = [
  '#4A90E2', // blue
  '#50C878', // green
  '#E25C4A', // red-orange
  '#9B59B6', // purple
  '#E2A84A', // amber
  '#4AE2C8', // teal
  '#E24A8A', // pink
  '#A8E24A', // lime
];

type GraphNodeData = {
  id: string;
  name: string;
  degree: number;
  tags: string[];
};

type GraphLinkData = {
  bidirectional: boolean;
};

type GraphNode = NodeObject<GraphNodeData>;
type GraphLink = LinkObject<GraphNodeData, GraphLinkData>;

type TopologyNote = Pick<Note, 'id' | 'title' | 'links' | 'linkRefs' | 'tags'>;

function readLinkEndpointId(endpoint: GraphLink['source'] | GraphLink['target']): string {
  if (typeof endpoint === 'string' || typeof endpoint === 'number') return String(endpoint);
  return (endpoint?.id as string | undefined) ?? '';
}

function readLinkEndpointTitle(
  endpoint: GraphLink['source'] | GraphLink['target'],
  idToTitle: Map<string, string>
): string {
  if (typeof endpoint === 'string' || typeof endpoint === 'number') {
    return idToTitle.get(String(endpoint)) ?? String(endpoint);
  }
  return (endpoint?.name as string | undefined) ?? idToTitle.get(String(endpoint?.id ?? '')) ?? '';
}

function hasDistance(force: unknown): force is { distance: (value: number) => void } {
  return Boolean(force) && typeof (force as { distance?: unknown }).distance === 'function';
}

function hasStrength(force: unknown): force is { strength: (value: number) => void } {
  return Boolean(force) && typeof (force as { strength?: unknown }).strength === 'function';
}

// Node radius: log-scaled by degree (Obsidian-like).
// sizeByDegree=false → fixed 5px (legacy mode).
function nodeRadius(degree: number, sizeByDegree: boolean): number {
  if (!sizeByDegree) return 5;
  // log1p(degree) maps 0→0, 1→0.69, 5→1.79, 20→3.04, 50→3.93
  return Math.min(9, 3 + Math.log1p(degree) * 1.6);
}

export default function GraphView({
  notes,
  onNavigateToNoteById,
  settings,
  searchQuery = '',
  activeNoteId,
  width,
  height,
  hideIsolated = false,
  localDepth = 0,
  tagFilter,
  colorMode = 'tag',
  sizeByDegree = true,
}: GraphViewProps) {
  const isDark = useIsDark(settings.appearance.theme);
  const fgRef = useRef<ForceGraphMethods<GraphNodeData, GraphLinkData> | undefined>(undefined);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const isDraggingNodeRef = useRef(false);
  const initialPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  // Lazy init so the localStorage read happens exactly once on first render,
  // not at module import time (import is too early for SSR/tests).
  const pinnedPositionsRef = useRef<PinnedPositions | null>(null);
  if (pinnedPositionsRef.current === null) {
    pinnedPositionsRef.current = loadPinnedPositions();
  }

  const topologyNotes = useMemo(
    () => notes.map((note) => ({
      id: note.id,
      title: note.title,
      links: note.links ?? [],
      linkRefs: note.linkRefs ?? [],
      tags: note.tags ?? [],
    })),
    [notes]
  );
  const topologyKey = useMemo(
    () => computeTopologySignature(topologyNotes),
    [topologyNotes]
  );
  const stableTopologyRef = useRef<{ key: string; notes: TopologyNote[] }>({ key: '', notes: [] });
  if (stableTopologyRef.current.key !== topologyKey) {
    stableTopologyRef.current = { key: topologyKey, notes: topologyNotes };
  }

  const bgColor   = isDark ? '#262624' : '#EAE8E0';
  const linkColor = isDark ? '#8A8070' : '#9A9080';
  const textColor = isDark ? '#E8E0D0' : '#2D2D2D';

  const accentColors: Record<string, string> = {
    gold: '#B89B5E', blue: '#4A90E2', green: '#50E3C2', purple: '#9013FE', red: '#D0021B',
  };
  const nodeColor = accentColors[settings.appearance.accentColor] ?? settings.appearance.accentColor ?? '#B89B5E';

  // Build tag → color map (first tag per note wins; ordered by first appearance)
  const tagColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const note of topologyNotes) {
      for (const tag of note.tags ?? []) {
        if (!map.has(tag)) {
          map.set(tag, TAG_PALETTE[map.size % TAG_PALETTE.length]);
        }
      }
    }
    return map;
  }, [topologyNotes]);

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const nodeMap = new Map<string, GraphNode>();
    const degreeMap = new Map<string, number>();
    const topNotes = stableTopologyRef.current.notes;
    const titleToIds = buildTitleToIdsMap(topNotes);

    const pinnedMap = pinnedPositionsRef.current ?? {};
    // Lazy prune: drop pinned entries for notes that no longer exist so
    // localStorage doesn't grow unbounded as notes are deleted over time.
    const liveIds = new Set(topNotes.map((n) => n.id));
    let prunedAny = false;
    for (const id of Object.keys(pinnedMap)) {
      if (!liveIds.has(id)) {
        delete pinnedMap[id];
        prunedAny = true;
      }
    }
    if (prunedAny) savePinnedPositions(pinnedMap);
    topNotes.forEach(note => {
      const node: GraphNode = { id: note.id, name: note.title, degree: 0, tags: note.tags ?? [] };
      // Re-pin nodes the user has previously dragged so their layout survives reloads.
      const pinned = pinnedMap[note.id];
      if (pinned) {
        node.x = pinned.x;
        node.y = pinned.y;
        node.fx = pinned.x;
        node.fy = pinned.y;
      }
      nodes.push(node);
      nodeMap.set(note.id, node);
      degreeMap.set(note.id, 0);
    });

    const edgeSet = new Set<string>();
    const edgeMap = new Map<string, GraphLink>();

    topNotes.forEach(note => {
      const targetIds = new Set<string>();
      // linkRefs is the resolved source of truth (maintained by syncLinkRefs).
      // We also fall back to title resolution via `links` so edges appear
      // instantly after a content edit, before the async linkRefs pass runs.
      // The Set + edgeSet below dedupe the two sources so no duplicate edges
      // can slip through, even if both contain the same target.
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
        if (nodeMap.has(targetId)) {
          const edgeKey = [note.id, targetId].sort().join('→');
          if (!edgeSet.has(edgeKey)) {
            edgeSet.add(edgeKey);
            const nextLink: GraphLink = { source: note.id, target: targetId, bidirectional: false };
            links.push(nextLink);
            edgeMap.set(edgeKey, nextLink);
          } else {
            const existing = edgeMap.get(edgeKey);
            if (existing) existing.bidirectional = true;
          }
          degreeMap.set(targetId, (degreeMap.get(targetId) ?? 0) + 1);
          degreeMap.set(note.id, (degreeMap.get(note.id) ?? 0) + 1);
        }
      });
    });

    nodes.forEach(n => {
      n.degree = degreeMap.get(String(n.id)) ?? 0;
    });

    // Tag filter (any-of). Empty/undefined → no restriction.
    const activeTagSet = tagFilter && tagFilter.length > 0 ? new Set(tagFilter) : null;
    let keepIds: Set<string> | null = null;
    if (activeTagSet) {
      keepIds = new Set(
        nodes.filter((n) => (n.tags ?? []).some((t) => activeTagSet.has(t))).map((n) => String(n.id))
      );
    }

    // Local graph: BFS from active note up to localDepth hops.
    if (localDepth > 0 && activeNoteId && nodeMap.has(activeNoteId)) {
      // Build adjacency from (already deduped) links.
      const adj = new Map<string, Set<string>>();
      for (const link of links) {
        const s = readLinkEndpointId(link.source);
        const t = readLinkEndpointId(link.target);
        if (!adj.has(s)) adj.set(s, new Set());
        if (!adj.has(t)) adj.set(t, new Set());
        adj.get(s)!.add(t);
        adj.get(t)!.add(s);
      }
      const reach = new Set<string>([activeNoteId]);
      let frontier: string[] = [activeNoteId];
      for (let d = 0; d < localDepth; d++) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const nb of adj.get(id) ?? []) {
            if (!reach.has(nb)) {
              reach.add(nb);
              next.push(nb);
            }
          }
        }
        frontier = next;
        if (frontier.length === 0) break;
      }
      keepIds = keepIds ? new Set([...keepIds].filter((id) => reach.has(id))) : reach;
      // Always keep the active node itself even if tag filter would have excluded it.
      keepIds.add(activeNoteId);
    }

    let filteredNodes = keepIds ? nodes.filter((n) => keepIds!.has(String(n.id))) : nodes;
    if (hideIsolated) filteredNodes = filteredNodes.filter((n) => n.degree > 0);
    const nodeSet = new Set(filteredNodes.map((n) => String(n.id)));
    const filteredLinks = links.filter(
      (link) => nodeSet.has(readLinkEndpointId(link.source)) && nodeSet.has(readLinkEndpointId(link.target))
    );

    return { nodes: filteredNodes, links: filteredLinks };
  }, [hideIsolated, topologyKey, localDepth, activeNoteId, tagFilter]);

  // Build neighbour set for hovered node
  const hoveredNeighbours = useMemo(() => {
    if (!hoveredNodeId) return null;
    const neighbours = new Set<string>([hoveredNodeId]);
    for (const link of graphData.links) {
      const src = readLinkEndpointId(link.source);
      const tgt = readLinkEndpointId(link.target);
      if (src === hoveredNodeId) neighbours.add(tgt);
      if (tgt === hoveredNodeId) neighbours.add(src);
    }
    return neighbours;
  }, [hoveredNodeId, graphData.links]);

  // Dynamic physics based on node count
  useEffect(() => {
    if (!fgRef.current) return;
    const n = graphData.nodes.length;
    const cx = width / 2;
    const cy = height / 2;

    // Repulsion: breathing room without scattering
    const chargeForce = fgRef.current.d3Force('charge');
    if (hasStrength(chargeForce)) {
      chargeForce.strength(n > 100 ? -130 : n > 30 ? -95 : -60);
    }
    // Link distance: short lines, tight graph
    const linkForce = fgRef.current.d3Force('link');
    if (hasDistance(linkForce)) {
      linkForce.distance(n > 100 ? 40 : n > 30 ? 30 : 22);
    }
    if (hasStrength(linkForce)) {
      linkForce.strength(0.7);
    }
    // Collide: minimal padding, let link distance do the spacing
    const collide = forceCollide((node: GraphNode) => nodeRadius(node.degree ?? 0, sizeByDegree) + 3).iterations(3);
    fgRef.current.d3Force('collide', collide);
    // Center force: holds the graph together without crushing it
    fgRef.current.d3Force('center', forceCenter(cx, cy).strength(0.3));
    fgRef.current.d3Force('radial', null);
  }, [graphData.nodes.length, width, height]);

  useEffect(() => {
    if (!fgRef.current) return;
    initialPositions.current = new Map();
    let innerTimer: ReturnType<typeof setTimeout> | undefined;
    let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
    let isActive = true;
    const timer = setTimeout(() => {
      if (!isActive) return;
      fgRef.current?.zoomToFit(300, 24);
      // Cap zoom for small graphs so a single node doesn't fill the canvas
      innerTimer = setTimeout(() => {
        if (!isActive) return;
        const cur = fgRef.current?.zoom();
        if (cur != null && cur > 2) fgRef.current?.zoom(2, 200);
      }, 350);
      // Save initial positions after layout has settled
      snapshotTimer = setTimeout(() => {
        if (!isActive) return;
        const snapshot = new Map<string, { x: number; y: number }>();
        graphData.nodes.forEach((node) => {
          if (node.x != null && node.y != null) snapshot.set(String(node.id), { x: node.x, y: node.y });
        });
        initialPositions.current = snapshot;
      }, 1000);
    }, 600);
    return () => {
      isActive = false;
      clearTimeout(timer);
      clearTimeout(innerTimer);
      clearTimeout(snapshotTimer);
    };
  }, [graphData]);

  const lowerSearch = searchQuery.toLowerCase().trim();
  const idToTitle = useMemo(
    () => new Map(graphData.nodes.map((node) => [String(node.id), node.name])),
    [graphData.nodes]
  );

  const fontFamily = settings.appearance.fontFamily === 'font-iosevka' ? '"Iosevka Nerd Font Mono", "Iosevka NF", monospace' :
                     settings.appearance.fontFamily === 'font-redaction' ? '"Redaction 50", serif' :
                     settings.appearance.fontFamily === 'font-pixelify' ? '"Pixelify Sans", sans-serif' :
                     settings.appearance.fontFamily === 'font-work-sans' ? '"Work Sans", sans-serif' :
                     settings.appearance.fontFamily;

  // Pick node fill color: tag color > accent (connected) > grey (isolated)
  const getNodeColor = useCallback((node: GraphNode): string => {
    if (colorMode === 'tag') {
      const tags: string[] = node.tags ?? [];
      for (const tag of tags) {
        const c = tagColorMap.get(tag);
        if (c) return c;
      }
    }
    return (node.degree ?? 0) > 0 ? nodeColor : (isDark ? '#5A5648' : '#B0AA9E');
  }, [tagColorMap, nodeColor, isDark, colorMode]);

  const zoomControls = [
    { icon: <ZoomIn size={12} />, title: 'Zoom in', action: () => { const cur = fgRef.current?.zoom(); if (cur != null) fgRef.current?.zoom(cur * 1.3, 200); } },
    { icon: <ZoomOut size={12} />, title: 'Zoom out', action: () => { const cur = fgRef.current?.zoom(); if (cur != null) fgRef.current?.zoom(cur * 0.77, 200); } },
    { icon: <Maximize2 size={12} />, title: 'Reset view', action: () => {
      const snapshot = initialPositions.current;
      if (snapshot.size === 0) { fgRef.current?.zoomToFit(300, 24); return; }
      const duration = 500;
      const start = performance.now();
      const from = new Map(graphData.nodes.map((n) => [String(n.id), { x: n.x ?? 0, y: n.y ?? 0 }]));
      // Silence forces so they don't fight the animation.
      const chargeForce = fgRef.current?.d3Force('charge');
      const linkForce = fgRef.current?.d3Force('link');
      if (hasStrength(chargeForce)) chargeForce.strength(0);
      if (hasStrength(linkForce)) linkForce.strength(0);
      // Pin all nodes and reheat so simulation keeps rendering each frame.
      graphData.nodes.forEach((n) => { n.fx = n.x; n.fy = n.y; });
      fgRef.current?.d3ReheatSimulation();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const ease = 1 - Math.pow(1 - t, 3);
        graphData.nodes.forEach((node) => {
          const f = from.get(String(node.id));
          const target = snapshot.get(String(node.id));
          if (!f || !target) return;
          node.fx = f.x + (target.x - f.x) * ease;
          node.fy = f.y + (target.y - f.y) * ease;
        });
        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          // Restore forces, unpin nodes, done.
          const n = graphData.nodes.length;
          if (hasStrength(chargeForce)) chargeForce.strength(n > 100 ? -130 : n > 30 ? -95 : -60);
          if (hasStrength(linkForce)) linkForce.strength(0.7);
          graphData.nodes.forEach((node) => { node.fx = undefined; node.fy = undefined; });
          // User asked to reset the layout — discard persisted pins as well so
          // the next reload doesn't re-pin nodes to their old drag positions.
          if (pinnedPositionsRef.current) {
            for (const k of Object.keys(pinnedPositionsRef.current)) {
              delete pinnedPositionsRef.current[k];
            }
          }
          savePinnedPositions({});
          fgRef.current?.zoomToFit(300, 24);
        }
      };
      requestAnimationFrame(tick);
    }},
  ];

  return (
    <div className="relative w-full h-full">
      {graphData.nodes.length > GRAPH_PERF_WARN_THRESHOLD && (
        <div className="absolute top-2 left-2 right-2 z-10 border border-[#B89B5E]/60 bg-[#EAE8E0]/90 px-3 py-1.5 text-[11px] text-[#2D2D2D]/70 font-redaction flex items-center justify-between">
          <span>Graph contains {graphData.nodes.length} nodes and may render slowly. Try enabling "Hide isolated nodes".</span>
        </div>
      )}
      <ForceGraph2D
        ref={fgRef}
        width={width}
        height={height}
        graphData={graphData}
        nodeLabel="name"
        backgroundColor={bgColor}
        linkColor={(link: GraphLink) => {
          const src = readLinkEndpointId(link.source);
          const tgt = readLinkEndpointId(link.target);
          if (hoveredNeighbours) {
            if (!hoveredNeighbours.has(src) && !hoveredNeighbours.has(tgt)) return `${linkColor}20`;
            return link.bidirectional ? nodeColor : linkColor;
          }
          if (lowerSearch) {
            const srcMatch = readLinkEndpointTitle(link.source, idToTitle).toLowerCase().includes(lowerSearch);
            const tgtMatch = readLinkEndpointTitle(link.target, idToTitle).toLowerCase().includes(lowerSearch);
            if (!srcMatch && !tgtMatch) return `${linkColor}30`;
          }
          return link.bidirectional ? nodeColor : linkColor;
        }}
        linkWidth={(link: GraphLink) => {
          if (hoveredNeighbours) {
            const src = readLinkEndpointId(link.source);
            const tgt = readLinkEndpointId(link.target);
            if (hoveredNeighbours.has(src) && hoveredNeighbours.has(tgt)) {
              return link.bidirectional ? 3 : 2;
            }
            return 0.5;
          }
          return link.bidirectional ? 2.5 : 1.5;
        }}
        linkDirectionalArrowLength={(link: GraphLink) => link.bidirectional ? 0 : 4}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={(link: GraphLink) => {
          const src = readLinkEndpointId(link.source);
          const tgt = readLinkEndpointId(link.target);
          if (hoveredNeighbours && !hoveredNeighbours.has(src) && !hoveredNeighbours.has(tgt)) {
            return `${linkColor}20`;
          }
          return linkColor;
        }}
        onNodeClick={(node: GraphNode) => onNavigateToNoteById(String(node.id))}
        onNodeHover={(node: GraphNode | null) => setHoveredNodeId(node ? String(node.id) : null)}
        enableNodeDrag={true}
        // Read from ref inside interaction predicates to avoid drag-frame re-renders.
        enablePanInteraction={() => !isDraggingNodeRef.current}
        enableZoomInteraction={() => !isDraggingNodeRef.current}
        cooldownTicks={graphData.nodes.length > 200 ? 15 : graphData.nodes.length > 100 ? 20 : 30}
        cooldownTime={graphData.nodes.length > 200 ? 800 : 1500}
        d3AlphaDecay={graphData.nodes.length > 200 ? 0.08 : 0.04}
        d3VelocityDecay={graphData.nodes.length > 200 ? 0.8 : 0.7}
        onNodeDrag={() => {
          isDraggingNodeRef.current = true;
        }}
        onNodeDragEnd={(node: GraphNode) => {
          // Match the recommended force-graph pattern: pin the dragged node at its drop point.
          node.fx = node.x;
          node.fy = node.y;
          isDraggingNodeRef.current = false;
          // Persist so user-curated layouts survive reloads. Mutate in place
          // to avoid O(N) spread cost on large graphs.
          if (node.x != null && node.y != null && pinnedPositionsRef.current) {
            pinnedPositionsRef.current[String(node.id)] = { x: node.x, y: node.y };
            savePinnedPositions(pinnedPositionsRef.current);
          }
        }}
        onBackgroundClick={() => { isDraggingNodeRef.current = false; }}
        nodeCanvasObject={(node: GraphNode, ctx, globalScale) => {
          if (node.x == null || node.y == null) return;
          const degree = node.degree ?? 0;
          const radius = nodeRadius(degree, sizeByDegree);
          const isActive = activeNoteId && String(node.id) === activeNoteId;
          const isHovered = hoveredNodeId === String(node.id);
          const inHoverNeighbour = hoveredNeighbours ? hoveredNeighbours.has(String(node.id)) : true;

          const searchMatched = !lowerSearch || node.name.toLowerCase().includes(lowerSearch);
          const dimBySearch = lowerSearch && !searchMatched;
          const dimByHover = hoveredNeighbours && !inHoverNeighbour;

          const alpha = dimBySearch || dimByHover ? 0.08 : 1;

          ctx.save();
          ctx.globalAlpha = alpha;

          const fillColor = getNodeColor(node);

          // Outer glow ring for active or hovered node
          if ((isActive || isHovered) && node.x != null && node.y != null) {
            const glowRadius = radius + 5 / globalScale;
            try {
              const gradient = ctx.createRadialGradient(node.x, node.y, radius * 0.5, node.x, node.y, glowRadius);
              gradient.addColorStop(0, fillColor + '60');
              gradient.addColorStop(1, fillColor + '00');
              ctx.beginPath();
              ctx.arc(node.x, node.y, glowRadius, 0, 2 * Math.PI);
              ctx.fillStyle = gradient;
              ctx.fill();
            } catch {
              // skip glow if gradient params are invalid
            }
          }

          // Node fill
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
          ctx.fillStyle = fillColor;
          ctx.fill();

          // Border for active node
          if (isActive) {
            ctx.strokeStyle = textColor;
            ctx.lineWidth = 1.5 / globalScale;
            ctx.stroke();
          }

          // Label: smooth fade in based on globalScale, with text shadow for legibility
          const labelFadeStart = 0.5;
          const labelFadeEnd = 0.9;
          const labelAlpha = Math.min(1, Math.max(0, (globalScale - labelFadeStart) / (labelFadeEnd - labelFadeStart)));

          if (labelAlpha > 0) {
            const fontSize = Math.max(6, 8 / globalScale);
            ctx.font = `${fontSize}px ${fontFamily}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            const label = node.name;
            const labelX = node.x;
            const labelY = node.y + radius + 5 / globalScale;

            // Background halo for legibility
            ctx.globalAlpha = alpha * labelAlpha;
            ctx.shadowColor = bgColor;
            ctx.shadowBlur = 4;
            ctx.fillStyle = isDark ? '#E8E0D0' : '#2D2D2D';
            ctx.fillText(label, labelX, labelY);
            ctx.shadowBlur = 0;
          }

          ctx.restore();
        }}
        nodePointerAreaPaint={(node: GraphNode, color, ctx) => {
          if (node.x == null || node.y == null) return;
          const radius = nodeRadius(node.degree ?? 0, sizeByDegree);
          ctx.fillStyle = color;
          ctx.beginPath();
          // Slightly larger hit area makes node drags less likely to start a canvas pan.
          ctx.arc(node.x, node.y, radius + 8, 0, 2 * Math.PI);
          ctx.fill();
        }}
      />
      <div
        className="absolute bottom-2 right-2 flex flex-row gap-px backdrop-blur-sm"
        style={{ background: isDark ? 'rgba(240,237,230,0.07)' : 'rgba(45,45,45,0.06)', border: `1px solid ${isDark ? 'rgba(240,237,230,0.12)' : 'rgba(45,45,45,0.15)'}` }}
      >
        {zoomControls.map(({ icon, title, action }) => (
          <button
            key={title}
            onClick={action}
            title={title}
            className="w-7 h-6 active:opacity-70 flex items-center justify-center transition-colors"
            style={{ color: isDark ? 'rgba(240,237,230,0.45)' : 'rgba(45,45,45,0.5)' }}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
