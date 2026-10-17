import { t } from "@shared/l10n";
import type { GraphEdge, GraphNode } from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cls } from "reactutils";

/**
 * The enhanced graph canvas inspired by Neurite (organic non-linear spatial graph)
 * and Collect UI (refined modern surfaces, micro-interactions, smooth feedback).
 *
 * Dependency-free force simulation rendered via SVG with dynamic bezier connectors,
 * breathing halos for AI agents, spatial dot grid, and contextual hover cards.
 */

/** One body in the simulation; `x`/`y` are in graph space. */
export interface SimNode {
  id: string;
  node: GraphNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Drawn radius. */
  r: number;
  /** True while the pointer drags it (integration is skipped). */
  held: boolean;
}

interface Sim {
  nodes: SimNode[];
  byId: Map<string, SimNode>;
  alpha: number;
  /** True once the initial layout has cooled and the view has been fitted. */
  fitted: boolean;
}

interface ViewTransform {
  k: number;
  x: number;
  y: number;
}

const REPULSION = 14000;
const SPRING = 0.035;
const LINK_DISTANCE = 130;
const CENTER_PULL = 0.0025;
const DAMPING = 0.85;
const ALPHA_DECAY = 0.96;
const ALPHA_MIN = 0.005;
const MAX_SPEED = 15;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 3.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Node size: employees read as primary cognitive anchors, tags as fine markers. */
function radiusFor(node: GraphNode): number {
  const base = node.kind === "employee" ? 11 : node.kind === "tag" ? 7 : 6.5;
  const gain = node.kind === "employee" ? 1.8 : 1.15;
  const cap = node.kind === "employee" ? 26 : 21;
  return Math.min(base + Math.sqrt(Math.max(node.weight, 0)) * gain, cap);
}

function truncate(label: string, max = 26): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/** Compute an organic curved bezier path between two nodes. */
function getOrganicPath(
  a: SimNode,
  b: SimNode,
  edgeId: string,
  curvatureFactor = 0.12,
): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) {
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  }

  // Generate a deterministic slight lateral curve based on the edge id hash
  let hash = 0;
  for (let i = 0; i < edgeId.length; i++) {
    hash = (hash * 31 + edgeId.charCodeAt(i)) | 0;
  }
  const sign = hash % 2 === 0 ? 1 : -1;
  const offset = Math.min(dist * curvatureFactor, 36) * sign;

  // Normal vector perpendicular to the line
  const nx = -dy / dist;
  const ny = dx / dist;

  // Midpoint with curve offset
  const cx = (a.x + b.x) / 2 + nx * offset;
  const cy = (a.y + b.y) / 2 + ny * offset;

  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
}

