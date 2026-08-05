import { forceCollide, forceCenter, forceX, forceY } from 'd3-force';
import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { useIsDark } from '../hooks/useIsDark';
import { resolveFontFamily } from '../lib/fontFamily';
import { buildGraphModel } from '../lib/graphModel';
import { computeTopologySignature } from '../lib/noteUtils';
import { Note, Folder, AppSettings } from '../types';
import { ZoomIn, ZoomOut, Maximize2 } from '@/src/lib/icons';

export type GraphColorMode = 'tag' | 'none';

interface GraphViewProps {
  notes: Note[];
  folders?: Folder[];
  onNavigateToNoteById: (id: string) => void;
  settings: AppSettings;
  searchQuery?: string;
  activeNoteId?: string;
  hideIsolated?: boolean;
  localDepth?: number;
  tagFilter?: string[];
  colorMode?: GraphColorMode;
  sizeByDegree?: boolean;
  showUnresolved?: boolean;
}

const GRAPH_PERF_WARN_THRESHOLD = 200;
// 480px right-panel max + 8px buffer.
const GRAPH_CANVAS_MAX_WIDTH = 488;
const GRAPH_CANVAS_MIN_HEIGHT = 400;

function getStableCanvasSize() {
  if (typeof window === 'undefined') {
    return { width: GRAPH_CANVAS_MAX_WIDTH, height: GRAPH_CANVAS_MIN_HEIGHT };
  }

  const screenHeight =
    window.screen?.availHeight ||
    window.screen?.height ||
    window.innerHeight ||
    GRAPH_CANVAS_MIN_HEIGHT;

  return {
    width: GRAPH_CANVAS_MAX_WIDTH,
    height: Math.max(GRAPH_CANVAS_MIN_HEIGHT, Math.ceil(screenHeight)) + 2,
  };
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
  ghost?: boolean;
};

type GraphLinkData = {
  bidirectional: boolean;
};

type GraphNode = NodeObject<GraphNodeData>;
type GraphLink = LinkObject<GraphNodeData, GraphLinkData>;

type TopologyNote = Pick<Note, 'id' | 'title' | 'links' | 'linkRefs' | 'tags' | 'folder'>;

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

// Ticks run synchronously inside force-graph's data update, before the first
// paint. The layout reaches its final *scale* within ~15 ticks (only fine
// positions keep adjusting after that), so warming up here means the very first
// fit sees the real bounding box. Without it the mount-time fit measured d3's
// seed spiral (~140 world units), clamped to the 2x zoom cap, and then the graph
// expanded ~3x past the viewport for the rest of the settle — reading as a long
// blank gap before the graph "appeared".
// Cost is bounded: ~15ms at 50 nodes, ~18ms at 200, ~34ms at 500.
// Settle time tracks TOPOLOGY, not just node count — a chain has to unfold
// linearly and needs far more ticks than a blob of the same size. Small graphs
// therefore get a generous budget (they are cheap per tick); measured against a
// filtered 11-node chain, 45 ticks left it 10% short of its final height, which
// showed up as the camera snapping and then rebounding.
function graphWarmupTicks(nodeCount: number): number {
  return nodeCount > 400 ? 15 : nodeCount > 200 ? 25 : nodeCount > 100 ? 35 : nodeCount > 50 ? 60 : 90;
}

// Remaining ticks are polish only — warmup already did the layout work. Total
// tick budget is unchanged from before warmup existed.
function graphCooldownTicks(nodeCount: number): number {
  return nodeCount > 200 ? 20 : nodeCount > 100 ? 25 : 45;
}

// Frame-rate fallback for the tick budget above: binds only when frames drop
// below 60fps, which is exactly when the tick count would otherwise overrun.
function graphCooldownTime(nodeCount: number): number {
  return nodeCount > 200 ? 700 : nodeCount > 100 ? 850 : 1200;
}

// Higher than d3-force's degree-based default; tightens link springs so flowers
// keep a clean radial shape. Update reset-view alongside if changed.
const LINK_STRENGTH = 1.25;

