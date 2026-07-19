import { forceCollide, forceCenter, forceX, forceY } from 'd3-force';
import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { useIsDark } from '../hooks/useIsDark';
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
const PINNED_POSITIONS_KEY = 'noa-graph-pinned-positions-v1';

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
  const isDraggingNodeRef = useRef(false);
  const initialPositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const initialView = useRef<{ x: number; y: number; zoom: number } | null>(null);
  const resetAnimationRef = useRef<number | null>(null);
  // Set when a scheduled fit ran while the tab was hidden (rect 0 → fitView
  // bails). The next visible apply() performs the missed fit; without this the
  // graph can stay at the unfitted default camera forever.
  const pendingFitRef = useRef(false);
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

  // Fit the graph into the *visible* area (the container) via the view transform
  // only — zoom + pan, never a canvas resize. Used on first layout, on reset, and
  // whenever the visible container changes, so the graph fills and stays centred
  // without reallocating the flicker-prone canvas backing store.
  const fitView = useCallback((duration = 0): boolean => {
    const fg = fgRef.current;
    const container = containerRef.current;
    if (!fg || !container) return false;
    const bbox = fg.getGraphBbox();
    if (!bbox || !Array.isArray(bbox.x) || !Array.isArray(bbox.y)) return false;
    const bboxW = Math.max(1, bbox.x[1] - bbox.x[0]);
    const bboxH = Math.max(1, bbox.y[1] - bbox.y[0]);
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const PAD = 24;
    // Cap at 2 so a small graph doesn't blow up to fill the canvas (matches the
    // previous zoom-to-fit behaviour).
    const k = Math.min(2, (rect.width - PAD * 2) / bboxW, (rect.height - PAD * 2) / bboxH);
    fg.centerAt((bbox.x[0] + bbox.x[1]) / 2, (bbox.y[0] + bbox.y[1]) / 2, duration);
    fg.zoom(Math.max(0.01, k), duration);
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

  const nodeColor = isDark ? '#CC7D5E' : '#CC7D5E';

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
    if (!physicsCenterRef.current) {
      physicsCenterRef.current = { x: dimensionsRef.current.width / 2, y: dimensionsRef.current.height / 2 };
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
    // Graph identity changed (topology, filter, etc.) — re-anchor physics center
    // to the current viewport so the new layout settles centered.
    physicsCenterRef.current = null;
    let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
    let isActive = true;
    const timer = setTimeout(() => {
      if (!isActive) return;
      // Fit to the visible area (zoom cap is built into fitView). While the tab
      // is hidden the container rect is 0 and the fit is skipped — flag it so
      // the next visible apply() performs it.
      pendingFitRef.current = !fitView(300);
      // Save initial positions after layout has settled
      snapshotTimer = setTimeout(() => {
        if (!isActive) return;
        const snapshot = new Map<string, { x: number; y: number }>();
        graphData.nodes.forEach((node) => {
          if (node.x != null && node.y != null) snapshot.set(String(node.id), { x: node.x, y: node.y });
        });
        initialPositions.current = snapshot;
        // With a fit still pending the current camera is the unfitted one —
        // don't record it, or reset-view would restore a bad viewport. The
        // deferred fit records the camera instead.
        if (!pendingFitRef.current) {
          const center = fgRef.current?.centerAt();
          const zoom = fgRef.current?.zoom();
          if (center && zoom != null) {
            initialView.current = { x: center.x, y: center.y, zoom };
          }
        }
      }, 1000);
    }, 600);
    return () => {
      isActive = false;
      clearTimeout(timer);
      clearTimeout(snapshotTimer);
    };
  }, [graphData, fitView]);

  const fontFamily = settings.appearance.fontFamily === 'font-iosevka' ? '"Iosevka Nerd Font Mono", "Iosevka NF", "JetBrains Mono", monospace' :
                     settings.appearance.fontFamily === 'font-redaction' ? '"Redaction 50", serif' :
                     settings.appearance.fontFamily === 'font-pixelify' ? '"Pixelify Sans", sans-serif' :
                     settings.appearance.fontFamily === 'font-work-sans' ? '"Work Sans", sans-serif' :
                     settings.appearance.fontFamily;

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
            ctx.fillStyle = textColor;
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
      </div>
      <div
        className="absolute bottom-2 right-2 flex flex-row rounded-md backdrop-blur-md"
        style={{
          background: isDark ? 'rgba(249,249,247,0.04)' : 'rgba(45,45,43,0.03)',
          border: `1px solid ${isDark ? 'rgba(249,249,247,0.07)' : 'rgba(45,45,43,0.08)'}`,
        }}
      >
        {zoomControls.map(({ icon, title, action }) => (
          <button
            key={title}
            onClick={action}
            title={title}
            className={`w-7 h-6 active:opacity-70 flex items-center justify-center transition-colors hover:text-[#CC7D5E] ${
              isDark ? 'text-[rgba(249,249,247,0.45)]' : 'text-[rgba(45,45,43,0.5)]'
            }`}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