/** Advance the simulation one frame. */
function tick(sim: Sim, edges: readonly GraphEdge[]): void {
  const nodes = sim.nodes;
  const alpha = sim.alpha;

  // Pairwise node repulsion
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
      const force = (REPULSION * alpha) / (d2 + 400);
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

  // Spring attraction along edges
  for (const edge of edges) {
    const a = sim.byId.get(edge.source);
    const b = sim.byId.get(edge.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 0.1;
    const delta = dist - LINK_DISTANCE;
    const force = delta * SPRING * alpha;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    if (!a.held) {
      a.vx += fx;
      a.vy += fy;
    }
    if (!b.held) {
      b.vx -= fx;
      b.vy -= fy;
    }
  }

  // Gentle central gravity pull
  for (const node of nodes) {
    if (node.held) continue;
    node.vx -= node.x * CENTER_PULL * alpha;
    node.vy -= node.y * CENTER_PULL * alpha;
    node.vx *= DAMPING;
    node.vy *= DAMPING;
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
  onSelect: (id: string | null) => void;
  onOpen: (node: GraphNode) => void;
}

export function GraphCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
  onOpen,
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

  // View transform: pan & zoom
  const [view, setView] = useState<ViewTransform>({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;

  // Active drag state
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

  // Simulation state
  const simRef = useRef<Sim>({
    nodes: [],
    byId: new Map(),
    alpha: 0,
    fitted: false,
  });
  const kickRef = useRef<() => void>(() => {});

  // Observe stage dimensions
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

  // Center & fit the graph nodes in view
  const fitView = useCallback((): void => {
    const nodes = simRef.current.nodes;
    if (nodes.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      if (node.x - node.r < minX) minX = node.x - node.r;
      if (node.x + node.r > maxX) maxX = node.x + node.r;
      if (node.y - node.r < minY) minY = node.y - node.r;
      if (node.y + node.r > maxY) maxY = node.y + node.r;
    }
    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const stage = sizeRef.current;
    const padding = 70;
    const kFit = Math.min(
      (stage.width - padding * 2) / width,
      (stage.height - padding * 2) / height,
    );
    const k = clamp(Number.isFinite(kFit) ? kFit : 1, MIN_ZOOM, 1.25);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setView({
      k,
      x: stage.width / 2 - cx * k,
      y: stage.height / 2 - cy * k,
    });
  }, []);

  // Re-heat simulation
  const reheat = useCallback((): void => {
    simRef.current.alpha = Math.max(simRef.current.alpha, 0.45);
    kickRef.current();
  }, []);

  // Sync simulation nodes with props
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
      tick(sim, edges);
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
  }, [nodes, edges, fitView, forceRender]);

  // Wheel zoom
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
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

  // Keyboard escape cancels selection
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onSelect(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onSelect]);

  // Focus network graph
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

  // Hovered node details for the Collect UI mini-preview tooltip
  const hoveredNode = useMemo((): SimNode | null => {
    if (!hoveredId) return null;
    return simRef.current.byId.get(hoveredId) ?? null;
  }, [hoveredId]);

  const labelScale = 1 / view.k;
  const gridStep = 32 * view.k;

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
          {/* Spatial dot grid pattern (Neurite infinite coordinate plane) */}
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
          {/* Glow filter for active neural connection pathways */}
          <filter id="imb-graph-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Spatial background plane */}
        {showGrid && (
          <rect
            className="imb-graph-grid-plane"
            width="100%"
            height="100%"
            fill="url(#imb-graph-grid)"
          />
        )}

        {/* Transformed scene */}
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* Edges layer */}
          <g className="imb-graph-edges">
            {edges.map((edge) => {
              const a = simRef.current.byId.get(edge.source);
              const b = simRef.current.byId.get(edge.target);
              if (!a || !b) return null;
              const isFocused = focusEdges.has(edge.id);
              const isDim = focusId !== null && !isFocused;
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

          {/* Nodes layer */}
          <g className="imb-graph-nodes">
            {simRef.current.nodes.map((body) => {
              const isFocused = body.id === focusId;
              const isSelected = body.id === selectedId;
              const isNeighbor = neighbours.has(body.id);
              const isDim = focusId !== null && !isNeighbor;
              const isEmployee = body.node.kind === "employee";
              const isChat = body.node.kind === "chat";
              const isRoot = body.node.isRoot === true;

              return (
                <g
                  key={body.id}
                  className={cls(
                    "imb-graph-node",
                    `imb-graph-node--${body.node.kind}`,
                    isRoot && "imb-is-root",
                    isSelected && "imb-is-selected",
                    isFocused && "imb-is-focused",
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
                  {/* Subtle breathing halo / ripple for active or agent nodes */}
                  {(isSelected || isEmployee) && (
                    <circle
                      className={cls(
                        "imb-graph-node-halo",
                        isEmployee && "imb-is-agent-aura",
                      )}
                      r={body.r + (isSelected ? 7 : 5)}
                    />
                  )}

                  {/* Main node surface */}
                  <circle className="imb-graph-node-core" r={body.r} />

                  {/* Concentric orbital ring for root chats */}
                  {isChat && isRoot && (
                    <circle
                      className="imb-graph-node-ring"
                      r={body.r + 3.5}
                    />
                  )}

                  {/* Node label */}
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

      {/* Floating Collect UI Hover Card for quick node context */}
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

      {/* Modern status hint */}
      <div className="imb-graph-hint-pill">
        <span>{t("Drag to pan · Scroll to zoom · Double-click to open")}</span>
      </div>

      {/* Floating Controls Toolbar (Collect UI Glass Panel) */}
      <div className="imb-graph-floating-toolbar" role="toolbar" aria-label={t("Graph Controls")}>
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
          title={t("Reset view")}
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
