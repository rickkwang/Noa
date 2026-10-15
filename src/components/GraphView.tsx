import { forceCollide, forceCenter, forceX, forceY } from 'd3-force';
import React, { useMemo, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { useIsDark } from '../hooks/useIsDark';
import { resolveFontFamily } from '../lib/fontFamily';
import { buildGraphModel, buildTimelapseRanks, matchGraphGroup, type GraphGroup } from '../lib/graphModel';
import { computeTopologySignature } from '../lib/noteUtils';
import { themeSurfaces } from '../lib/themePalette';
import { Note, Folder, AppSettings } from '../types';

export type GraphColorMode = 'tag' | 'none';

// Multipliers on the node-count-based defaults below, so 1 is the tuned layout.
export interface GraphForces {
  center: number;
  repel: number;
  link: number;
  distance: number;
}
export const DEFAULT_GRAPH_FORCES: GraphForces = { center: 1, repel: 1, link: 1, distance: 1 };
export const DEFAULT_NODE_SIZE = 1;
export const DEFAULT_LINK_THICKNESS = 1;
// Zoom at which labels are fully visible. Lower shows them further zoomed out.
export const DEFAULT_LABEL_FADE_THRESHOLD = 0.9;

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
  arrows?: boolean;
  nodeSize?: number;
  linkThickness?: number;
  groups?: GraphGroup[];
  /** Bump to replay the time-lapse animation. */
  animateKey?: number;
  showUnresolved?: boolean;
  /** Offered from the empty state when filters leave no nodes. */
  onClearFilters?: () => void;
  /** One-click action on the large-graph perf warning. */
  onEnableHideIsolated?: () => void;
  forces?: GraphForces;
  labelFadeThreshold?: number;
}

const GRAPH_PERF_WARN_THRESHOLD = 200;
// Floor for the canvas width: the 480px right-panel max + 8px buffer.
const GRAPH_CANVAS_MAX_WIDTH = 488;
const GRAPH_CANVAS_MIN_HEIGHT = 400;

let widestCanvasWidth = 0;

function getStableCanvasSize() {
  if (typeof window === 'undefined') {
    return { width: GRAPH_CANVAS_MAX_WIDTH, height: GRAPH_CANVAS_MIN_HEIGHT };
  }

  const screenHeight =
    window.screen?.availHeight ||
    window.screen?.height ||
    window.innerHeight ||
    GRAPH_CANVAS_MIN_HEIGHT;

  // As wide as the screen, like the height: a card expanded over the editor
  // can be nearly that wide. Sized once and never reallocated — the canvas is
  // CSS-centred in its container, so a card growing or shrinking just reveals
  // more or less of it and the graph glides with the card's own motion.
  const screenWidth = window.screen?.availWidth || window.screen?.width || window.innerWidth || 0;
  // Only ever grows. The reported screen can shrink — the window moved to a
  // smaller display, or an emulated viewport — and following it down would
  // reallocate the canvas mid-resize, which is exactly the flash this size
  // exists to prevent. A canvas wider than it needs to be costs nothing seen.
  widestCanvasWidth = Math.max(widestCanvasWidth, GRAPH_CANVAS_MAX_WIDTH, Math.ceil(screenWidth));
  return {
    width: widestCanvasWidth,
    height: Math.max(GRAPH_CANVAS_MIN_HEIGHT, Math.ceil(screenHeight)) + 2,
  };
}

