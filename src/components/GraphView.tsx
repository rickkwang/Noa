import React, { useMemo, useEffect, useRef } from 'react';
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

type GraphNodeData = {
  id: string;
  name: string;
  degree: number;
};

type GraphLinkData = {
  bidirectional: boolean;
};

type GraphNode = NodeObject<GraphNodeData>;
type GraphLink = LinkObject<GraphNodeData, GraphLinkData>;

type TopologyNote = Pick<Note, 'id' | 'title' | 'links' | 'linkRefs'>;

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

export default function GraphView({ notes, onNavigateToNoteById, settings, searchQuery = '', activeNoteId, width, height, hideIsolated = false }: GraphViewProps) {
  const isDark = useIsDark(settings.appearance.theme);
  const fgRef = useRef<ForceGraphMethods<GraphNodeData, GraphLinkData> | undefined>(undefined);
  const topologyNotes = useMemo(
    () => notes.map((note) => ({ id: note.id, title: note.title, links: note.links ?? [], linkRefs: note.linkRefs ?? [] })),
    [notes]
  );
  const topologyKey = useMemo(
    () => computeTopologySignature(topologyNotes),
    [topologyNotes]
  );
  const stableTopologyRef = useRef<{ key: string; notes: TopologyNote[] }>({
    key: topologyKey,
    notes: topologyNotes,
  });

  // Obsidian 风格：节点小而精，degree 仅轻微放大
  const nodeRadius = (degree: number) => 3 + Math.sqrt(degree) * 1.2;

  const bgColor   = isDark ? '#1C1A17' : '#EAE8E0';
  const linkColor = isDark ? '#8A8070' : '#9A9080';
  const textColor = isDark ? '#E8E0D0' : '#2D2D2D';

  const accentColors: Record<string, string> = {
    gold: '#B89B5E', blue: '#4A90E2', green: '#50E3C2', purple: '#9013FE', red: '#D0021B',
  };
  const nodeColor = accentColors[settings.appearance.accentColor] ?? settings.appearance.accentColor ?? '#B89B5E';

  useEffect(() => {
    if (stableTopologyRef.current.key === topologyKey) return;
    stableTopologyRef.current = {
      key: topologyKey,
      notes: topologyNotes,
    };
  }, [topologyKey, topologyNotes]);

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const nodeMap = new Map<string, GraphNode>();
    const degreeMap = new Map<string, number>();
    const topologyNotes = stableTopologyRef.current.notes;
    const titleToIds = buildTitleToIdsMap(topologyNotes);

    topologyNotes.forEach(note => {
      const node: GraphNode = { id: note.id, name: note.title, degree: 0 };
      nodes.push(node);
      nodeMap.set(note.id, node);
      degreeMap.set(note.id, 0);
    });

    const edgeSet = new Set<string>();
    const edgeMap = new Map<string, GraphLink>();

    topologyNotes.forEach(note => {
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

  // 力参数：紧凑布局，物理稳定后自动 zoomToFit
  useEffect(() => {
    if (!fgRef.current) return;
    const chargeForce = fgRef.current.d3Force('charge');
    if (hasStrength(chargeForce)) {
      chargeForce.strength(-40);
    }
    const linkForce = fgRef.current.d3Force('link');
    if (hasDistance(linkForce)) {
      linkForce.distance(30);
    }
    const collide = forceCollide((node: GraphNode) => nodeRadius(node.degree ?? 0) + 6);
    fgRef.current.d3Force('collide', collide);
  }, []);

  // graphData 变化后重新 zoomToFit，确保所有节点在视口内
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

  const zoomControls = [
    { label: '+', action: () => { const cur = fgRef.current?.zoom(); if (cur != null) fgRef.current?.zoom(cur * 1.3, 200); } },
    { label: '−', action: () => { const cur = fgRef.current?.zoom(); if (cur != null) fgRef.current?.zoom(cur * 0.77, 200); } },
    { label: '⊡', action: () => fgRef.current?.zoomToFit(300, 24) },
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
        if (lowerSearch) {
          const srcMatch = readLinkEndpointTitle(link.source, idToTitle).toLowerCase().includes(lowerSearch);
          const tgtMatch = readLinkEndpointTitle(link.target, idToTitle).toLowerCase().includes(lowerSearch);
          if (!srcMatch && !tgtMatch) return `${linkColor}30`;
        }
        return link.bidirectional ? nodeColor : linkColor;
      }}
      linkWidth={(link: GraphLink) => link.bidirectional ? 2.5 : 1.5}
      onNodeClick={(node: GraphNode) => onNavigateToNoteById(String(node.id))}
      enableNodeDrag={true}
      onNodeDragEnd={(node: GraphNode) => {
        // 拖拽结束后固定节点位置，不再被物理模拟拉回
        node.fx = node.x;
        node.fy = node.y;
      }}
      nodeCanvasObject={(node: GraphNode, ctx, globalScale) => {
        const degree = node.degree ?? 0;
        const radius = nodeRadius(degree);
        const isActive = activeNoteId && String(node.id) === activeNoteId;
        const matched = !lowerSearch || node.name.toLowerCase().includes(lowerSearch);

        ctx.save();
        ctx.globalAlpha = lowerSearch ? (matched ? 1 : 0.12) : 1;

        // 活跃节点外发光圈（Obsidian 风格）
        if (isActive) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 3 / globalScale, 0, 2 * Math.PI);
          ctx.fillStyle = nodeColor + '40';
          ctx.fill();
        }

        // Node fill
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = isActive ? nodeColor : (isDark ? '#8A8070' : '#9A9080');
        ctx.fill();

        // 有连接的节点用 accent 色，孤立节点用灰色（Obsidian 风格）
        if (degree > 0) {
          ctx.fillStyle = nodeColor;
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
          ctx.fill();
        }

        // 活跃节点加边框
        if (isActive) {
          ctx.strokeStyle = textColor;
          ctx.lineWidth = 1.5 / globalScale;
          ctx.stroke();
        }

        // 标签：节点少时低缩放即显示，节点多时需更高缩放避免重叠
        const labelThreshold = graphData.nodes.length > 50 ? 1.2 : 0.5;
        if (globalScale >= labelThreshold) {
          const fontSize = 10 / globalScale;
          ctx.font = `${fontSize}px ${fontFamily}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = isDark ? '#E8E0D0AA' : '#2D2D2DAA';
          ctx.fillText(node.name, node.x, node.y + radius + 2 / globalScale);
        }

        ctx.restore();
      }}
      nodePointerAreaPaint={(node: GraphNode, color, ctx) => {
        const radius = nodeRadius(node.degree ?? 0);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 4, 0, 2 * Math.PI);
        ctx.fill();
      }}
    />
    <div className="absolute bottom-2 right-2 flex flex-col gap-0.5">
      {zoomControls.map(({ label, action }) => (
        <button
          key={label}
          onClick={action}
          className="w-5 h-5 border border-[#2D2D2D]/40 bg-[#DCD9CE]/80 text-[10px] font-bold text-[#2D2D2D]/60 hover:bg-[#DCD9CE] hover:text-[#2D2D2D] active:opacity-70 font-redaction flex items-center justify-center"
        >
          {label}
        </button>
      ))}
    </div>
    </div>
  );
}
