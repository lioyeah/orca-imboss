import type {
  TaskFlowNode,
  TaskWorkflowGraph,
} from "@shared/types";
import { useCallback, useMemo, useRef, useState } from "react";
import { cls } from "reactutils";
import "./index.css";

const LANE_WIDTH = 260;
const ROW_HEIGHT = 80;
const PADDING_X = 80;
const PADDING_Y = 60;
const CORNER_RADIUS = 16;

interface MetroCanvasProps {
  graph: TaskWorkflowGraph;
  selectedId: string | null;
  mode: "live" | "studio";
  onSelectNode: (node: TaskFlowNode | null) => void;
  onAddNode?: (fromNodeId: string, asBranch: boolean) => void;
  onDeleteNode?: (nodeId: string) => void;
  onApproveGate?: (nodeId: string) => void;
}

function getMetroPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r = CORNER_RADIUS,
): string {
  if (Math.abs(x1 - x2) < 2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const dy = y2 - y1;
  const midY = y1 + Math.max(r * 2, Math.min(dy * 0.45, 48));

  if (x1 < x2) {
    return `M ${x1} ${y1} L ${x1} ${midY - r} Q ${x1} ${midY} ${x1 + r} ${midY} L ${x2 - r} ${midY} Q ${x2} ${midY} ${x2} ${midY + r} L ${x2} ${y2}`;
  } else {
    return `M ${x1} ${y1} L ${x1} ${midY - r} Q ${x1} ${midY} ${x1 - r} ${midY} L ${x2 + r} ${midY} Q ${x2} ${midY} ${x2} ${midY + r} L ${x2} ${y2}`;
  }
}

export function MetroCanvas({
  graph,
  selectedId,
  mode,
  onSelectNode,
  onAddNode,
  onDeleteNode,
  onApproveGate,
}: MetroCanvasProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  // Pan & Zoom transform state
  const [transform, setTransform] = useState({ x: 40, y: 30, k: 1 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });

  // Compute Layout Positions
  const layout = useMemo(() => {
    const posMap = new Map<string, { x: number; y: number }>();
    const sorted = [...graph.nodes].sort((a, b) => a.order - b.order);

    sorted.forEach((node, idx) => {
      const x = PADDING_X + node.lane * LANE_WIDTH;
      const y = PADDING_Y + idx * ROW_HEIGHT;
      posMap.set(node.id, { x, y });
    });

    const maxLane = Math.max(1, ...graph.nodes.map((n) => n.lane));
    const width = PADDING_X + (maxLane + 1) * LANE_WIDTH + 320;
    const height = PADDING_Y + (sorted.length + 2) * ROW_HEIGHT + 100;

    return { posMap, width, height };
  }, [graph.nodes]);

  // Path tracing for focus/dimming
  const activePathNodeIds = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set<string>();
    set.add(selectedId);

    // Build parent adjacency
    const parentMap = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const existing = parentMap.get(edge.to) ?? [];
      existing.push(edge.from);
      parentMap.set(edge.to, existing);
    }

    // Walk up to root
    const queue = [selectedId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const parents = parentMap.get(curr) ?? [];
      for (const p of parents) {
        if (!set.has(p)) {
          set.add(p);
          queue.push(p);
        }
      }
    }
    return set;
  }, [selectedId, graph.edges]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    setTransform((curr) => {
      const newK = Math.min(Math.max(curr.k * zoomFactor, 0.4), 2.2);
      return {
        ...curr,
        k: newK,
      };
    });
  }, []);

  // Pan interaction
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Only pan if clicked directly on canvas container or svg background
    const target = e.target as HTMLElement;
    if (
      target.classList.contains("metro-canvas-container") ||
      target.classList.contains("metro-svg-layer") ||
      target.tagName === "svg"
    ) {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
    }
  }, [transform]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      setTransform((curr) => ({
        ...curr,
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      }));
    },
    [isPanning],
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleResetView = useCallback(() => {
    setTransform({ x: 40, y: 30, k: 1 });
  }, []);

  const handleZoomIn = useCallback(() => {
    setTransform((curr) => ({ ...curr, k: Math.min(curr.k * 1.15, 2.2) }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setTransform((curr) => ({ ...curr, k: Math.max(curr.k * 0.85, 0.4) }));
  }, []);

  return (
    <div
      ref={containerRef}
      className="metro-canvas-container"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="metro-viewport"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`,
        }}
      >
        {/* SVG Connectors and Track Dots */}
        <svg
          className="metro-svg-layer"
          width={layout.width}
          height={layout.height}
          style={{ width: layout.width, height: layout.height }}
        >
          {/* Edges / Curved Rails */}
          {graph.edges.map((edge) => {
            const p1 = layout.posMap.get(edge.from);
            const p2 = layout.posMap.get(edge.to);
            if (!p1 || !p2) return null;

            const isEdgeActive =
              activePathNodeIds !== null &&
              activePathNodeIds.has(edge.from) &&
              activePathNodeIds.has(edge.to);
            const isEdgeDimmed =
              activePathNodeIds !== null && !isEdgeActive;

            const d = getMetroPath(p1.x, p1.y, p2.x, p2.y);
            return (
              <path
                key={edge.id}
                d={d}
                className={cls(
                  "metro-rail-line",
                  isEdgeActive && "active",
                  isEdgeDimmed && "dimmed",
                )}
              />
            );
          })}

          {/* Nodes on Track & Connectors to Cards */}
          {graph.nodes.map((node) => {
            const pos = layout.posMap.get(node.id);
            if (!pos) return null;

            const isSelected = node.id === selectedId;
            const isNodeActive =
              activePathNodeIds === null || activePathNodeIds.has(node.id);
            const isRunning = node.status === "running";

            return (
              <g key={`track_${node.id}`}>
                {/* Horizontal connection line to card pill */}
                <line
                  x1={pos.x}
                  y1={pos.y}
                  x2={pos.x + 18}
                  y2={pos.y}
                  className={cls(
                    "metro-card-connector",
                    (isSelected || isRunning) && "active",
                  )}
                />

                {/* Pulsing Focus Halo for Running / Selected Node */}
                {(isRunning || isSelected) && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={14}
                    className="metro-dot-halo"
                  />
                )}

                {/* Track Node Circle */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={isRunning || isSelected ? 8 : 6.5}
                  className={cls(
                    "metro-dot",
                    `status-${node.status}`,
                    !isNodeActive && "dimmed",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectNode(node);
                  }}
                />

                {/* Optional Badge on Track Node (like the red '2' in reference image) */}
                {node.badge !== null && node.badge !== undefined && (
                  <g
                    transform={`translate(${pos.x + 6}, ${pos.y - 6})`}
                    style={{ pointerEvents: "none" }}
                  >
                    <circle r={7.5} className="metro-badge-circle" />
                    <text className="metro-badge-text">{node.badge}</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Floating Pill Cards Layer */}
        <div className="metro-cards-layer">
          {graph.nodes.map((node) => {
            const pos = layout.posMap.get(node.id);
            if (!pos) return null;

            const isSelected = node.id === selectedId;
            const isNodeActive =
              activePathNodeIds === null || activePathNodeIds.has(node.id);

            // Card X is anchored 18px to the right of the rail node
            const cardX = pos.x + 18;
            const cardY = pos.y - 24;

            return (
              <div
                key={`card_${node.id}`}
                className={cls(
                  "metro-card",
                  isSelected && "selected",
                  !isNodeActive && "dimmed",
                )}
                style={{
                  left: `${cardX}px`,
                  top: `${cardY}px`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectNode(node);
                }}
              >
                {/* 1. Thumbnail Slot (Image produced or attachment preview) */}
                {node.thumbnail ? (
                  <div className="metro-card-thumb">
                    <img src={node.thumbnail} alt="thumbnail" />
                  </div>
                ) : node.employeeAvatar ? (
                  <div className="metro-card-avatar">
                    <img src={node.employeeAvatar} alt="avatar" />
                  </div>
                ) : node.employeeName ? (
                  <div className="metro-card-avatar">
                    {node.employeeName.slice(0, 1).toUpperCase()}
                  </div>
                ) : null}

                {/* 2. Text / Action Title & Subtitle */}
                <div className="metro-card-content">
                  <div className="metro-card-title">{node.title}</div>
                  {node.subtitle && (
                    <div className="metro-card-subtitle">{node.subtitle}</div>
                  )}
                </div>

                {/* 3. Badge Counter Pill */}
                {node.badge !== null && node.badge !== undefined && (
                  <span className="metro-card-badge">{node.badge}</span>
                )}

                {/* 4. Status Indicator */}
                {node.status === "running" && (
                  <span className="metro-card-status-chip status-running">
                    ● 进行中
                  </span>
                )}
                {node.status === "completed" && (
                  <span className="metro-card-status-chip status-completed">
                    ✓ 完成
                  </span>
                )}
                {node.status === "waiting_approval" && (
                  <span
                    className="metro-card-status-chip status-waiting_approval"
                    onClick={(e) => {
                      if (onApproveGate) {
                        e.stopPropagation();
                        onApproveGate(node.id);
                      }
                    }}
                  >
                    ⏳ 待审批 {onApproveGate && "▶"}
                  </span>
                )}
                {node.status === "interrupted" && (
                  <span className="metro-card-status-chip status-interrupted">
                    ✕ 已中断
                  </span>
                )}

                {/* 5. Studio Mode Action Buttons (Insert / Branch / Delete) */}
                {mode === "studio" && (
                  <div className="metro-node-actions">
                    {onAddNode && (
                      <button
                        type="button"
                        className="metro-action-btn"
                        title="添加下一步"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddNode(node.id, false);
                        }}
                      >
                        +
                      </button>
                    )}
                    {onAddNode && (
                      <button
                        type="button"
                        className="metro-action-btn"
                        title="添加并行分支"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddNode(node.id, true);
                        }}
                      >
                        ⑂
                      </button>
                    )}
                    {onDeleteNode && node.type !== "root" && (
                      <button
                        type="button"
                        className="metro-action-btn delete"
                        title="删除该节点"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteNode(node.id);
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating HUD Controls */}
      <div className="metro-hud-controls">
        <button
          type="button"
          className="metro-hud-btn"
          title="放大"
          onClick={handleZoomIn}
        >
          +
        </button>
        <button
          type="button"
          className="metro-hud-btn"
          title="缩小"
          onClick={handleZoomOut}
        >
          -
        </button>
        <button
          type="button"
          className="metro-hud-btn"
          title="重置视图"
          onClick={handleResetView}
        >
          ⊙
        </button>
      </div>
    </div>
  );
}