// Tag palette — cycles through these for the first N unique tags. Exported so
// the filter drawer's tag chips can double as the colour legend: RightPanel's
// allTags and the map below are both first-appearance order over the same
// notes array, so index-based lookups agree.
export const TAG_PALETTE = [
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

type TopologyNote = Pick<Note, 'id' | 'title' | 'links' | 'linkRefs' | 'tags' | 'folder' | 'createdAt'>;

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

// Above d3-force's degree-based default; tightens links for a clean radial shape.
// Update reset-view alongside if changed.
const LINK_STRENGTH = 1.25;

// Node radius: log-scaled by degree, then multiplied by the Node size setting.
const NODE_RADIUS_MAX = 9;
function nodeRadius(degree: number, nodeSize: number): number {
  // log1p(degree) maps 0→0, 1→0.69, 5→1.79, 20→3.04, 50→3.93
  return Math.min(NODE_RADIUS_MAX, 3 + Math.log1p(degree) * 1.6) * nodeSize;
}

const NO_GROUPS: GraphGroup[] = [];
// Length of one time-lapse replay: notes appear in creation order across this span.
const TIMELAPSE_MS = 4000;
// Each note grows in over this span once its turn comes, rather than popping in at full size. The same entry
// plays for nodes a filter change brings into view.
const NODE_ENTER_MS = 450;
// Past 1:1 the camera spreads the graph out much faster than it grows the
// dots. A world-unit radius grows linearly with zoom, so a graph fitted to a
// large area (an expanded card runs at 2-3x) turned into a field of 20px discs
// with the same few pixels of label under each. Damped, the extra room goes
// to the distances between notes — the Obsidian reading of zoom — and the
// dots only pick up about a quarter of it.
function zoomDamp(globalScale: number): number {
  return globalScale > 1 ? globalScale ** -0.75 : 1;
}
// Labels are sized in screen px and take a little of the zoom too, so they do
// not look stranded under a spread-out graph: 8px up to 1:1, 11px from ~3x.
function labelScreenSize(globalScale: number): number {
  return 8 * Math.min(1.4, Math.max(1, globalScale ** 0.3));
}

// --- Zoom-to-fit tuning. Raise either value to make the graph render larger. ---
// Screen-px gutter kept clear around the fitted graph. Sized for a node label
// (5px gap + 8px text) rather than the old blanket 24, which cost ~7% of scale.
const FIT_PADDING = 12;
// Sideways the gutter has to hold half a label, not just a node: labels are
// centred under their node and the ones on the rim reach well past it.
const FIT_PADDING_X = 20;
// Scale applied on top of the exact fit. 1 means the whole graph is on screen.
// This was 1.35 while the graph lived in a 340px column at 55% of its height:
// there a contained graph was too small to read, so the fit deliberately let
// the outer ~20% of nodes fall off the edge. Alone, the graph card now takes
// the column's full width and the card's whole height, which buys back about
// the same scale without cropping anything.
const FIT_FILL = 1;
// The share of the area the graph takes once the card is expanded over the
// editor, and the widths between which the fill eases down to it.
const FIT_FILL_WIDE = 0.72;
const FIT_WIDE_FROM = 520;
const FIT_WIDE_TO = 1100;
// Ceiling so a 2-3 node graph doesn't balloon to fill the panel. Applied after
// FIT_FILL, and it is the binding constraint for small graphs (below ~15 nodes
// the span is short enough that the cap, not the padding, decides the zoom).
const FIT_MAX_ZOOM = 3.5;
// What getGraphBbox assumes each node's radius is: sqrt(nodeVal ?? 1) * nodeRelSize,
// i.e. 1 * 4 with force-graph's defaults, neither of which GraphView overrides.
const FG_ASSUMED_NODE_RADIUS = 4;
// The zoom at which a graph of the given extent exactly fits a visible area,
// scaled by FIT_FILL (1: the whole graph is visible). The cap stays the final
// ceiling so tiny graphs still can't balloon.
function fitZoomFor(bboxW: number, bboxH: number, width: number, height: number): number {
  const exactFit = Math.min(
    (width - FIT_PADDING_X * 2) / bboxW,
    (height - FIT_PADDING * 2) / bboxH
  );
  // A wide area (the expanded card) gets a margin instead of edge-to-edge
  // nodes: the fill eases from 1 at column width down to FIT_FILL_WIDE. It is
  // continuous in width so a resize still scales the graph smoothly.
  const wide = Math.min(1, Math.max(0, (width - FIT_WIDE_FROM) / (FIT_WIDE_TO - FIT_WIDE_FROM)));
  const fill = FIT_FILL + (FIT_FILL_WIDE - FIT_FILL) * wide;
  return Math.min(FIT_MAX_ZOOM, exactFit * fill);
}
// The post-rebuild fit eases rather than cuts, so filter changes don't teleport the camera.
const EARLY_FIT_DURATION = 240;
// The engine-stop fit is a correction, not a move: skip it when it would shift
// the camera by less than this. Otherwise every load ends with a pointless ~2%
// zoom nudge a third of a second after the graph already looked settled.
const LATE_FIT_MIN_DELTA = 0.03;

// Top-degree hubs keep their labels at overview zoom, so the graph stays oriented.
const HUB_LABEL_COUNT = 8;
// Zoom range between the fade threshold and the point labels fully disappear.
const LABEL_FADE_SPAN = 0.4;
// Zoom range over which hub and active-note labels fade out when zooming away.
const ANCHOR_LABEL_FADE_START = 0.45;
const ANCHOR_LABEL_FADE_END = 0.6;

// Labels are laid out per frame in screen space, highest priority first; one that would overlap a label
// already placed is skipped, so dense clusters show their most connected names instead of a pile.
const LABEL_MAX_SCREEN_WIDTH = 132;
const LABEL_GAP_PX = 3;
// Hover focus eases in and out over --dur-base rather than snapping.
const HOVER_FADE_MS = 200;
const HOVER_DIM_ALPHA = 0.08;
// Link ink as a share of the text colour: resting, touching the hovered node, and dimmed away from it.
const LINK_ALPHA = 0.22;
const LINK_ALPHA_FOCUS = 0.65;
const LINK_ALPHA_DIM = 0.05;
// Stays clear of the card edge when following the open note into view.
const FOLLOW_MARGIN_PX = 32;

// A small overshoot for a node growing in, in the spirit of --ease-overshoot (cubic-bezier(.34,1.3,.64,1)).
function easeOvershoot(t: number): number {
  const c1 = 1.1;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

// Matches --ease-out (cubic-bezier(.165,.84,.44,1)) closely enough for a 200ms fade.
function easeOut(t: number): number {
  return 1 - (1 - t) ** 4;
}

// Unresolved links are often paths ("folder/Note.md"); the last segment is the name a reader looks for.
function displayName(node: GraphNode): string {
  const name = node.name ?? '';
  if (!node.ghost) return name;
  return (name.split('/').pop() || name).replace(/\.md$/i, '');
}

function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}…`;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
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
  arrows = false,
  nodeSize = DEFAULT_NODE_SIZE,
  linkThickness = DEFAULT_LINK_THICKNESS,
  groups = NO_GROUPS,
  animateKey = 0,
  showUnresolved = true,
  onClearFilters,
  onEnableHideIsolated,
  forces = DEFAULT_GRAPH_FORCES,
  labelFadeThreshold = DEFAULT_LABEL_FADE_THRESHOLD,
}: GraphViewProps) {
  const isDark = useIsDark(settings.appearance.theme);
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GraphNodeData, GraphLinkData> | undefined>(undefined);
  // Canvas is oversized and CSS-centred; resizing it reallocates the backing store
  // and clears a frame, so adapt to container changes via zoom/pan only.
  const [canvasSize, setCanvasSize] = useState(() => getStableCanvasSize());
  const dimensionsRef = useRef(canvasSize);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  // Time-lapse start, or null. Read per frame from a ref so playback never re-renders React.
  const timelapseStartRef = useRef<number | null>(null);
  // id → when a node newly brought in by a rebuild started entering.
  const enterAtRef = useRef(new Map<string, number>());
  const frameNowRef = useRef(0);
  // While an entry or time-lapse plays, force-graph must keep drawing even though the layout is still.
  const [entryLive, setEntryLive] = useState(false);
  const entryTimerRef = useRef(0);
  const keepDrawing = useCallback((ms: number) => {
    setEntryLive(true);
    window.clearTimeout(entryTimerRef.current);
    entryTimerRef.current = window.setTimeout(() => setEntryLive(false), ms + 50);
  }, []);
  useEffect(() => () => window.clearTimeout(entryTimerRef.current), []);
  // Read by fitView, which is memoised and must not depend on the slider.
  const nodeSizeRef = useRef(nodeSize);
  useEffect(() => {
    nodeSizeRef.current = nodeSize;
  }, [nodeSize]);
  const [perfBannerDismissed, setPerfBannerDismissed] = useState(false);
  // Previous graph's node objects. d3 mutates x/y in place, so this ref always
  // holds the latest settled positions of the last rendered graph.
  const prevNodesRef = useRef<GraphNode[]>([]);
  // Long-lived id → position cache. Unlike prevNodesRef it survives nodes
  // being filtered OUT, so a filter round-trip (tag on → tag off) restores
  // the pre-filter layout instead of re-seeding the returning nodes.
  const positionsCacheRef = useRef(new Map<string, { x: number; y: number }>());
  // Set when a scheduled fit ran while the tab was hidden (rect 0 → fitView
  // bails). The next visible apply() performs the missed fit; without this the
  // graph can stay at the unfitted default camera forever.
  const pendingFitRef = useRef(false);
  const pendingInitialCaptureRef = useRef(true);
  // One-shot per graph rebuild, consumed by the first engine tick.
  const pendingEarlyFitRef = useRef(true);
  const lastFittedViewRef = useRef<{ x: number; y: number; zoom: number } | null>(null);
  // The graph's extent at the last fit, and the fit zoom the camera was last
  // scaled against — what a container resize needs to rescale the view.
  const fittedBoxRef = useRef<{ width: number; height: number } | null>(null);
  const scaledFitZoomRef = useRef<number | null>(null);
  const lastCenterYRef = useRef<number | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const maskOffsetRef = useRef(0);

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
    const radiusShortfall = Math.max(0, NODE_RADIUS_MAX * nodeSizeRef.current - FG_ASSUMED_NODE_RADIUS);
    const bboxW = Math.max(1, bbox.x[1] - bbox.x[0]) + radiusShortfall * 2;
    const bboxH = Math.max(1, bbox.y[1] - bbox.y[0]) + radiusShortfall * 2;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const k = fitZoomFor(bboxW, bboxH, rect.width, rect.height);
    if (!Number.isFinite(k)) return false;
    const nextView = {
      x: (bbox.x[0] + bbox.x[1]) / 2,
      y: (bbox.y[0] + bbox.y[1]) / 2,
      zoom: Math.max(0.01, k),
    };
    lastFittedViewRef.current = nextView;
    scaledFitZoomRef.current = nextView.zoom;
    fittedBoxRef.current = { width: bboxW, height: bboxH };
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

      // The view follows the container, frame for frame: when the card grows
      // or shrinks — expanding over the editor, sharing the column with a
      // second card, the column being dragged — the zoom is scaled by how much
      // the fit for the new size differs from the fit for the old one. Scaled,
      // not re-fitted: whatever the user had panned or zoomed to keeps its
      // proportions instead of being thrown away, and an untouched view stays
      // exactly fitted the whole way through the motion.
      const box = fittedBoxRef.current;
      const previousFitZoom = scaledFitZoomRef.current;
      const fg = fgRef.current;
      // The split between two cards being dragged is a mask sliding over the
      // graph, not a new frame to fit: keep the scale, and counter however far
      // the container's centre moved so every node stays where it was on
      // screen. That is done with a CSS translate, not a camera pan: this
      // callback runs before paint, while the canvas only redraws on its next
      // animation frame — a pan would trail the card by a frame and shake.
      // The fit for the new size is still recorded, so the next real resize
      // scales from the right baseline.
      const centerY = rect.top + rect.height / 2;
      const previousCenterY = lastCenterYRef.current;
      lastCenterYRef.current = centerY;
      if (document.documentElement.hasAttribute('data-pane-split-drag')) {
        if (box) scaledFitZoomRef.current = Math.max(0.01, fitZoomFor(box.width, box.height, rect.width, rect.height));
        if (previousCenterY != null && canvasWrapRef.current) {
          maskOffsetRef.current -= centerY - previousCenterY;
          canvasWrapRef.current.style.transform = `translateY(${maskOffsetRef.current}px)`;
        }
        return;
      }
      if (box && previousFitZoom && fg) {
        const nextFitZoom = Math.max(0.01, fitZoomFor(box.width, box.height, rect.width, rect.height));
        const currentZoom = fg.zoom();
        if (Number.isFinite(nextFitZoom) && currentZoom != null && Math.abs(nextFitZoom - previousFitZoom) > 1e-4) {
          const ratio = nextFitZoom / previousFitZoom;
          scaledFitZoomRef.current = nextFitZoom;
          fg.resumeAnimation();
          fg.zoom(currentZoom * ratio, 0);
          if (lastFittedViewRef.current) lastFittedViewRef.current = { ...lastFittedViewRef.current, zoom: nextFitZoom };
        }
      }

      // Run a fit that was missed while the tab was hidden.
      if (pendingFitRef.current) {
        pendingFitRef.current = false;
        fitView(0);
      }
      // Note: no canvas resize on container resize — the canvas is oversized
      // and CSS-centred, so only the zoom has to follow.
    };

    // When the drag ends the translate is folded into the camera. The pan
    // lands on the canvas's next frame, so the translate is lifted in a frame
    // callback queued after the graph's own — both in the same paint.
    const flagObserver = new MutationObserver(() => {
      if (document.documentElement.hasAttribute('data-pane-split-drag')) return;
      const offset = maskOffsetRef.current;
      const fg = fgRef.current;
      const wrap = canvasWrapRef.current;
      if (offset === 0 || !wrap) return;
      maskOffsetRef.current = 0;
      const zoom = fg?.zoom();
      const center = fg?.centerAt();
      if (fg && center && zoom) {
        fg.resumeAnimation();
        fg.centerAt(center.x, center.y - offset / zoom, 0);
      }
      requestAnimationFrame(() => { wrap.style.transform = ''; });
    });
    flagObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-pane-split-drag'] });

    apply();
    const observer = new ResizeObserver(() => apply());
    observer.observe(container);
    window.addEventListener('resize', apply);
    return () => {
      observer.disconnect();
      flagObserver.disconnect();
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
      createdAt: note.createdAt,
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

  // The card's own surface (RightPanel's PaneCard), not the page's.
  const bgColor   = themeSurfaces(isDark).card;
  const textColor = isDark ? '#F9F9F7' : '#2D2D2B';
  // Links are hairlines of the text ink, not a third hue; mutual links keep the accent.
  const inkRgb = isDark ? '249,249,247' : '45,45,43';
  const accentRgb = '204,125,94';

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

    // Carry surviving nodes' positions across the rebuild. Every filter/search/
    // depth change mints fresh node objects, and d3 re-seeds positionless ones
    // — without this, each keystroke in the filter box jump-cuts to an
    // unfamiliar layout and the user's spatial memory of the graph is lost.
    // The flush must happen here (rebuild time), not in an effect: by now the
    // previous graph's nodes hold their fully settled positions, while an
    // effect right after the rebuild would capture new nodes pre-settle.
    // Genuinely new nodes (no cache entry) still get d3's phyllotaxis seed.
    const cache = positionsCacheRef.current;
    for (const prev of prevNodesRef.current) {
      if (prev.x != null && prev.y != null) cache.set(String(prev.id), { x: prev.x, y: prev.y });
    }
    for (const node of nodes) {
      const pos = cache.get(String(node.id));
      if (pos) {
        node.x = pos.x;
        node.y = pos.y;
      }
    }

    const links: GraphLink[] = model.links.map((link) => ({
      source: link.source,
      target: link.target,
      bidirectional: link.bidirectional,
    }));

    return { nodes, links, timelapseRank: buildTimelapseRanks(model) };
    // topologyKey is a stable hash standing in for the `notes`/`folders` arrays;
    // including them directly would recompute on every parent re-render that
    // produces new array identities even when topology is unchanged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideIsolated, topologyKey, localDepth, localAnchorId, tagFilter, searchQuery, showUnresolved]);

  const { timelapseRank } = graphData;
  // Ranks count real notes only (ghosts share their earliest neighbour's), so the run is spread over the
  // highest rank, not the node count — dividing by the count let ghost-heavy graphs finish in the first instant.
  const timelapseSpan = useMemo(() => {
    let max = 0;
    for (const rank of timelapseRank.values()) if (rank > max) max = rank;
    return max + 1;
  }, [timelapseRank]);

  // Replays the time-lapse on each animateKey bump. Reduced motion shows the full graph at once.
  useEffect(() => {
    if (!animateKey || prefersReducedMotion()) return;
    timelapseStartRef.current = performance.now();
    keepDrawing(TIMELAPSE_MS);
    const timer = window.setTimeout(() => { timelapseStartRef.current = null; }, TIMELAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [animateKey, keepDrawing]);

  // 0 → 1 as a node enters: its time-lapse turn (notes in creation order, spread over the run) and any
  // filter-driven entry, whichever is later.
  const nodeReveal = (id: string): number => {
    const now = frameNowRef.current;
    let reveal = 1;
    const start = timelapseStartRef.current;
    if (start !== null) {
      const turnAt = start + ((timelapseRank.get(id) ?? 0) / timelapseSpan) * (TIMELAPSE_MS - NODE_ENTER_MS);
      reveal = Math.min(reveal, Math.max(0, Math.min(1, (now - turnAt) / NODE_ENTER_MS)));
    }
    const enterAt = enterAtRef.current.get(id);
    if (enterAt !== undefined) reveal = Math.min(reveal, Math.max(0, Math.min(1, (now - enterAt) / NODE_ENTER_MS)));
    return reveal;
  };

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

  // Hover focus transition: the outgoing focus and when the change began. Read on every frame, so a ref.
  // Layout effect so the first frame drawn with the new hover already sees the new start time.
  const hoverFadeRef = useRef<{ fromNeighbours: Set<string> | null; fromId: string | null; start: number }>({ fromNeighbours: null, fromId: null, start: 0 });
  const lastHoverRef = useRef<{ neighbours: Set<string> | null; id: string | null }>({ neighbours: null, id: null });
  const hoverMixRef = useRef(1);
  // Truncated label text and its width in screen px, keyed by font + size + name. Measured at screen size so
  // the result holds across zoom; without it every frame re-measured every label.
  const labelCacheRef = useRef(new Map<string, { text: string; width: number }>());
  const [hoverFading, setHoverFading] = useState(false);
  useLayoutEffect(() => {
    hoverFadeRef.current = { fromNeighbours: lastHoverRef.current.neighbours, fromId: lastHoverRef.current.id, start: performance.now() };
    lastHoverRef.current = { neighbours: hoveredNeighbours, id: hoveredNodeId };
    if (prefersReducedMotion()) {
      hoverFadeRef.current.start = 0;
      return;
    }
    // Keep the canvas redrawing for the length of the fade; force-graph otherwise pauses once the layout is still.
    setHoverFading(true);
    const timer = window.setTimeout(() => setHoverFading(false), HOVER_FADE_MS + 50);
    return () => window.clearTimeout(timer);
  }, [hoveredNeighbours, hoveredNodeId]);

  const nodeHoverAlpha = (id: string): number => {
    const target = hoveredNeighbours && !hoveredNeighbours.has(id) ? HOVER_DIM_ALPHA : 1;
    const from = hoverFadeRef.current.fromNeighbours;
    const origin = from && !from.has(id) ? HOVER_DIM_ALPHA : 1;
    return origin + (target - origin) * hoverMixRef.current;
  };

  const linkAlphaFor = (focusId: string | null, src: string, tgt: string): number => {
    if (!focusId) return LINK_ALPHA;
    return src === focusId || tgt === focusId ? LINK_ALPHA_FOCUS : LINK_ALPHA_DIM;
  };
  const linkHoverAlpha = (link: GraphLink): number => {
    const src = readLinkEndpointId(link.source);
    const tgt = readLinkEndpointId(link.target);
    const origin = linkAlphaFor(hoverFadeRef.current.fromId, src, tgt);
    const target = linkAlphaFor(hoveredNodeId, src, tgt);
    return origin + (target - origin) * hoverMixRef.current;
  };

  const linkReveal = (link: GraphLink): number =>
    Math.min(nodeReveal(readLinkEndpointId(link.source)), nodeReveal(readLinkEndpointId(link.target)));

  // Top-degree real nodes whose labels stay on regardless of zoom.
  const hubLabelIds = useMemo(() => {
    const ranked = graphData.nodes
      .filter((node) => !node.ghost && (node.degree ?? 0) > 0)
      .sort((a, b) => (b.degree ?? 0) - (a.degree ?? 0));
    return new Set(ranked.slice(0, HUB_LABEL_COUNT).map((node) => String(node.id)));
  }, [graphData]);

  // Dynamic physics based on node count
  useEffect(() => {
    if (!fgRef.current) return;
    const n = graphData.nodes.length;

    // Repulsion: breathing room without scattering
    const chargeForce = fgRef.current.d3Force('charge');
    if (hasStrength(chargeForce)) {
      chargeForce.strength(graphChargeStrength(n) * forces.repel);
    }
    // Link distance: short lines, tight graph
    const linkForce = fgRef.current.d3Force('link');
    if (hasDistance(linkForce)) {
      linkForce.distance(graphLinkDistance(n) * forces.distance);
    }
    if (hasStrength(linkForce)) {
      linkForce.strength(LINK_STRENGTH * forces.link);
    }
    // Collide padding pushes nodes apart enough that labels don't crash.
    const collide = forceCollide((node: GraphNode) => nodeRadius(node.degree ?? 0, nodeSize) + 6).iterations(3);
    fgRef.current.d3Force('collide', collide);
    // Centering forces target the world ORIGIN, which is where force-graph parks
    // the camera (adjustCanvasSize translates the world origin to the canvas
    // centre). Canvas pixel dimensions are NOT world coords — targeting
    // width/2,height/2 pushed the layout hundreds of world units past the visible
    // crop, so the whole settle happened off-screen until the engine-stop fit
    // chased it. The origin is also maximally stable: no resize can move it.
    fgRef.current.d3Force('center', forceCenter(0, 0).strength(0.2 * forces.center));
    fgRef.current.d3Force('x', forceX(0).strength(graphCenteringStrength(n) * forces.center));
    fgRef.current.d3Force('y', forceY(0).strength(graphCenteringStrength(n) * forces.center));
    fgRef.current.d3Force('radial', null);
    // Reheat so updated forces actually move existing nodes; otherwise the
    // simulation sits at alpha≈0 and parameter changes are invisible.
    fgRef.current.d3ReheatSimulation();
    // Depend on graphData identity, not just node count: an in-flight reset
    // animation zeroes charge/link strengths, so every rebuild must reapply
    // them even when the node count is unchanged.
  }, [graphData, nodeSize, forces]);

  useEffect(() => {
    // Hand the new node objects to the position carry-over above. d3 mutates
    // these in place from here on, so the ref stays current until the next
    // rebuild reads it.
    const previousIds = new Set(prevNodesRef.current.map((node) => String(node.id)));
    const entering = previousIds.size > 0 && !prefersReducedMotion()
      ? graphData.nodes.filter((node) => !previousIds.has(String(node.id)))
      : [];
    enterAtRef.current = new Map(entering.map((node) => [String(node.id), performance.now()]));
    if (entering.length > 0) keepDrawing(NODE_ENTER_MS);
    prevNodesRef.current = graphData.nodes;
    if (!fgRef.current) return;
    // The hovered node may not exist in the rebuilt graph; a stale id would
    // dim every node and link with no way to recover until the next hover.
    setHoveredNodeId(null);
    pendingInitialCaptureRef.current = true;
    pendingEarlyFitRef.current = true;
  }, [graphData, keepDrawing]);

  // Opening a note that sits outside the visible card pans it into view, like scrollIntoView({ block: 'nearest' }):
  // a note already on screen leaves the camera alone. Reads refs so graph rebuilds don't re-trigger it.
  useEffect(() => {
    if (!activeNoteId || localDepth > 0) return;
    const fg = fgRef.current;
    const container = containerRef.current;
    const node = prevNodesRef.current.find((candidate) => String(candidate.id) === activeNoteId);
    if (!fg || !container || !node || node.x == null || node.y == null) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const { x: sx, y: sy } = fg.graph2ScreenCoords(node.x, node.y);
    const offsetX = (dimensionsRef.current.width - rect.width) / 2;
    const offsetY = (dimensionsRef.current.height - rect.height) / 2;
    const inView =
      sx >= offsetX + FOLLOW_MARGIN_PX && sx <= offsetX + rect.width - FOLLOW_MARGIN_PX &&
      sy >= offsetY + FOLLOW_MARGIN_PX && sy <= offsetY + rect.height - FOLLOW_MARGIN_PX;
    if (inView) return;
    fg.centerAt(node.x, node.y, prefersReducedMotion() ? 0 : 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a note switch should move the camera
  }, [activeNoteId]);

  // Fit off force-graph's tick, not a rAF: the first tick is the earliest point where the bbox is
  // both populated and current (a rAF can run before the digest, or still see the previous graph).
  const handleEngineTick = useCallback(() => {
    if (!pendingEarlyFitRef.current) return;
    // Skip the fit when the camera is already within 3% of it, so an unchanged layout doesn't get a pointless nudge.
    if (fitView(prefersReducedMotion() ? 0 : EARLY_FIT_DURATION, LATE_FIT_MIN_DELTA)) pendingEarlyFitRef.current = false;
  }, [fitView]);

  const captureInitialLayout = useCallback(() => {
    if (!pendingInitialCaptureRef.current) return;
    pendingInitialCaptureRef.current = false;

    // Fit only after the force engine has frozen the layout. Hidden graph tabs
    // defer the fit until their container has non-zero dimensions.
    const didFit = fitView(prefersReducedMotion() ? 0 : 300, LATE_FIT_MIN_DELTA);
    pendingFitRef.current = !didFit;
  }, [fitView]);

  const fontFamily = resolveFontFamily(settings.appearance.fontFamily);

  // Pick node fill color: ghost (muted) > tag color > accent (connected) > grey (isolated)
  const getNodeColor = useCallback((node: GraphNode): string => {
    if (node.ghost) return isDark ? '#8A8070' : '#9A9080';
    const groupColor = matchGraphGroup({ title: node.name ?? '', tags: node.tags ?? [] }, groups);
    if (groupColor) return groupColor;
    if (colorMode === 'tag') {
      const tags: string[] = node.tags ?? [];
      for (const tag of tags) {
        const c = tagColorMap.get(tag);
        if (c) return c;
      }
    }
    return (node.degree ?? 0) > 0 ? nodeColor : (isDark ? '#5A5648' : '#B0AA9E');
  }, [tagColorMap, nodeColor, isDark, colorMode, groups]);

  // Re-arm the perf banner once the graph shrinks back below the threshold.
  const overPerfThreshold = graphData.nodes.length > GRAPH_PERF_WARN_THRESHOLD;
  useEffect(() => {
    if (!overPerfThreshold) setPerfBannerDismissed(false);
  }, [overPerfThreshold]);

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden flex items-center justify-center">
      {overPerfThreshold && !perfBannerDismissed && (
        <div className="absolute top-2 left-2 right-2 z-10 border border-[#CC7D5E]/60 bg-[#F9F9F7]/90 px-3 py-1.5 text-xs text-[#2D2D2B]/70 font-ui flex items-center justify-between gap-2">
          <span>Graph contains {graphData.nodes.length} nodes and may render slowly.</span>
          <span className="flex items-center gap-2 shrink-0">
            {onEnableHideIsolated && (
              <button
                type="button"
                onClick={onEnableHideIsolated}
                className="transition-colors hover:text-[#CC7D5E] underline underline-offset-2"
              >
                Hide isolated nodes
              </button>
            )}
            <button
              type="button"
              onClick={() => setPerfBannerDismissed(true)}
              aria-label="Dismiss performance warning"
              className="transition-colors hover:text-[#CC7D5E] leading-none"
            >
              ×
            </button>
          </span>
        </div>
      )}
      <div ref={canvasWrapRef} style={{ width: canvasSize.width, height: canvasSize.height, flexShrink: 0 }}>
      <ForceGraph2D
        ref={fgRef}
        width={canvasSize.width}
        height={canvasSize.height}
        graphData={graphData}
        nodeLabel="name"
        backgroundColor={bgColor}
        linkColor={(link: GraphLink) => `rgba(${link.bidirectional ? accentRgb : inkRgb},${linkHoverAlpha(link) * linkReveal(link)})`}
        linkWidth={(link: GraphLink) => {
          const src = readLinkEndpointId(link.source);
          const tgt = readLinkEndpointId(link.target);
          const focused = hoveredNodeId != null && (src === hoveredNodeId || tgt === hoveredNodeId);
          return (link.bidirectional ? 1.5 : 1) * (focused ? 1.5 : 1) * linkThickness;
        }}
        linkDirectionalArrowLength={(link: GraphLink) => arrows && !link.bidirectional ? 4 : 0}
        // Notes still waiting for their time-lapse turn are hidden (and unhoverable); links wait for both ends.
        nodeVisibility={(node: GraphNode) => nodeReveal(String(node.id)) > 0}
        linkVisibility={(link: GraphLink) => nodeReveal(readLinkEndpointId(link.source)) > 0 && nodeReveal(readLinkEndpointId(link.target)) > 0}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={(link: GraphLink) => `rgba(${inkRgb},${Math.min(1, linkHoverAlpha(link) * 1.6) * linkReveal(link)})`}
        onNodeClick={(node: GraphNode) => {
          // Ghost nodes are unresolved links — there is no note to open.
          if (node.ghost) return;
          onNavigateToNoteById(String(node.id));
        }}
        onNodeHover={(node: GraphNode | null) => setHoveredNodeId(node ? String(node.id) : null)}
        enableNodeDrag={true}
        // Pan is disabled while hovering so it can't race the node-drag handler; a ref-based predicate would be read too early on mousedown.
        enablePanInteraction={!hoveredNodeId}
        enableZoomInteraction={true}
        // Most of the settle happens in warmupTicks (pre-paint); cooldown only polishes leaf positions.
        warmupTicks={graphWarmupTicks(graphData.nodes.length)}
        cooldownTicks={graphCooldownTicks(graphData.nodes.length)}
        cooldownTime={graphCooldownTime(graphData.nodes.length)}
        d3AlphaDecay={graphData.nodes.length > 200 ? 0.05 : 0.025}
        d3VelocityDecay={graphData.nodes.length > 200 ? 0.65 : 0.5}
        onEngineTick={handleEngineTick}
        onEngineStop={captureInitialLayout}
        autoPauseRedraw={!hoverFading && !entryLive}
        onRenderFramePre={() => {
          frameNowRef.current = performance.now();
          const { start } = hoverFadeRef.current;
          hoverMixRef.current = start === 0 ? 1 : easeOut(Math.min(1, (performance.now() - start) / HOVER_FADE_MS));
        }}
        onRenderFramePost={(ctx, globalScale) => {
          // Labels go on last, above every node and link, placed greedily by priority.
          // ctx is already scaled by globalScale, so dividing keeps labels at a set screen size. Do NOT floor this in
          // world units — a `Math.max(6, …)` floor only bites past zoom 1.33 and then grows labels linearly with zoom.
          // The small end is handled by the label alpha fading out, not by a size floor.
          const screenSize = Math.round(labelScreenSize(globalScale) * 4) / 4;
          const fontSize = screenSize / globalScale;
          const cache = labelCacheRef.current;
          if (cache.size > 5000) cache.clear();
          ctx.save();
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const labelFadeStart = labelFadeThreshold - LABEL_FADE_SPAN;
          const zoomLabelAlpha = Math.min(1, Math.max(0, (globalScale - labelFadeStart) / (labelFadeThreshold - labelFadeStart)));
          const anchorLabelAlpha = Math.min(1, Math.max(0, (globalScale - ANCHOR_LABEL_FADE_START) / (ANCHOR_LABEL_FADE_END - ANCHOR_LABEL_FADE_START)));
          const candidates: { node: GraphNode; priority: number; alpha: number; strong: boolean }[] = [];
          for (const node of graphData.nodes) {
            if (node.x == null || node.y == null) continue;
            const id = String(node.id);
            const reveal = nodeReveal(id);
            if (reveal <= 0) continue;
            const isHovered = hoveredNodeId === id;
            const isActive = activeNoteId === id;
            const isAnchor = isActive || hubLabelIds.has(id);
            const isNeighbour = !isHovered && hoveredNeighbours?.has(id) === true;
            const zoomAlpha = isHovered ? 1 : isAnchor ? anchorLabelAlpha : isNeighbour ? Math.max(zoomLabelAlpha, anchorLabelAlpha) : zoomLabelAlpha;
            const alpha = zoomAlpha * nodeHoverAlpha(id) * (node.ghost ? 0.6 : 1) * reveal;
            if (alpha <= 0.02) continue;
            const priority = isHovered ? 4e6 : isActive ? 3e6 : isNeighbour ? 2e6 + (node.degree ?? 0) : isAnchor ? 1e6 + (node.degree ?? 0) : node.degree ?? 0;
            candidates.push({ node, priority, alpha, strong: isHovered || isAnchor || isNeighbour });
          }
          candidates.sort((a, b) => b.priority - a.priority);
          ctx.font = `${fontSize}px ${fontFamily}`;
          const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
          const gap = LABEL_GAP_PX / globalScale;
          for (const { node, alpha, strong, priority } of candidates) {
            const radius = nodeRadius(node.degree ?? 0, nodeSize) * zoomDamp(globalScale);
            const full = displayName(node);
            const hovered = priority >= 4e6;
            const key = `${hovered ? 'f' : 't'}|${screenSize}|${fontFamily}|${full}`;
            let measured = cache.get(key);
            if (!measured) {
              ctx.font = `${screenSize}px ${fontFamily}`;
              const text = hovered ? full : truncateToWidth(ctx, full, LABEL_MAX_SCREEN_WIDTH);
              measured = { text, width: ctx.measureText(text).width };
              cache.set(key, measured);
              ctx.font = `${fontSize}px ${fontFamily}`;
            }
            const text = measured.text;
            const width = measured.width / globalScale;
            const x = node.x!;
            const y = node.y! + radius + 4 / globalScale;
            const box = { x0: x - width / 2 - gap, y0: y - gap, x1: x + width / 2 + gap, y1: y + fontSize + gap };
            // The hovered label always draws; everything else yields to what's already placed.
            if (priority < 4e6 && placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) continue;
            placed.push(box);
            ctx.globalAlpha = alpha * (strong ? 1 : 0.62);
            ctx.shadowColor = bgColor;
            ctx.shadowBlur = 4;
            ctx.fillStyle = textColor;
            ctx.fillText(text, x, y);
          }
          ctx.restore();
        }}
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
          const reveal = nodeReveal(String(node.id));
          const radius = nodeRadius(degree, nodeSize) * zoomDamp(globalScale) * (reveal < 1 ? Math.max(0, easeOvershoot(reveal)) : 1);
          const isActive = activeNoteId && String(node.id) === activeNoteId;
          const isHovered = hoveredNodeId === String(node.id);
          // Ghosts render faded (Obsidian's unresolved-node treatment).
          const alpha = nodeHoverAlpha(String(node.id)) * (node.ghost ? 0.35 : 1) * Math.min(1, reveal * 1.6);

          ctx.save();
          ctx.globalAlpha = alpha;

          const fillColor = getNodeColor(node);

          // Node fill
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
          ctx.fillStyle = fillColor;
          ctx.fill();

          // Selection ring: full weight when active, lighter on hover, so the two states stay distinct.
          if (isActive || isHovered) {
            ctx.strokeStyle = textColor;
            ctx.lineWidth = (isActive ? 1.5 : 1) / globalScale;
            ctx.stroke();
          }

          ctx.restore();
        }}
        nodePointerAreaPaint={(node: GraphNode, color, ctx, globalScale) => {
          if (node.x == null || node.y == null) return;
          const radius = nodeRadius(node.degree ?? 0, nodeSize) * zoomDamp(globalScale);
          ctx.fillStyle = color;
          ctx.beginPath();
          // Hit area is 8 screen px larger than the node; divided by globalScale so it doesn't balloon when zoomed in.
          ctx.arc(node.x, node.y, radius + 8 / globalScale, 0, 2 * Math.PI);
          ctx.fill();
        }}
      />
      </div>
      {graphData.nodes.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-6 text-center pointer-events-none">
          {/* 70% is the contrast floor for 12px text on these surfaces. */}
          <p className={`text-xs font-ui ${isDark ? 'text-[rgba(249,249,247,0.7)]' : 'text-[rgba(45,45,43,0.7)]'}`}>
            {notes.length === 0 ? 'No notes to graph yet' : 'No notes match the current filters'}
          </p>
          {notes.length > 0 && onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className={`noa-graph-control-surface noa-graph-control-button pointer-events-auto h-5 rounded-md px-2 text-micro font-ui transition-colors hover:text-[#CC7D5E] ${
                isDark ? 'text-[rgba(249,249,247,0.7)]' : 'text-[rgba(45,45,43,0.7)]'
              }`}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
      {/* Nodes and labels dissolve into the card's top and bottom edges rather than being cut off there. Card-coloured
          washes, not a mask: a mask on the container would fade the banner and focus list above too. Eased stops,
          as the other edge fades use; below z-10 so those overlays stay crisp. */}
      {(['top', 'bottom'] as const).map((edge) => (
        <div
          key={edge}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 z-[5] h-7 ${edge === 'top' ? 'top-0' : 'bottom-0'}`}
          style={{ background: `linear-gradient(to ${edge === 'top' ? 'bottom' : 'top'}, ${bgColor} 0%, color-mix(in srgb, ${bgColor} 84%, transparent) 25%, color-mix(in srgb, ${bgColor} 50%, transparent) 50%, color-mix(in srgb, ${bgColor} 16%, transparent) 75%, transparent 100%)` }}
        />
      ))}
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
              className={`sr-only focus:not-sr-only focus:block focus:max-w-56 focus:truncate focus:rounded-md focus:border focus:px-2 focus:py-1 focus:text-xs focus:font-ui focus:outline-none ${
                isDark ? 'focus:bg-[var(--bg-secondary)] focus:text-[#F9F9F7]' : 'focus:bg-[#FCFCFB] focus:text-[#2D2D2B]'
              }`}
            >
              {node.name}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
