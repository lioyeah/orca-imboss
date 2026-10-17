import { t } from "@shared/l10n";
import type { GraphEdge, GraphNode } from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cls } from "reactutils";

/**
 * The graph canvas: a small, dependency-free force layout drawn as SVG.
 *
 * The whole simulation lives in a ref (positions mutate every frame) and a
 * frame counter drives React re-renders while the layout is cooling. Once it
 * settles the loop stops, so an idle graph costs nothing. Dragging a node
 * reheats it.
 */

/** One body in the simulation; `x`/`y` are in graph space. */
interface SimNode {
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

const REPULSION = 12000;
const SPRING = 0.03;
const LINK_DISTANCE = 120;
const CENTER_PULL = 0.002;
const DAMPING = 0.85;
const ALPHA_DECAY = 0.96;
const ALPHA_MIN = 0.006;
const MAX_SPEED = 14;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Node size: employees read as anchors, tags as small markers. */
function radiusFor(node: GraphNode): number {
  const base = node.kind === "employee" ? 9 : node.kind === "tag" ? 6 : 5.5;
  const gain = node.kind === "employee" ? 1.7 : 1.1;
  const cap = node.kind === "employee" ? 24 : 19;
  return Math.min(base + Math.sqrt(Math.max(node.weight, 0)) * gain, cap);
}

function truncate(label: string, max = 26): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/** Advance the simulation one frame. */
function tick(sim: Sim, edges: readonly GraphEdge[]): void {
  const nodes = sim.nodes;
  const alpha = sim.alpha;

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
      const d = Math.sqrt(d2);
      const force = (REPULSION / d2) * alpha;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  for (const edge of edges) {
    const a = sim.byId.get(edge.source);
    const b = sim.byId.get(edge.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
    const force = (d - LINK_DISTANCE) * SPRING * alpha;
    const fx = (dx / d) * force;
    const fy = (dy / d) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  for (const n of nodes) {
    n.vx += -n.x * CENTER_PULL * alpha;
    n.vy += -n.y * CENTER_PULL * alpha;
    if (n.held) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx = clamp(n.vx, -MAX_SPEED, MAX_SPEED) * DAMPING;
    n.vy = clamp(n.vy, -MAX_SPEED, MAX_SPEED) * DAMPING;
    n.x += n.vx;
    n.y += n.vy;
  }

  sim.alpha *= ALPHA_DECAY;
}

export interface GraphCanvasProps {
  /** Already filtered by the module; only these are laid out and drawn. */
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simRef = useRef<Sim>({
    nodes: [],
    byId: new Map(),
    alpha: 0,
    fitted: false,
  });
  const [, setFrame] = useState(0);
  const forceRender = useCallback(() => setFrame((n) => n + 1), []);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const sizeRef = useRef(size);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const centeredRef = useRef(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
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
  const kickRef = useRef<() => void>(() => {});

  // --- Container size --------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      sizeRef.current = { width: rect.width, height: rect.height };
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Center the origin the first time we know how big the stage is.
  useEffect(() => {
    if (size.width === 0 || centeredRef.current) return;
    centeredRef.current = true;
    setView({ k: 1, x: size.width / 2, y: size.height / 2 });
  }, [size]);

  // --- Simulation ------------------------------------------------------------
  // Rebuild the bodies, keeping the positions of nodes that were already
  // present so toggling a filter does not reshuffle the whole layout.
  useEffect(() => {
    const previous = simRef.current.byId;
    const bodies: SimNode[] = nodes.map((node, index) => {
      const existing = previous.get(node.id);
      if (existing) {
        existing.node = node;
        existing.r = radiusFor(node);
        return existing;
      }
      const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
      const distance = 90 + (index % 5) * 30;
      return {
        id: node.id,
        node,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        vx: 0,
        vy: 0,
        r: radiusFor(node),
        held: false,
      };
    });
    simRef.current = {
      nodes: bodies,
      byId: new Map(bodies.map((body) => [body.id, body])),
      alpha: previous.size > 0 ? 0.7 : 1,
      fitted: false,
    };
    forceRender();
  }, [nodes, forceRender]);

  const fitView = useCallback(() => {
    const sim = simRef.current;
    const stage = sizeRef.current;
    if (sim.nodes.length === 0 || stage.width === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const body of sim.nodes) {
      minX = Math.min(minX, body.x - body.r);
      maxX = Math.max(maxX, body.x + body.r);
      minY = Math.min(minY, body.y - body.r);
      maxY = Math.max(maxY, body.y + body.r);
    }
    const pad = 64;
    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const k = clamp(
      Math.min(
        (stage.width - pad * 2) / width,
        (stage.height - pad * 2) / height,
      ),
      MIN_ZOOM,
      1.3,
    );
    setView({
      k,
      x: stage.width / 2 - ((minX + maxX) / 2) * k,
      y: stage.height / 2 - ((minY + maxY) / 2) * k,
    });
  }, []);

  useEffect(() => {
    const sim = simRef.current;
    let raf = 0;
    const step = (): void => {
      raf = 0;
      if (sim.alpha <= ALPHA_MIN) {
        if (!sim.fitted && sim.nodes.length > 0) {
          sim.fitted = true;
          fitView();
        }
        return;
      }
      tick(sim, edges);
      forceRender();
      raf = requestAnimationFrame(step);
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

  // --- Wheel zoom (native listener so preventDefault works) -------------------
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const current = viewRef.current;
      const k = clamp(
        current.k * Math.exp(-event.deltaY * 0.0015),
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

  // --- Pointer: pan the view / drag a node ------------------------------------
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
    simRef.current.alpha = Math.max(simRef.current.alpha, 0.25);
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

  // --- Focus (selection wins over hover) --------------------------------------
  const focusId = selectedId ?? hoveredId;
  const { neighbours, focusEdges } = useMemo(() => {
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
    return { neighbours: set, focusEdges: ids };
  }, [focusId, edges]);

  const labelScale = 1 / view.k;

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
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          <g className="imb-graph-edges">
            {edges.map((edge) => {
              const a = simRef.current.byId.get(edge.source);
              const b = simRef.current.byId.get(edge.target);
              if (!a || !b) return null;
              const dim = focusId !== null && !focusEdges.has(edge.id);
              return (
                <line
                  key={edge.id}
                  className={cls(
                    "imb-graph-edge",
                    `imb-graph-edge--${edge.kind}`,
                    dim && "imb-is-dim",
                  )}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                />
              );
            })}
          </g>
          <g className="imb-graph-nodes">
            {simRef.current.nodes.map((body) => {
              const dim = focusId !== null && !neighbours.has(body.id);
              return (
                <g
                  key={body.id}
                  className={cls(
                    "imb-graph-node",
                    `imb-graph-node--${body.node.kind}`,
                    body.node.kind === "chat" &&
                      body.node.isRoot === true &&
                      "imb-is-root",
                    body.id === selectedId && "imb-is-selected",
                    dim && "imb-is-dim",
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
                  <circle r={body.r} />
                  <g
                    className="imb-graph-label-box"
                    transform={`translate(0,${body.r + 10}) scale(${labelScale})`}
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

      <p className="imb-graph-hint">
        {t("Drag to pan · scroll to zoom · double-click a node to open")}
      </p>

      <div className="imb-graph-controls">
        <button
          type="button"
          onClick={() => zoomBy(1.3)}
          aria-label={t("Zoom in")}
          title={t("Zoom in")}
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.3)}
          aria-label={t("Zoom out")}
          title={t("Zoom out")}
        >
          −
        </button>
        <button
          type="button"
          onClick={fitView}
          aria-label={t("Reset view")}
          title={t("Reset view")}
        >
          ⤢
        </button>
      </div>
    </div>
  );
}