// Node radius: log-scaled by degree (Obsidian-like).
// sizeByDegree=false → fixed 5px (legacy mode).
const NODE_RADIUS_MAX = 9;
function nodeRadius(degree: number, sizeByDegree: boolean): number {
  if (!sizeByDegree) return 5;
  // log1p(degree) maps 0→0, 1→0.69, 5→1.79, 20→3.04, 50→3.93
  return Math.min(NODE_RADIUS_MAX, 3 + Math.log1p(degree) * 1.6);
}

// --- Zoom-to-fit tuning. Raise either value to make the graph render larger. ---
// Screen-px gutter kept clear around the fitted graph. Sized for a node label
// (5px gap + 8px text) rather than the old blanket 24, which cost ~7% of scale.
const FIT_PADDING = 12;
// Scale applied *on top of* the exact fit, so the graph deliberately overflows
// the panel rather than being fully contained. At 1.35 roughly the outer 13% of
// the span on each side falls outside the viewport, which costs ~20% of nodes on
// a mid-size graph — they are the sparse outer stragglers, one drag away.
// The cost curve turns sharply past this: 1.5 puts a third of nodes outside and
// 1.7 nearly half, so treat this as the practical ceiling.
const FIT_FILL = 1.35;
// Ceiling so a 2-3 node graph doesn't balloon to fill the panel. Applied after
// FIT_FILL, and it is the binding constraint for small graphs (below ~15 nodes
// the span is short enough that the cap, not the padding, decides the zoom).
const FIT_MAX_ZOOM = 3.5;
// What getGraphBbox assumes each node's radius is: sqrt(nodeVal ?? 1) * nodeRelSize,
// i.e. 1 * 4 with force-graph's defaults, neither of which GraphView overrides.
const FG_ASSUMED_NODE_RADIUS = 4;
// The post-rebuild fit eases rather than cuts, so a filter change reads as the
// camera travelling to the new graph instead of teleporting (it was a 65% jump).
const EARLY_FIT_DURATION = 240;
// The engine-stop fit is a correction, not a move: skip it when it would shift
// the camera by less than this. Otherwise every load ends with a pointless ~2%
// zoom nudge a third of a second after the graph already looked settled.
const LATE_FIT_MIN_DELTA = 0.03;

