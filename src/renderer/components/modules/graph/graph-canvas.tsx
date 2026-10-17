import { t } from "@shared/l10n";
import type { GraphEdge, GraphNode } from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cls } from "reactutils";

/**
 * Production-grade Graph Canvas inspired by Neurite & Obsidian:
 * - Dynamic organic bezier connectors with neural flow pulses
 * - Interactive Minimap with viewport tracker
 * - Configurable force physics (repulsion, spring distance, gravity)
 * - Smooth camera transitions (flyTo lerp easing)
 * - Cluster/Community and Kind coloring modes
 * - Temporal filtering and search spotlight
 */

export interface PhysicsConfig {
  repulsion: number;
  linkDistance: number;
  centerPull: number;
  damping: number;
}

export const DEFAULT_PHYSICS: PhysicsConfig = {
  repulsion: 14000,
  linkDistance: 130,
  centerPull: 0.0025,
  damping: 0.85,
};

export interface SimNode {
  id: string;
  node: GraphNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  held: boolean;
  color?: string;
}

interface Sim {
  nodes: SimNode[];
  byId: Map<string, SimNode>;
  alpha: number;
  fitted: boolean;
}

interface ViewTransform {
  k: number;
  x: number;
  y: number;
}

const ALPHA_DECAY = 0.96;
const ALPHA_MIN = 0.004;
const MAX_SPEED = 16;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 3.5;

// Distinct palette for cluster/community grouping
const CLUSTER_COLORS = [
  "#31895f",
  "#3b82f6",
  "#a855f7",
  "#f59e0b",
  "#ec4899",
  "#14b8a6",
  "#6366f1",
  "#f97316",
  "#06b6d4",
  "#84cc16",
];

function getClusterColor(clusterId: string | undefined): string {
  if (!clusterId) return "var(--imb-accent)";
  let hash = 0;
  for (let i = 0; i < clusterId.length; i++) {
    hash = (hash * 31 + clusterId.charCodeAt(i)) | 0;
  }
  return CLUSTER_COLORS[Math.abs(hash) % CLUSTER_COLORS.length];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function radiusFor(node: GraphNode): number {
  const base = node.kind === "employee" ? 11 : node.kind === "tag" ? 7 : 6.5;
  const gain = node.kind === "employee" ? 1.8 : 1.15;
  const cap = node.kind === "employee" ? 26 : 21;
  return Math.min(base + Math.sqrt(Math.max(node.weight, 0)) * gain, cap);
}

function truncate(label: string, max = 24): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function getOrganicPath(
  a: SimNode,
  b: SimNode,
  edgeId: string,
  curvatureFactor = 0.12,
): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;

  let hash = 0;
  for (let i = 0; i < edgeId.length; i++) {
    hash = (hash * 31 + edgeId.charCodeAt(i)) | 0;
  }
  const sign = hash % 2 === 0 ? 1 : -1;
  const offset = Math.min(dist * curvatureFactor, 36) * sign;

  const nx = -dy / dist;
  const ny = dx / dist;

  const cx = (a.x + b.x) / 2 + nx * offset;
  const cy = (a.y + b.y) / 2 + ny * offset;

  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

function tick(
  sim: Sim,
  edges: readonly GraphEdge[],
  physics: PhysicsConfig,
): void {
  const nodes = sim.nodes;
  const alpha = sim.alpha;

  // Pairwise repulsion
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        dx = i % 2 === 0 ? 0.5 : -0.5;
        dy = j % 2 === 0 ? 0.5 : -0.5;
        d2 = 0.5;
      }
      const dist = Math.sqrt(d2);
      // Collision padding
      const minDistance = a.r + b.r + 6;
      let force = (physics.repulsion * alpha) / (d2 + 400);
      if (dist < minDistance) {
        force += ((minDistance - dist) / minDistance) * 2.5 * alpha;
      }

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.held) {
        a.vx -= fx;
        a.vy -= fy;
      }
      if (!b.held) {
        b.vx += fx;
        b.vy += fy;
      }
    }
  }

  // Edge springs
  for (const edge of edges) {
    const a = sim.byId.get(edge.source);
    const b = sim.byId.get(edge.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 0.1;
    const delta = dist - physics.linkDistance;
    const force = delta * 0.035 * alpha;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    if (!a.held) {
      a.vx += fx;
      a.vy += fy;
    }
    if (!b.held) {
      b.vx += fx;
      b.vy += fy;
    }
  }

  // Center pull and damping
  for (const node of nodes) {
    if (node.held) continue;
    node.vx -= node.x * physics.centerPull * alpha;
    node.vy -= node.y * physics.centerPull * alpha;
    node.vx *= physics.damping;
    node.vy *= physics.damping;
    const speed = Math.hypot(node.vx, node.vy);
    if (speed > MAX_SPEED) {
      node.vx = (node.vx / speed) * MAX_SPEED;
      node.vy = (node.vy / speed) * MAX_SPEED;
    }
    node.x += node.vx;
    node.y += node.vy;
  }

  sim.alpha *= ALPHA_DECAY;
}

