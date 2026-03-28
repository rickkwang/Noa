import React, { useMemo, useEffect, useRef } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { forceCollide } from 'd3-force';
import { Note } from '../types';
import { AppSettings } from '../types';
import { useIsDark } from '../hooks/useIsDark';

interface GraphViewProps {
  notes: Note[];
  onNavigateToNote: (title: string) => void;
  settings: AppSettings;
  searchQuery?: string;
  activeNoteTitle?: string;
  width: number;
  height: number;
  hideIsolated?: boolean;
}

export default function GraphView({ notes, onNavigateToNote, settings, searchQuery = '', activeNoteTitle, width, height, hideIsolated = false }: GraphViewProps) {
  const isDark = useIsDark(settings.appearance.theme);
  const fgRef = useRef<any>(null);

  // Obsidian 风格：节点小而精，degree 仅轻微放大
  const nodeRadius = (degree: number) => 3 + Math.sqrt(degree) * 1.2;

  const bgColor   = isDark ? '#1C1A17' : '#EAE8E0';
  const linkColor = isDark ? '#8A8070' : '#9A9080';
  const textColor = isDark ? '#E8E0D0' : '#2D2D2D';

  const accentColors: Record<string, string> = {
    gold: '#B89B5E', blue: '#4A90E2', green: '#50E3C2', purple: '#9013FE', red: '#D0021B',
  };
  const nodeColor = accentColors[settings.appearance.accentColor] ?? settings.appearance.accentColor ?? '#B89B5E';

  // 修复1：只在拓扑结构（id/title/links）变化时重算，避免编辑内容触发节点抖动
  const graphKey = useMemo(
    () => notes.map(n => `${n.id}:${n.title}:${(n.links ?? []).join(',')}`).join('|'),
    [notes]
  );

  const graphData = useMemo(() => {
    const nodes: any[] = [];
    const links: any[] = [];
    const nodeMap = new Map<string, any>();
    const degreeMap = new Map<string, number>();

    notes.forEach(note => {
      const node = { id: note.title, name: note.title };
      nodes.push(node);
      nodeMap.set(note.title, node);
      degreeMap.set(note.title, 0);
    });

    const edgeSet = new Set<string>();

    notes.forEach(note => {
      if (note.links) {
        note.links.forEach(linkTarget => {
          if (nodeMap.has(linkTarget)) {
            const edgeKey = [note.title, linkTarget].sort().join('→');
            if (!edgeSet.has(edgeKey)) {
              edgeSet.add(edgeKey);
              links.push({ source: note.title, target: linkTarget, bidirectional: false });
            } else {
              const existing = links.find(
                l => (l.source === note.title && l.target === linkTarget) ||
                     (l.source === linkTarget && l.target === note.title)
              );
              if (existing) existing.bidirectional = true;
            }
            degreeMap.set(linkTarget, (degreeMap.get(linkTarget) ?? 0) + 1);
            degreeMap.set(note.title, (degreeMap.get(note.title) ?? 0) + 1);
          }
        });
      }
    });

    nodes.forEach(n => {
      n.degree = degreeMap.get(n.name) ?? 0;
    });

    const filteredNodes = hideIsolated ? nodes.filter(n => n.degree > 0) : nodes;
    const nodeSet = new Set(filteredNodes.map(n => n.id));
    const filteredLinks = hideIsolated
      ? links.filter(l => nodeSet.has(l.source as string) && nodeSet.has(l.target as string))
      : links;

    return { nodes: filteredNodes, links: filteredLinks };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey, hideIsolated]);

  // 力参数：紧凑布局，物理稳定后自动 zoomToFit
  useEffect(() => {
    if (!fgRef.current) return;
    fgRef.current.d3Force('charge').strength(-40);
    fgRef.current.d3Force('link').distance(30);
    const collide = forceCollide((node: any) => nodeRadius(node.degree ?? 0) + 6);
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
    <ForceGraph2D
      ref={fgRef}
      width={width}
      height={height}
      graphData={graphData}
      nodeLabel="name"
      backgroundColor={bgColor}
      linkColor={(link: any) => {
        if (lowerSearch) {
          const srcMatch = (link.source?.name ?? link.source ?? '').toLowerCase().includes(lowerSearch);
          const tgtMatch = (link.target?.name ?? link.target ?? '').toLowerCase().includes(lowerSearch);
          if (!srcMatch && !tgtMatch) return `${linkColor}30`;
        }
        return link.bidirectional ? nodeColor : linkColor;
      }}
      linkWidth={(link: any) => link.bidirectional ? 2.5 : 1.5}
      onNodeClick={(node: any) => onNavigateToNote(node.name)}
      enableNodeDrag={true}
      onNodeDragEnd={(node: any) => {
        // 拖拽结束后固定节点位置，不再被物理模拟拉回
        node.fx = node.x;
        node.fy = node.y;
      }}
      nodeCanvasObject={(node: any, ctx, globalScale) => {
        const degree = node.degree ?? 0;
        const radius = nodeRadius(degree);
        const isActive = activeNoteTitle && node.name === activeNoteTitle;
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
      nodePointerAreaPaint={(node: any, color, ctx) => {
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
