import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { forceCollide } from 'd3-force';
import { Note } from '../types';
import { AppSettings } from '../types';
import { useIsDark } from '../hooks/useIsDark';
import { buildTitleToIdsMap, computeTopologySignature } from '../lib/noteUtils';

interface GraphViewProps {
  notes: Note[];
  onNavigateToNoteById: (id: string) => void;
  settings: AppSettings;
  searchQuery?: string;
  activeNoteId?: string;
  width: number;
  height: number;
  hideIsolated?: boolean;
}

const GRAPH_PERF_WARN_THRESHOLD = 200;

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

// Node radius: more aggressive scaling so hub nodes stand out clearly
function nodeRadius(degree: number): number {
  return 3.5 + Math.sqrt(degree) * 2.5;
}

export default function GraphView({ notes, onNavigateToNoteById, settings, searchQuery = '', activeNoteId, width, height, hideIsolated = false }: GraphViewProps) {
  const isDark = useIsDark(settings.appearance.theme);
  const fgRef = useRef<ForceGraphMethods<GraphNodeData, GraphLinkData> | undefined>(undefined);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

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
    for (const note of stableTopologyRef.current.notes) {
      for (const tag of note.tags ?? []) {
        if (!map.has(tag)) {
          map.set(tag, TAG_PALETTE[map.size % TAG_PALETTE.length]);
        }
      }
    }
    return map;
  }, [topologyKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const nodeMap = new Map<string, GraphNode>();
    const degreeMap = new Map<string, number>();
    const topNotes = stableTopologyRef.current.notes;
    const titleToIds = buildTitleToIdsMap(topNotes);

    topNotes.forEach(note => {
      const node: GraphNode = { id: note.id, name: note.title, degree: 0, tags: note.tags ?? [] };
      nodes.push(node);
      nodeMap.set(note.id, node);
      degreeMap.set(note.id, 0);
    });

    const edgeSet = new Set<string>();
    const edgeMap = new Map<string, GraphLink>();

    topNotes.forEach(note => {
      const targetIds = new Set<string>();
      (note.linkRefs ?? []).forEach((id) => {
        if (nodeMap.has(id)) targetIds.add(id);
      });
      (note.links ?? []).forEach((linkTitle) => {
        const ids = titleToIds.get(linkTitle);
        if (ids && ids.length === 1 && nodeMap.has(ids[0])) targetIds.add(ids[0]);
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

    const filteredNodes = hideIsolated ? nodes.filter(n => n.degree > 0) : nodes;
    const nodeSet = new Set(filteredNodes.map((n) => String(n.id)));
    const filteredLinks = hideIsolated
      ? links.filter((link) => nodeSet.has(readLinkEndpointId(link.source)) && nodeSet.has(readLinkEndpointId(link.target)))
      : links;

    return { nodes: filteredNodes, links: filteredLinks };
  }, [hideIsolated, topologyKey]);

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
    const chargeForce = fgRef.current.d3Force('charge');
    if (hasStrength(chargeForce)) {
      // More nodes → stronger repulsion to spread things out
      chargeForce.strength(n > 100 ? -120 : n > 30 ? -80 : -50);
    }
    const linkForce = fgRef.current.d3Force('link');
    if (hasDistance(linkForce)) {
      linkForce.distance(n > 100 ? 60 : n > 30 ? 45 : 35);
    }
    const collide = forceCollide((node: GraphNode) => nodeRadius(node.degree ?? 0) + 4);
    fgRef.current.d3Force('collide', collide);
  }, [graphData.nodes.length]);

  useEffect(() => {
    if (!fgRef.current) return;
    const timer = setTimeout(() => {
      fgRef.current?.zoomToFit(300, 24);
    }, 600);
    return () => clearTimeout(timer);
  }, [graphData]);

  const lowerSearch = searchQuery.toLowerCase().trim();
  const idToTitle = useMemo(
    () => new Map(graphData.nodes.map((node) => [String(node.id), node.name])),
    [graphData.nodes]
  );

  const fontFamily = settings.appearance.fontFamily === 'font-redaction' ? '"Redaction 50", serif' :
                     settings.appearance.fontFamily === 'font-pixelify' ? '"Pixelify Sans", sans-serif' :
                     settings.appearance.fontFamily === 'font-work-sans' ? '"Work Sans", sans-serif' :
                     settings.appearance.fontFamily;

  // Pick node fill color: tag color > accent (connected) > grey (isolated)
  const getNodeColor = useCallback((node: GraphNode): string => {
    const tags: string[] = node.tags ?? [];
    for (const tag of tags) {
      const c = tagColorMap.get(tag);
      if (c) return c;
    }
    return (node.degree ?? 0) > 0 ? nodeColor : (isDark ? '#5A5648' : '#B0AA9E');
  }, [tagColorMap, nodeColor, isDark]);

  const zoomControls = [
    { icon: <ZoomIn size={12} />, title: 'Zoom in', action: () => { const cur = fgRef.current?.zoom(); if (cur != null) fgRef.current?.zoom(cur * 1.3, 200); } },
    { icon: <ZoomOut size={12} />, title: 'Zoom out', action: () => { const cur = fgRef.current?.zoom(); if (cur != null) fgRef.current?.zoom(cur * 0.77, 200); } },
    { icon: <Maximize2 size={12} />, title: 'Fit view', action: () => fgRef.current?.zoomToFit(300, 24) },
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
        onNodeDragEnd={(node: GraphNode) => {
          node.fx = node.x;
          node.fy = node.y;
        }}
        nodeCanvasObject={(node: GraphNode, ctx, globalScale) => {
          if (node.x == null || node.y == null) return;
          const degree = node.degree ?? 0;
          const radius = nodeRadius(degree);
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
          const labelFadeStart = 0.3;
          const labelFadeEnd = 0.7;
          const labelAlpha = Math.min(1, Math.max(0, (globalScale - labelFadeStart) / (labelFadeEnd - labelFadeStart)));

          if (labelAlpha > 0) {
            const fontSize = Math.max(8, 11 / globalScale);
            ctx.font = `${fontSize}px ${fontFamily}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            const label = node.name;
            const labelX = node.x;
            const labelY = node.y + radius + 2 / globalScale;

            // Background halo for legibility
            ctx.globalAlpha = alpha * labelAlpha * 0.85;
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
          const radius = nodeRadius(node.degree ?? 0);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 4, 0, 2 * Math.PI);
          ctx.fill();
        }}
      />
      <div
        className="absolute bottom-2 right-2 flex flex-row gap-px backdrop-blur-sm"
        style={{ background: isDark ? 'rgba(240,237,230,0.07)' : 'rgba(220,217,206,0.8)', border: `1px solid ${isDark ? 'rgba(240,237,230,0.12)' : 'rgba(45,45,45,0.3)'}` }}
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
