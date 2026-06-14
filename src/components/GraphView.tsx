import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from '@/src/lib/icons';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { forceCollide, forceCenter, forceX, forceY } from 'd3-force';
import { Note, AppSettings } from '../types';
import { useIsDark } from '../hooks/useIsDark';
import { computeTopologySignature } from '../lib/noteUtils';
import { buildGraphModel } from '../lib/graphModel';

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

function clearPinnedPositions() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(PINNED_POSITIONS_KEY);
  } catch {
    /* privacy mode or storage unavailable */
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

function hasDistance(force: unknown): force is { distance: (value: number) => void } {
  return Boolean(force) && typeof (force as { distance?: unknown }).distance === 'function';
}

function hasStrength(force: unknown): force is { strength: (value: number) => void } {
  return Boolean(force) && typeof (force as { strength?: unknown }).strength === 'function';
}

function hasAlphaTarget(forceGraph: ForceGraphMethods<GraphNodeData, GraphLinkData> | undefined): forceGraph is ForceGraphMethods<GraphNodeData, GraphLinkData> & { d3AlphaTarget: (value?: number) => number | unknown } {
  return Boolean(forceGraph) && typeof (forceGraph as { d3AlphaTarget?: unknown }).d3AlphaTarget === 'function';
}

function smoothStep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function graphChargeStrength(nodeCount: number): number {
  return nodeCount > 100 ? -65 : nodeCount > 30 ? -90 : -110;
}

function graphLinkDistance(nodeCount: number): number {
  return nodeCount > 100 ? 40 : nodeCount > 30 ? 50 : 62;
}

function graphCenteringStrength(nodeCount: number): number {
  return nodeCount > 100 ? 0.06 : nodeCount > 30 ? 0.08 : 0.1;
}

// Higher than d3-force's degree-based default; tightens link springs so flowers
// keep a clean radial shape. Update reset-view alongside if changed.
const LINK_STRENGTH = 1.25;

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
  const initialView = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const resetAnimationRef = useRef<number | null>(null);
  // Stable world-coord center for forceX/forceY — pinned per graph, not per
  // resize. Tracking width/height here would yank nodes toward a moving target
  // on every sidebar drag (visible as a viewport jump when grabbing a node).
  const physicsCenterRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    clearPinnedPositions();
  }, []);

  useEffect(() => () => {
    if (resetAnimationRef.current != null) {
      cancelAnimationFrame(resetAnimationRef.current);
    }
  }, []);

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
    const topNotes = stableTopologyRef.current.notes;

    const model = buildGraphModel(topNotes, {
      hideIsolated,
      localDepth,
      activeNoteId,
      tagFilter,
      searchQuery,
    });

    const nodes: GraphNode[] = model.nodes.map((modelNode) => {
      const node: GraphNode = {
        id: modelNode.id,
        name: modelNode.title,
        degree: modelNode.degree,
        tags: modelNode.tags,
      };
      return node;
    });

    const links: GraphLink[] = model.links.map((link) => ({
      source: link.source,
      target: link.target,
      bidirectional: link.bidirectional,
    }));

    return { nodes, links };
  }, [hideIsolated, topologyKey, localDepth, activeNoteId, tagFilter, searchQuery]);

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
    if (!physicsCenterRef.current) {
      physicsCenterRef.current = { x: width / 2, y: height / 2 };
    }
    const { x: cx, y: cy } = physicsCenterRef.current;

    // Repulsion: breathing room without scattering
    const chargeForce = fgRef.current.d3Force('charge');
    if (hasStrength(chargeForce)) {
      chargeForce.strength(graphChargeStrength(n));
    }
    // Link distance: short lines, tight graph
    const linkForce = fgRef.current.d3Force('link');
    if (hasDistance(linkForce)) {
      linkForce.distance(graphLinkDistance(n));
    }
    if (hasStrength(linkForce)) {
      linkForce.strength(LINK_STRENGTH);
    }
    // Collide padding pushes nodes apart enough that labels don't crash.
    const collide = forceCollide((node: GraphNode) => nodeRadius(node.degree ?? 0, sizeByDegree) + 6).iterations(3);
    fgRef.current.d3Force('collide', collide);
    // Pin centering forces to a stable world-coord captured on first layout.
    // Container resize must NOT move these targets, or dragging post-resize will
    // yank all nodes toward the new center (visible as a viewport jump).
    fgRef.current.d3Force('center', forceCenter(cx, cy).strength(0.2));
    fgRef.current.d3Force('x', forceX(cx).strength(graphCenteringStrength(n)));
    fgRef.current.d3Force('y', forceY(cy).strength(graphCenteringStrength(n)));
    fgRef.current.d3Force('radial', null);
    // Reheat so updated forces actually move existing nodes; otherwise the
    // simulation sits at alpha≈0 and parameter changes are invisible.
    fgRef.current.d3ReheatSimulation();
  }, [graphData.nodes.length, sizeByDegree]);

  useEffect(() => {
    if (!fgRef.current) return;
    initialPositions.current = new Map();
    // Graph identity changed (topology, filter, etc.) — re-anchor physics center
    // to the current viewport so the new layout settles centered.
    physicsCenterRef.current = null;
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
        const center = fgRef.current?.centerAt();
        const zoom = fgRef.current?.zoom();
        if (center && zoom != null) {
          initialView.current = { x: center.x, y: center.y, zoom };
        }
      }, 1000);
    }, 600);
    return () => {
      isActive = false;
      clearTimeout(timer);
      clearTimeout(innerTimer);
      clearTimeout(snapshotTimer);
    };
  }, [graphData]);

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

  const zoomBy = useCallback((scale: number) => {
    const graph = fgRef.current;
    const cur = graph?.zoom();
    if (cur == null) return;
    graph?.resumeAnimation();
    graph?.zoom(cur * scale, 200);
  }, []);

  const zoomControls = [
    { icon: <ZoomIn size={12} />, title: 'Zoom in', action: () => zoomBy(1.3) },
    { icon: <ZoomOut size={12} />, title: 'Zoom out', action: () => zoomBy(0.77) },
    { icon: <Maximize2 size={12} />, title: 'Reset view', action: () => {
      clearPinnedPositions();
      if (resetAnimationRef.current != null) {
        cancelAnimationFrame(resetAnimationRef.current);
        resetAnimationRef.current = null;
      }
      const snapshot = initialPositions.current;
      if (snapshot.size === 0) {
        fgRef.current?.resumeAnimation();
        fgRef.current?.zoomToFit(300, 24);
        return;
      }

      const duration = 720;
      const start = performance.now();
      const from = new Map(graphData.nodes.map((node) => [String(node.id), { x: node.x ?? 0, y: node.y ?? 0 }]));
      const chargeForce = fgRef.current?.d3Force('charge');
      const linkForce = fgRef.current?.d3Force('link');
      const previousAlphaTarget = hasAlphaTarget(fgRef.current) ? fgRef.current.d3AlphaTarget() as number : null;
      const targetView = initialView.current;

      if (hasStrength(chargeForce)) chargeForce.strength(0);
      if (hasStrength(linkForce)) linkForce.strength(0);
      if (hasAlphaTarget(fgRef.current)) fgRef.current.d3AlphaTarget(0);
      graphData.nodes.forEach((node) => {
        node.fx = node.x;
        node.fy = node.y;
      });
      if (targetView) {
        fgRef.current?.centerAt(targetView.x, targetView.y, duration);
        fgRef.current?.zoom(targetView.zoom, duration);
      }
      fgRef.current?.resumeAnimation();
      fgRef.current?.d3ReheatSimulation();

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const ease = smoothStep(t);
        graphData.nodes.forEach((node) => {
          const target = snapshot.get(String(node.id));
          const origin = from.get(String(node.id));
          if (!target || !origin) return;
          const x = origin.x + (target.x - origin.x) * ease;
          const y = origin.y + (target.y - origin.y) * ease;
          node.x = x;
          node.y = y;
          node.fx = x;
          node.fy = y;
        });

        if (t < 1) {
          resetAnimationRef.current = requestAnimationFrame(tick);
          return;
        }

        graphData.nodes.forEach((node) => {
          const target = snapshot.get(String(node.id));
          if (!target) return;
          node.x = target.x;
          node.y = target.y;
          node.vx = 0;
          node.vy = 0;
          node.fx = target.x;
          node.fy = target.y;
        });
        const n = graphData.nodes.length;
        if (hasStrength(chargeForce)) chargeForce.strength(graphChargeStrength(n));
        if (hasStrength(linkForce)) linkForce.strength(LINK_STRENGTH);
        if (hasAlphaTarget(fgRef.current) && typeof previousAlphaTarget === 'number') {
          fgRef.current.d3AlphaTarget(previousAlphaTarget);
        }
        graphData.nodes.forEach((node) => {
          node.fx = undefined;
          node.fy = undefined;
        });
        fgRef.current?.resumeAnimation();
        resetAnimationRef.current = null;
      };
      resetAnimationRef.current = requestAnimationFrame(tick);
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
        // Disable pan whenever a node is hovered. Hover state is set before
        // mouse-down, so by the time the user presses on a node, pan is already
        // off and won't race with the node-drag handler. (A ref-based predicate
        // wouldn't work — d3-zoom's filter runs on mousedown, when the drag flag
        // is still false from the previous frame.)
        enablePanInteraction={!hoveredNodeId}
        enableZoomInteraction={true}
        // Longer cooldown + slower decay let leaf nodes settle into an even radial
        // arrangement around their hub (otherwise they freeze near their initial
        // random positions before the simulation reaches equilibrium).
        cooldownTicks={graphData.nodes.length > 200 ? 40 : graphData.nodes.length > 100 ? 60 : 90}
        cooldownTime={graphData.nodes.length > 200 ? 1200 : graphData.nodes.length > 30 ? 2500 : 1500}
        d3AlphaDecay={graphData.nodes.length > 200 ? 0.05 : 0.025}
        d3VelocityDecay={graphData.nodes.length > 200 ? 0.65 : 0.5}
        onNodeDrag={(node: GraphNode) => {
          node.fx = node.x;
          node.fy = node.y;
          fgRef.current?.resumeAnimation();
          isDraggingNodeRef.current = true;
        }}
        onNodeDragEnd={(node: GraphNode) => {
          isDraggingNodeRef.current = false;
          node.vx = 0;
          node.vy = 0;
          node.fx = undefined;
          node.fy = undefined;
          fgRef.current?.resumeAnimation();
        }}
        onBackgroundClick={() => { isDraggingNodeRef.current = false; }}
        nodeCanvasObject={(node: GraphNode, ctx, globalScale) => {
          if (node.x == null || node.y == null) return;
          const degree = node.degree ?? 0;
          const radius = nodeRadius(degree, sizeByDegree);
          const isActive = activeNoteId && String(node.id) === activeNoteId;
          const isHovered = hoveredNodeId === String(node.id);
          const inHoverNeighbour = hoveredNeighbours ? hoveredNeighbours.has(String(node.id)) : true;

          const dimByHover = hoveredNeighbours && !inHoverNeighbour;

          const alpha = dimByHover ? 0.08 : 1;

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
        style={{ background: isDark ? 'rgba(238,237,234,0.07)' : 'rgba(45,45,45,0.06)', border: `1px solid ${isDark ? 'rgba(238,237,234,0.12)' : 'rgba(45,45,45,0.15)'}` }}
      >
        {zoomControls.map(({ icon, title, action }) => (
          <button
            key={title}
            onClick={action}
            title={title}
            className="w-7 h-6 active:opacity-70 flex items-center justify-center transition-colors"
            style={{ color: isDark ? 'rgba(238,237,234,0.45)' : 'rgba(45,45,45,0.5)' }}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