export default function GraphView({
  notes,
  folders,
  onNavigateToNoteById,
  settings,
  searchQuery = '',
  activeNoteId,
  hideIsolated = false,
  localDepth = 0,
  tagFilter,
  colorMode = 'tag',
  sizeByDegree = true,
  showUnresolved = true,
}: GraphViewProps) {
  const isDark = useIsDark(settings.appearance.theme);
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GraphNodeData, GraphLinkData> | undefined>(undefined);
  // The canvas backing store is sized to cover the largest right panel and is
  // CSS-centred inside the visible container, which clips the overflow. Resizing
  // a canvas reallocates its GPU backing store and clears a frame, so the graph
  // should adapt to window/panel changes through zoom/pan only.
  const [canvasSize, setCanvasSize] = useState(() => getStableCanvasSize());
  const dimensionsRef = useRef(canvasSize);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const initialPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const initialView = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const resetAnimationRef = useRef<number | null>(null);
  // Set when a scheduled fit ran while the tab was hidden (rect 0 → fitView
  // bails). The next visible apply() performs the missed fit; without this the
  // graph can stay at the unfitted default camera forever.
  const pendingFitRef = useRef(false);
  const pendingInitialCaptureRef = useRef(true);
  // One-shot per graph rebuild, consumed by the first engine tick.
  const pendingEarlyFitRef = useRef(true);
  const lastFittedViewRef = useRef<{ x: number; y: number; zoom: number } | null>(null);

  useEffect(() => () => {
    if (resetAnimationRef.current != null) {
      cancelAnimationFrame(resetAnimationRef.current);
    }
  }, []);

  // Fit the graph into the *visible* area (the container) via the view transform
  // only — zoom + pan, never a canvas resize. Used on first layout, on reset, and
  // whenever the visible container changes, so the graph fills and stays centred
  // without reallocating the flicker-prone canvas backing store.
  const fitView = useCallback((duration = 0, minRelDelta = 0): boolean => {
    const fg = fgRef.current;
    const container = containerRef.current;
    if (!fg || !container) return false;
    const bbox = fg.getGraphBbox();
    if (!bbox || !Array.isArray(bbox.x) || !Array.isArray(bbox.y)) return false;
    // getGraphBbox only returns null for an *empty* node list. Nodes that exist
    // but have not been positioned yet (force-graph applies graphData through a
    // 1ms-debounced digest, so this is racy) yield NaN bounds instead. Feeding
    // those to zoom()/centerAt() poisons the d3-zoom transform with NaN and the
    // canvas renders nothing at all until some later call resets it.
    if (![bbox.x[0], bbox.x[1], bbox.y[0], bbox.y[1]].every(Number.isFinite)) return false;
    // getGraphBbox pads each node by sqrt(nodeVal) * nodeRelSize = 4 world units,
    // but nodeCanvasObject draws them at up to NODE_RADIUS_MAX. Widen the span by
    // the shortfall so the tighter screen padding below can't clip edge nodes.
    const radiusShortfall = Math.max(0, NODE_RADIUS_MAX - FG_ASSUMED_NODE_RADIUS);
    const bboxW = Math.max(1, bbox.x[1] - bbox.x[0]) + radiusShortfall * 2;
    const bboxH = Math.max(1, bbox.y[1] - bbox.y[0]) + radiusShortfall * 2;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    // Exact fit first, then deliberately overshoot it by FIT_FILL. The cap stays
    // the final ceiling so tiny graphs still can't balloon.
    const exactFit = Math.min(
      (rect.width - FIT_PADDING * 2) / bboxW,
      (rect.height - FIT_PADDING * 2) / bboxH
    );
    const k = Math.min(FIT_MAX_ZOOM, exactFit * FIT_FILL);
    if (!Number.isFinite(k)) return false;
    const nextView = {
      x: (bbox.x[0] + bbox.x[1]) / 2,
      y: (bbox.y[0] + bbox.y[1]) / 2,
      zoom: Math.max(0.01, k),
    };
    lastFittedViewRef.current = nextView;
    // Treat "already close enough" as a successful fit: the camera is recorded
    // (reset-view still targets it) but not moved, so a negligible correction
    // never surfaces as a late, unexplained drift.
    if (minRelDelta > 0) {
      const currentZoom = fg.zoom();
      const currentCenter = fg.centerAt();
      if (currentZoom != null && currentCenter) {
        const zoomDrift = Math.abs(nextView.zoom - currentZoom) / (currentZoom || 1);
        const panDrift =
          Math.hypot(nextView.x - currentCenter.x, nextView.y - currentCenter.y) /
          Math.max(bboxW, bboxH);
        if (zoomDrift < minRelDelta && panDrift < minRelDelta) return true;
      }
    }
    fg.centerAt(nextView.x, nextView.y, duration);
    fg.zoom(nextView.zoom, duration);
    return true;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const apply = () => {
      const rect = container.getBoundingClientRect();
      // Hidden behind another tab (display:none) collapses the rect to 0. Bail
      // so the 0-size doesn't register as a size change — otherwise returning
      // to the tab re-fits and discards the user's pan/zoom.
      if (rect.width <= 0 || rect.height <= 0) return;
      const stableSize = getStableCanvasSize();
      const targetW = stableSize.width;
      const targetH = Math.max(stableSize.height, Math.ceil(rect.height) + 2);
      const current = dimensionsRef.current;

      if (targetW !== current.width || targetH !== current.height) {
        dimensionsRef.current = { width: targetW, height: targetH };
        setCanvasSize({ width: targetW, height: targetH });
      }

      // Run a fit that was missed while the tab was hidden, then record the
      // fitted camera so reset-view targets it instead of the unfitted one.
      if (pendingFitRef.current) {
        pendingFitRef.current = false;
        if (fitView(0)) {
          const center = fgRef.current?.centerAt();
          const zoom = fgRef.current?.zoom();
          if (center && zoom != null) {
            initialView.current = { x: center.x, y: center.y, zoom };
          }
        }
      }
      // Note: no re-fit on container resize — the canvas is oversized and
      // CSS-centred, so the camera stays stable on its own. Re-fitting here
      // would discard the user's pan/zoom on every window/panel resize.
    };

    apply();
    const observer = new ResizeObserver(() => apply());
    observer.observe(container);
    window.addEventListener('resize', apply);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, [fitView]);

  useEffect(() => {
    // The public wrapper applies rare backing-store changes from props. Re-fit
    // after React commits the new canvas dimensions.
    fitView(0);
  }, [canvasSize, fitView]);

  const topologyNotes = useMemo(
    () => notes.map((note) => ({
      id: note.id,
      title: note.title,
      links: note.links ?? [],
      linkRefs: note.linkRefs ?? [],
      tags: note.tags ?? [],
      folder: note.folder ?? '',
    })),
    [notes]
  );
  const topologyKey = useMemo(
    () => computeTopologySignature(topologyNotes, folders),
    [topologyNotes, folders]
  );
  // Folders ride along in the same key-guarded snapshot: a new folders array
  // identity with identical content must not rebuild graphData (d3 would
  // re-seed and explode the layout).
  const stableTopologyRef = useRef<{ key: string; notes: TopologyNote[]; folders: Folder[] }>({ key: '', notes: [], folders: [] });
  if (stableTopologyRef.current.key !== topologyKey) {
    stableTopologyRef.current = { key: topologyKey, notes: topologyNotes, folders: folders ?? [] };
  }

  const bgColor   = isDark ? '#2D2D2B' : '#F9F9F7';
  const linkColor = isDark ? '#8A8070' : '#9A9080';
  const textColor = isDark ? '#F9F9F7' : '#2D2D2B';

  // Accent is a fixed token — deliberately the same in both themes.
  const nodeColor = '#CC7D5E';

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

  // activeNoteId only shapes the model in local mode (localDepth > 0). Keying
  // graphData on it otherwise would mint fresh node objects on every note
  // switch, and d3-force re-seeds positionless nodes — the whole layout would
  // explode every time a node is clicked.
  const localAnchorId = localDepth > 0 ? activeNoteId : undefined;

  const graphData = useMemo(() => {
    const topNotes = stableTopologyRef.current.notes;

    const model = buildGraphModel(topNotes, {
      hideIsolated,
      localDepth,
      activeNoteId: localAnchorId,
      tagFilter,
      searchQuery,
      folders: stableTopologyRef.current.folders,
      showUnresolved,
    });

    const nodes: GraphNode[] = model.nodes.map((modelNode) => {
      const node: GraphNode = {
        id: modelNode.id,
        name: modelNode.title,
        degree: modelNode.degree,
        tags: modelNode.tags,
        ghost: modelNode.ghost,
      };
      return node;
    });

    const links: GraphLink[] = model.links.map((link) => ({
      source: link.source,
      target: link.target,
      bidirectional: link.bidirectional,
    }));

    return { nodes, links };
    // topologyKey is a stable hash standing in for the `notes`/`folders` arrays;
    // including them directly would recompute on every parent re-render that
    // produces new array identities even when topology is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideIsolated, topologyKey, localDepth, localAnchorId, tagFilter, searchQuery, showUnresolved]);

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
    // Centering forces target the world ORIGIN, which is where force-graph parks
    // the camera (adjustCanvasSize translates the world origin to the canvas
    // centre). Canvas pixel dimensions are NOT world coords — targeting
    // width/2,height/2 pushed the layout hundreds of world units past the visible
    // crop, so the whole settle happened off-screen until the engine-stop fit
    // chased it. The origin is also maximally stable: no resize can move it.
    fgRef.current.d3Force('center', forceCenter(0, 0).strength(0.2));
    fgRef.current.d3Force('x', forceX(0).strength(graphCenteringStrength(n)));
    fgRef.current.d3Force('y', forceY(0).strength(graphCenteringStrength(n)));
    fgRef.current.d3Force('radial', null);
    // Reheat so updated forces actually move existing nodes; otherwise the
    // simulation sits at alpha≈0 and parameter changes are invisible.
    fgRef.current.d3ReheatSimulation();
    // Depend on graphData identity, not just node count: an in-flight reset
    // animation zeroes charge/link strengths, so every rebuild must reapply
    // them even when the node count is unchanged.
  }, [graphData, sizeByDegree]);

  useEffect(() => {
    if (!fgRef.current) return;
    // A reset-view animation still running against the previous graph would
    // keep writing stale positions and, on finish, restore force strengths
    // computed for the old node count. Cancel it — the physics effect above
    // has already reapplied the correct strengths for this graph.
    if (resetAnimationRef.current != null) {
      cancelAnimationFrame(resetAnimationRef.current);
      resetAnimationRef.current = null;
    }
    initialPositions.current = new Map();
    // The hovered node may not exist in the rebuilt graph; a stale id would
    // dim every node and link with no way to recover until the next hover.
    setHoveredNodeId(null);
    pendingInitialCaptureRef.current = true;
    pendingEarlyFitRef.current = true;
  }, [graphData]);

  // Re-fit as soon as the rebuilt layout exists, rather than leaving the graph
  // mis-scaled until onEngineStop ~1s later — which is what made every load and
  // filter change blank out.
  // Fit off force-graph's own tick signal rather than a rAF. resetCountdown()
  // runs at the tail of the data update — after graphData is ingested and after
  // warmupTicks — so the first tick is the earliest moment the bbox is both
  // populated and current. A rAF cannot promise either: it can land before the
  // 1ms-debounced digest (unpositioned nodes → NaN bounds) or, worse, while
  // force-graph still holds the *previous* graph, whose bounds are perfectly
  // finite and would fit the camera to the wrong layout.
  const handleEngineTick = useCallback(() => {
    if (!pendingEarlyFitRef.current) return;
    if (fitView(EARLY_FIT_DURATION)) pendingEarlyFitRef.current = false;
  }, [fitView]);

  const captureInitialLayout = useCallback(() => {
    if (!pendingInitialCaptureRef.current) return;
    pendingInitialCaptureRef.current = false;

    const snapshot = new Map<string, { x: number; y: number }>();
    graphData.nodes.forEach((node) => {
      if (node.x != null && node.y != null) snapshot.set(String(node.id), { x: node.x, y: node.y });
    });
    initialPositions.current = snapshot;

    // Fit only after the force engine has frozen the layout. Hidden graph tabs
    // defer the fit until their container has non-zero dimensions.
    const didFit = fitView(300, LATE_FIT_MIN_DELTA);
    pendingFitRef.current = !didFit;
    if (didFit && lastFittedViewRef.current) {
      initialView.current = lastFittedViewRef.current;
    }
  }, [graphData, fitView]);

  const fontFamily = resolveFontFamily(settings.appearance.fontFamily);

  // Pick node fill color: ghost (muted) > tag color > accent (connected) > grey (isolated)
  const getNodeColor = useCallback((node: GraphNode): string => {
    if (node.ghost) return isDark ? '#8A8070' : '#9A9080';
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
    { icon: <ZoomIn size={11} />, title: 'Zoom in', action: () => zoomBy(1.3) },
    { icon: <ZoomOut size={11} />, title: 'Zoom out', action: () => zoomBy(0.77) },
    { icon: <Maximize2 size={11} />, title: 'Reset view', action: () => {
      if (resetAnimationRef.current != null) {
        cancelAnimationFrame(resetAnimationRef.current);
        resetAnimationRef.current = null;
      }
      const snapshot = initialPositions.current;
      if (snapshot.size === 0) {
        fgRef.current?.resumeAnimation();
        fitView(300);
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
    <div ref={containerRef} className="relative w-full h-full overflow-hidden flex items-center justify-center">
      {graphData.nodes.length > GRAPH_PERF_WARN_THRESHOLD && (
        <div className="absolute top-2 left-2 right-2 z-10 border border-[#CC7D5E]/60 bg-[#F9F9F7]/90 px-3 py-1.5 text-xs text-[#2D2D2B]/70 font-redaction flex items-center justify-between">
          <span>Graph contains {graphData.nodes.length} nodes and may render slowly. Try enabling "Hide isolated nodes".</span>
        </div>
      )}
      <div style={{ width: canvasSize.width, height: canvasSize.height, flexShrink: 0 }}>
      <ForceGraph2D
        ref={fgRef}
        width={canvasSize.width}
        height={canvasSize.height}
        graphData={graphData}
        nodeLabel="name"
        backgroundColor={bgColor}
        linkColor={(link: GraphLink) => {
          if (hoveredNodeId) {
            // Only emphasise links touching the hovered node itself — links
            // between two of its neighbours dim like everything else. (A
            // both-endpoints-in-neighbour-set check would wrongly light up
            // neighbour↔neighbour edges in triangles.) Matches linkWidth.
            const src = readLinkEndpointId(link.source);
            const tgt = readLinkEndpointId(link.target);
            if (src === hoveredNodeId || tgt === hoveredNodeId) {
              return link.bidirectional ? nodeColor : linkColor;
            }
            return `${linkColor}20`;
          }
          return link.bidirectional ? nodeColor : linkColor;
        }}
        linkWidth={(link: GraphLink) => {
          if (hoveredNodeId) {
            const src = readLinkEndpointId(link.source);
            const tgt = readLinkEndpointId(link.target);
            if (src === hoveredNodeId || tgt === hoveredNodeId) {
              return link.bidirectional ? 3 : 2;
            }
            return 0.5;
          }
          return link.bidirectional ? 2.5 : 1.5;
        }}
        linkDirectionalArrowLength={(link: GraphLink) => link.bidirectional ? 0 : 4}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={(link: GraphLink) => {
          if (hoveredNodeId) {
            const src = readLinkEndpointId(link.source);
            const tgt = readLinkEndpointId(link.target);
            if (src !== hoveredNodeId && tgt !== hoveredNodeId) {
              return `${linkColor}20`;
            }
          }
          return linkColor;
        }}
        onNodeClick={(node: GraphNode) => {
          // Ghost nodes are unresolved links — there is no note to open.
          if (node.ghost) return;
          onNavigateToNoteById(String(node.id));
        }}
        onNodeHover={(node: GraphNode | null) => setHoveredNodeId(node ? String(node.id) : null)}
        enableNodeDrag={true}
        // Disable pan whenever a node is hovered. Hover state is set before
        // mouse-down, so by the time the user presses on a node, pan is already
        // off and won't race with the node-drag handler. (A ref-based predicate
        // wouldn't work — d3-zoom's filter runs on mousedown, when the drag flag
        // is still false from the previous frame.)
        enablePanInteraction={!hoveredNodeId}
        enableZoomInteraction={true}
        // Most of the settle happens in warmupTicks (synchronous, pre-paint) so the
        // graph is already at its final scale on the first frame; the cooldown
        // ticks below only polish leaf positions around their hubs.
        warmupTicks={graphWarmupTicks(graphData.nodes.length)}
        cooldownTicks={graphCooldownTicks(graphData.nodes.length)}
        cooldownTime={graphCooldownTime(graphData.nodes.length)}
        d3AlphaDecay={graphData.nodes.length > 200 ? 0.05 : 0.025}
        d3VelocityDecay={graphData.nodes.length > 200 ? 0.65 : 0.5}
        onEngineTick={handleEngineTick}
        onEngineStop={captureInitialLayout}
        onNodeDrag={(node: GraphNode) => {
          node.fx = node.x;
          node.fy = node.y;
          fgRef.current?.resumeAnimation();
        }}
        onNodeDragEnd={(node: GraphNode) => {
          node.vx = 0;
          node.vy = 0;
          node.fx = undefined;
          node.fy = undefined;
          fgRef.current?.resumeAnimation();
        }}
        nodeCanvasObject={(node: GraphNode, ctx, globalScale) => {
          if (node.x == null || node.y == null) return;
          const degree = node.degree ?? 0;
          const radius = nodeRadius(degree, sizeByDegree);
          const isActive = activeNoteId && String(node.id) === activeNoteId;
          const isHovered = hoveredNodeId === String(node.id);
          const inHoverNeighbour = hoveredNeighbours ? hoveredNeighbours.has(String(node.id)) : true;

          const dimByHover = hoveredNeighbours && !inHoverNeighbour;

          // Ghosts render faded (Obsidian's unresolved-node treatment).
          const alpha = dimByHover ? 0.08 : (node.ghost ? 0.35 : 1);

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
            // globalScale is the zoom factor and ctx is already scaled by it, so
            // dividing keeps labels at a constant 8 screen px. Do NOT clamp this
            // in world units — a `Math.max(6, …)` floor only bites past zoom 1.33
            // and then grows labels linearly with zoom (36px at 6×). The small
            // end is handled by labelAlpha fading them out, not by a size floor.
            const fontSize = 8 / globalScale;
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
            ctx.fillStyle = textColor;
            ctx.fillText(label, labelX, labelY);
            ctx.shadowBlur = 0;
          }

          ctx.restore();
        }}
        nodePointerAreaPaint={(node: GraphNode, color, ctx, globalScale) => {
          if (node.x == null || node.y == null) return;
          const radius = nodeRadius(node.degree ?? 0, sizeByDegree);
          ctx.fillStyle = color;
          ctx.beginPath();
          // Slightly larger hit area makes node drags less likely to start a canvas
          // pan. The padding is divided by globalScale so it stays 8 *screen* px:
          // as a raw world-unit value it ballooned when zoomed in, overlapping
          // neighbouring hit areas and — via enablePanInteraction={!hoveredNodeId}
          // — leaving no background left to pan from.
          ctx.arc(node.x, node.y, radius + 8 / globalScale, 0, 2 * Math.PI);
          ctx.fill();
        }}
      />
      </div>
      <nav aria-label="Graph nodes" className="absolute left-2 top-2 z-20">
        {graphData.nodes.filter((node) => !node.ghost).map((node) => {
          const degree = node.degree ?? 0;
          return (
            <button
              key={String(node.id)}
              type="button"
              aria-current={String(node.id) === activeNoteId ? 'page' : undefined}
              aria-label={`${node.name}, ${degree} connection${degree === 1 ? '' : 's'}`}
              onClick={() => onNavigateToNoteById(String(node.id))}
              onFocus={() => setHoveredNodeId(String(node.id))}
              onBlur={() => setHoveredNodeId(null)}
              className={`sr-only focus:not-sr-only focus:block focus:max-w-56 focus:truncate focus:rounded-md focus:border focus:border-[#CC7D5E] focus:px-2 focus:py-1 focus:text-xs focus:font-redaction focus:outline-none ${
                isDark ? 'focus:bg-[#252523] focus:text-[#F9F9F7]' : 'focus:bg-[#F9F9F7] focus:text-[#2D2D2B]'
              }`}
            >
              {node.name}
            </button>
          );
        })}
      </nav>
      <div className="noa-graph-control-surface absolute bottom-2 right-2 flex flex-row rounded-md backdrop-blur-md p-0.5 gap-0.5">
        {zoomControls.map(({ icon, title, action }) => (
          <button
            key={title}
            onClick={action}
            title={title}
            className={`noa-graph-control-button w-6 h-6 rounded active:opacity-70 flex items-center justify-center transition-colors hover:text-[#CC7D5E] ${
              isDark ? 'text-[rgba(249,249,247,0.6)]' : 'text-[rgba(45,45,43,0.6)]'
            }`}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