export interface GraphCanvasProps {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  selectedId: string | null;
  searchQuery?: string;
  colorMode?: "kind" | "cluster";
  physicsConfig?: PhysicsConfig;
  showMinimap?: boolean;
  onSelect: (id: string | null) => void;
  onOpen: (node: GraphNode) => void;
  onFlyToReady?: (flyFn: (id: string) => void) => void;
}

export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  searchQuery = "",
  colorMode = "kind",
  physicsConfig = DEFAULT_PHYSICS,
  showMinimap = true,
  onSelect,
  onOpen,
  onFlyToReady,
}: GraphCanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sizeRef = useRef<{ width: number; height: number }>({
    width: 800,
    height: 600,
  });

  const [, setFrame] = useState(0);
  const forceRender = useCallback(() => setFrame((n) => (n + 1) | 0), []);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [minimapCollapsed, setMinimapCollapsed] = useState(!showMinimap);

  const [view, setView] = useState<ViewTransform>({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;

  // Active camera animation cancel ref
  const cameraAnimRef = useRef<number | null>(null);

  const dragRef = useRef<{
    mode: "pan" | "node";
    pointerId: number;
    startX: number;
    startY: number;
    startViewX: number;
    startViewY: number;
    node: SimNode | null;
    moved: boolean;
  } | null>(null);

  const simRef = useRef<Sim>({
    nodes: [],
    byId: new Map(),
    alpha: 0,
    fitted: false,
  });
  const kickRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = (): void => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        sizeRef.current = { width: rect.width, height: rect.height };
      }
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Smooth camera flyTo with ease-out cubic
  const flyToCoords = useCallback(
    (targetX: number, targetY: number, targetZoom?: number): void => {
      if (cameraAnimRef.current !== null) {
        cancelAnimationFrame(cameraAnimRef.current);
      }
      const stage = sizeRef.current;
      const start = { ...viewRef.current };
      const destK = targetZoom !== undefined ? targetZoom : start.k;
      const destX = stage.width / 2 - targetX * destK;
      const destY = stage.height / 2 - targetY * destK;

      const startTime = performance.now();
      const duration = 480;

      const animate = (now: number): void => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // easeOutCubic
        const ease = 1 - Math.pow(1 - progress, 3);

        const nextK = start.k + (destK - start.k) * ease;
        const nextX = start.x + (destX - start.x) * ease;
        const nextY = start.y + (destY - start.y) * ease;

        setView({ k: nextK, x: nextX, y: nextY });

        if (progress < 1) {
          cameraAnimRef.current = requestAnimationFrame(animate);
        } else {
          cameraAnimRef.current = null;
        }
      };

      cameraAnimRef.current = requestAnimationFrame(animate);
    },
    [],
  );

  const flyToNode = useCallback(
    (nodeId: string): void => {
      const node = simRef.current.byId.get(nodeId);
      if (node) {
        flyToCoords(node.x, node.y, Math.max(viewRef.current.k, 1.1));
      }
    },
    [flyToCoords],
  );

  useEffect(() => {
    if (onFlyToReady) onFlyToReady(flyToNode);
  }, [flyToNode, onFlyToReady]);

  // Fit all nodes in view
  const fitView = useCallback((): void => {
    const simNodes = simRef.current.nodes;
    if (simNodes.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of simNodes) {
      if (node.x - node.r < minX) minX = node.x - node.r;
      if (node.x + node.r > maxX) maxX = node.x + node.r;
      if (node.y - node.r < minY) minY = node.y - node.r;
      if (node.y + node.r > maxY) maxY = node.y + node.r;
    }
    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const stage = sizeRef.current;
    const padding = 75;
    const kFit = Math.min(
      (stage.width - padding * 2) / width,
      (stage.height - padding * 2) / height,
    );
    const k = clamp(Number.isFinite(kFit) ? kFit : 1, MIN_ZOOM, 1.2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    flyToCoords(cx, cy, k);
  }, [flyToCoords]);

  const reheat = useCallback((): void => {
    simRef.current.alpha = Math.max(simRef.current.alpha, 0.45);
    kickRef.current();
  }, []);

  // Update simulation topology
  useEffect(() => {
    const previous = simRef.current.byId;
    const nextNodes: SimNode[] = [];
    const nextById = new Map<string, SimNode>();
    const count = nodes.length;

    for (let i = 0; i < count; i++) {
      const node = nodes[i];
      const prev = previous.get(node.id);
      let x = prev?.x;
      let y = prev?.y;
      if (x === undefined || y === undefined) {
        const theta = (2 * Math.PI * i) / Math.max(count, 1);
        const radius = 60 + Math.sqrt(i) * 35;
        x = Math.cos(theta) * radius + (Math.random() - 0.5) * 20;
        y = Math.sin(theta) * radius + (Math.random() - 0.5) * 20;
      }
      const simNode: SimNode = {
        id: node.id,
        node,
        x,
        y,
        vx: prev?.vx ?? 0,
        vy: prev?.vy ?? 0,
        r: radiusFor(node),
        held: false,
        color:
          colorMode === "cluster"
            ? getClusterColor(node.clusterId)
            : undefined,
      };
      nextNodes.push(simNode);
      nextById.set(node.id, simNode);
    }

    simRef.current.nodes = nextNodes;
    simRef.current.byId = nextById;
    simRef.current.alpha = 1;

    let raf = 0;
    const step = (): void => {
      const sim = simRef.current;
      tick(sim, edges, physicsConfig);
      forceRender();
      if (!sim.fitted && sim.alpha < 0.6) {
        sim.fitted = true;
        fitView();
      }
      if (sim.alpha >= ALPHA_MIN) {
        raf = requestAnimationFrame(step);
      } else {
        raf = 0;
      }
    };
    kickRef.current = () => {
      if (raf === 0) raf = requestAnimationFrame(step);
    };
    kickRef.current();
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      kickRef.current = () => {};
    };
  }, [nodes, edges, colorMode, physicsConfig, fitView, forceRender]);

  // Wheel zoom
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (cameraAnimRef.current !== null) {
        cancelAnimationFrame(cameraAnimRef.current);
        cameraAnimRef.current = null;
      }
      const rect = el.getBoundingClientRect();
      const current = viewRef.current;
      const k = clamp(
        current.k * Math.exp(-event.deltaY * 0.0016),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView({
        k,
        x: px - ((px - current.x) / current.k) * k,
        y: py - ((py - current.y) / current.k) * k,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number): void => {
    const stage = sizeRef.current;
    const current = viewRef.current;
    const cx = stage.width / 2;
    const cy = stage.height / 2;
    const k = clamp(current.k * factor, MIN_ZOOM, MAX_ZOOM);
    setView({
      k,
      x: cx - ((cx - current.x) / current.k) * k,
      y: cy - ((cy - current.y) / current.k) * k,
    });
  };

  // Pointer interactions
  const onBackgroundPointerDown = (
    event: React.PointerEvent<SVGSVGElement>,
  ): void => {
    if (event.button !== 0) return;
    if (cameraAnimRef.current !== null) {
      cancelAnimationFrame(cameraAnimRef.current);
      cameraAnimRef.current = null;
    }
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startViewX: viewRef.current.x,
      startViewY: viewRef.current.y,
      node: null,
      moved: false,
    };
  };

  const onNodePointerDown = (
    event: React.PointerEvent<SVGGElement>,
    body: SimNode,
  ): void => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (cameraAnimRef.current !== null) {
      cancelAnimationFrame(cameraAnimRef.current);
      cameraAnimRef.current = null;
    }
    svgRef.current?.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode: "node",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startViewX: viewRef.current.x,
      startViewY: viewRef.current.y,
      node: body,
      moved: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    if (drag.mode === "pan") {
      setView((current) => ({
        ...current,
        x: drag.startViewX + dx,
        y: drag.startViewY + dy,
      }));
      return;
    }
    const body = drag.node;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!body || !rect) return;
    const current = viewRef.current;
    body.held = true;
    body.x = (event.clientX - rect.left - current.x) / current.k;
    body.y = (event.clientY - rect.top - current.y) / current.k;
    body.vx = 0;
    body.vy = 0;
    simRef.current.alpha = Math.max(simRef.current.alpha, 0.28);
    kickRef.current();
    forceRender();
  };

  const endDrag = (event: React.PointerEvent<SVGSVGElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.node) drag.node.held = false;
    if (drag.moved) return;
    onSelect(drag.mode === "node" && drag.node ? drag.node.id : null);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onSelect(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSelect]);

  // Focus and search highlights
  const cleanQuery = searchQuery.trim().toLowerCase();
  const focusId = selectedId ?? hoveredId;

  const { neighbours, focusEdges, activeDegree } = useMemo(() => {
    const set = new Set<string>();
    const ids = new Set<string>();
    if (focusId !== null) {
      set.add(focusId);
      for (const edge of edges) {
        if (edge.source === focusId) {
          set.add(edge.target);
          ids.add(edge.id);
        } else if (edge.target === focusId) {
          set.add(edge.source);
          ids.add(edge.id);
        }
      }
    }
    return { neighbours: set, focusEdges: ids, activeDegree: ids.size };
  }, [focusId, edges]);

  const matchedNodeIds = useMemo(() => {
    if (!cleanQuery) return null;
    const matches = new Set<string>();
    for (const node of nodes) {
      if (
        node.label.toLowerCase().includes(cleanQuery) ||
        (node.sub && node.sub.toLowerCase().includes(cleanQuery))
      ) {
        matches.add(node.id);
      }
    }
    return matches;
  }, [nodes, cleanQuery]);

  const hoveredNode = useMemo((): SimNode | null => {
    if (!hoveredId) return null;
    return simRef.current.byId.get(hoveredId) ?? null;
  }, [hoveredId]);

  // Bounds for interactive Minimap
  const bounds = useMemo(() => {
    const simNodes = simRef.current.nodes;
    if (simNodes.length === 0) {
      return { minX: -200, maxX: 200, minY: -200, maxY: 200 };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of simNodes) {
      if (node.x < minX) minX = node.x;
      if (node.x > maxX) maxX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.y > maxY) maxY = node.y;
    }
    const pad = 120;
    return {
      minX: minX - pad,
      maxX: maxX + pad,
      minY: minY - pad,
      maxY: maxY + pad,
    };
  }, [simRef.current.nodes]);

  const labelScale = 1 / view.k;
  const gridStep = 32 * view.k;

  // Minimap coordinates calculation
  const mmW = 140;
  const mmH = 95;
  const bW = Math.max(bounds.maxX - bounds.minX, 1);
  const bH = Math.max(bounds.maxY - bounds.minY, 1);
  const mmScale = Math.min(mmW / bW, mmH / bH);

  // Viewport rect on minimap
  const vpX0 = (-view.x / view.k - bounds.minX) * mmScale;
  const vpY0 = (-view.y / view.k - bounds.minY) * mmScale;
  const vpW = (sizeRef.current.width / view.k) * mmScale;
  const vpH = (sizeRef.current.height / view.k) * mmScale;

  const onMinimapClick = (e: React.MouseEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const targetGraphX = clickX / mmScale + bounds.minX;
    const targetGraphY = clickY / mmScale + bounds.minY;
    flyToCoords(targetGraphX, targetGraphY);
  };

  return (
    <div className="imb-graph-canvas" ref={containerRef}>
      <svg
        ref={svgRef}
        className="imb-graph-svg"
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <pattern
            id="imb-graph-grid"
            x={view.x % gridStep}
            y={view.y % gridStep}
            width={gridStep}
            height={gridStep}
            patternUnits="userSpaceOnUse"
          >
            <circle
              cx={gridStep / 2}
              cy={gridStep / 2}
              r={Math.max(1, 1.3 * Math.min(view.k, 1.2))}
              className="imb-graph-grid-dot"
            />
          </pattern>
          <filter
            id="imb-graph-glow"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {showGrid && (
          <rect
            className="imb-graph-grid-plane"
            width="100%"
            height="100%"
            fill="url(#imb-graph-grid)"
          />
        )}

        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* Edges */}
          <g className="imb-graph-edges">
            {edges.map((edge) => {
              const a = simRef.current.byId.get(edge.source);
              const b = simRef.current.byId.get(edge.target);
              if (!a || !b) return null;
              const isFocused = focusEdges.has(edge.id);
              const isSearchDim =
                matchedNodeIds !== null &&
                (!matchedNodeIds.has(edge.source) ||
                  !matchedNodeIds.has(edge.target));
              const isDim =
                (focusId !== null && !isFocused) || (isSearchDim && !isFocused);
              const pathD = getOrganicPath(a, b, edge.id);
              return (
                <path
                  key={edge.id}
                  d={pathD}
                  className={cls(
                    "imb-graph-edge",
                    `imb-graph-edge--${edge.kind}`,
                    isFocused && "imb-is-focused",
                    isDim && "imb-is-dim",
                  )}
                  filter={isFocused ? "url(#imb-graph-glow)" : undefined}
                />
              );
            })}
          </g>

          {/* Nodes */}
          <g className="imb-graph-nodes">
            {simRef.current.nodes.map((body) => {
              const isFocused = body.id === focusId;
              const isSelected = body.id === selectedId;
              const isNeighbor = neighbours.has(body.id);
              const isSearchMatch =
                matchedNodeIds !== null && matchedNodeIds.has(body.id);
              const isSearchDim =
                matchedNodeIds !== null && !matchedNodeIds.has(body.id);
              const isDim =
                (focusId !== null && !isNeighbor) ||
                (isSearchDim && focusId === null);
              const isEmployee = body.node.kind === "employee";
              const isChat = body.node.kind === "chat";
              const isRoot = body.node.isRoot === true;

              const customFill =
                colorMode === "cluster" ? body.color : undefined;

              return (
                <g
                  key={body.id}
                  className={cls(
                    "imb-graph-node",
                    `imb-graph-node--${body.node.kind}`,
                    isRoot && "imb-is-root",
                    isSelected && "imb-is-selected",
                    isFocused && "imb-is-focused",
                    isSearchMatch && "imb-is-search-match",
                    isDim && "imb-is-dim",
                  )}
                  transform={`translate(${body.x},${body.y})`}
                  onPointerDown={(event) => onNodePointerDown(event, body)}
                  onPointerEnter={() => setHoveredId(body.id)}
                  onPointerLeave={() =>
                    setHoveredId((current) =>
                      current === body.id ? null : current,
                    )
                  }
                  onDoubleClick={() => onOpen(body.node)}
                >
                  {(isSelected || isEmployee || isSearchMatch) && (
                    <circle
                      className={cls(
                        "imb-graph-node-halo",
                        isEmployee && "imb-is-agent-aura",
                        isSearchMatch && "imb-is-search-aura",
                      )}
                      r={body.r + (isSelected ? 7 : 5)}
                    />
                  )}

                  <circle
                    className="imb-graph-node-core"
                    r={body.r}
                    style={customFill ? { fill: customFill } : undefined}
                  />

                  {isChat && isRoot && (
                    <circle
                      className="imb-graph-node-ring"
                      r={body.r + 3.5}
                      style={
                        customFill
                          ? { stroke: customFill, opacity: 0.5 }
                          : undefined
                      }
                    />
                  )}

                  <g
                    className="imb-graph-label-box"
                    transform={`translate(0,${body.r + 11}) scale(${labelScale})`}
                  >
                    <text className="imb-graph-label" textAnchor="middle">
                      {truncate(body.node.label)}
                    </text>
                  </g>
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* Hover Card */}
      {hoveredNode && !selectedId && (
        <div
          className="imb-graph-hover-card"
          style={{
            transform: `translate(${view.x + hoveredNode.x * view.k}px, ${
              view.y + hoveredNode.y * view.k - hoveredNode.r * view.k - 14
            }px)`,
          }}
        >
          <div className="imb-graph-hover-card-inner">
            <div className="imb-graph-hover-head">
              <span
                className={cls(
                  "imb-graph-badge",
                  `imb-graph-badge--${hoveredNode.node.kind}`,
                )}
              >
                {t(
                  hoveredNode.node.kind === "employee"
                    ? "Employee"
                    : hoveredNode.node.kind === "tag"
                      ? "Tag"
                      : hoveredNode.node.isRoot
                        ? "Root Chat"
                        : "Conversation",
                )}
              </span>
              {activeDegree > 0 && (
                <span className="imb-graph-hover-degree">
                  {t("${count} links", { count: String(activeDegree) })}
                </span>
              )}
            </div>
            <strong className="imb-graph-hover-title">
              {hoveredNode.node.label}
            </strong>
            <span className="imb-graph-hover-tip">
              {t("Double-click to open · Click to inspect")}
            </span>
          </div>
        </div>
      )}

      {/* Interactive Radar Minimap (Obsidian / Neurite style) */}
      {!minimapCollapsed && (
        <div className="imb-graph-minimap">
          <div className="imb-graph-minimap-head">
            <span className="imb-graph-minimap-title">{t("Radar")}</span>
            <button
              type="button"
              className="imb-graph-minimap-close"
              onClick={() => setMinimapCollapsed(true)}
              title={t("Collapse minimap")}
            >
              ×
            </button>
          </div>
          <svg
            className="imb-graph-minimap-svg"
            width={mmW}
            height={mmH}
            onClick={onMinimapClick}
          >
            {simRef.current.nodes.map((n) => {
              const mx = (n.x - bounds.minX) * mmScale;
              const my = (n.y - bounds.minY) * mmScale;
              return (
                <circle
                  key={n.id}
                  cx={mx}
                  cy={my}
                  r={Math.max(1.2, (n.r / 7) * 1.5)}
                  className={cls(
                    "imb-graph-mm-dot",
                    `imb-graph-mm-dot--${n.node.kind}`,
                  )}
                />
              );
            })}
            <rect
              x={vpX0}
              y={vpY0}
              width={vpW}
              height={vpH}
              className="imb-graph-mm-viewport"
            />
          </svg>
        </div>
      )}

      {/* Floating Controls Toolbar */}
      <div
        className="imb-graph-floating-toolbar"
        role="toolbar"
        aria-label={t("Graph Controls")}
      >
        <button
          type="button"
          className="imb-graph-tool-btn"
          onClick={() => zoomBy(1.3)}
          aria-label={t("Zoom in")}
          title={t("Zoom in")}
        >
          +
        </button>
        <button
          type="button"
          className="imb-graph-tool-btn"
          onClick={() => zoomBy(1 / 1.3)}
          aria-label={t("Zoom out")}
          title={t("Zoom out")}
        >
          −
        </button>
        <div className="imb-graph-tool-sep" />
        <button
          type="button"
          className="imb-graph-tool-btn"
          onClick={fitView}
          aria-label={t("Reset view")}
          title={t("Fit to view")}
        >
          ⤢
        </button>
        <button
          type="button"
          className={cls("imb-graph-tool-btn", showGrid && "imb-is-active")}
          onClick={() => setShowGrid((v) => !v)}
          aria-label={t("Toggle grid")}
          title={t("Toggle spatial grid")}
        >
          ▦
        </button>
        {minimapCollapsed && (
          <button
            type="button"
            className="imb-graph-tool-btn"
            onClick={() => setMinimapCollapsed(false)}
            aria-label={t("Show radar")}
            title={t("Show radar minimap")}
          >
            ◎
          </button>
        )}
        <button
          type="button"
          className="imb-graph-tool-btn"
          onClick={reheat}
          aria-label={t("Re-layout")}
          title={t("Reheat physics simulation")}
        >
          ⚡
        </button>
      </div>
    </div>
  );
}
