import type {
  TaskFlowNode,
  TaskWorkflowGraph,
} from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  // Time-Travel Simulation / Preview State
  const [isSimulating, setIsSimulating] = useState(false);
  const [simIndex, setSimIndex] = useState(0);
  const [simPlaying, setSimPlaying] = useState(false);

  // Sorted nodes by chronological order
  const sortedNodes = useMemo(() => {
    return [...graph.nodes].sort((a, b) => a.order - b.order);
  }, [graph.nodes]);

  // Compute Layout Positions
  const layout = useMemo(() => {
    const posMap = new Map<string, { x: number; y: number }>();
    sortedNodes.forEach((node, idx) => {
      const x = PADDING_X + node.lane * LANE_WIDTH;
      const y = PADDING_Y + idx * ROW_HEIGHT;
      posMap.set(node.id, { x, y });
    });

    const maxLane = Math.max(1, ...graph.nodes.map((n) => n.lane));
    const width = PADDING_X + (maxLane + 1) * LANE_WIDTH + 320;
    const height = PADDING_Y + (sortedNodes.length + 2) * ROW_HEIGHT + 100;

    return { posMap, width, height };
  }, [graph.nodes, sortedNodes]);

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

  // Simulation timer stepping
  useEffect(() => {
    if (!isSimulating || !simPlaying || sortedNodes.length === 0) return;
    const interval = setInterval(() => {
      setSimIndex((curr) => {
        if (curr >= sortedNodes.length - 1) {
          setSimPlaying(false);
          return curr;
        }
        return curr + 1;
      });
    }, 2400);
    return () => clearInterval(interval);
  }, [isSimulating, simPlaying, sortedNodes]);

  // Simulation commentary text
  const currentSimNode = sortedNodes[simIndex];
  const simCommentary = useMemo(() => {
    if (!currentSimNode) return "";
    const name = currentSimNode.employeeName || "助手 (Assistant)";
    const role = currentSimNode.employeeRole || "协作者";
    switch (currentSimNode.type) {
      case "root":
        return `🎯 接收老板目标指令：「${currentSimNode.title}」`;
      case "employee_join":
        return `👋 调配员工 ${name} (${role}) 接入任务群，加载对应 MCP 与技能环境`;
      case "task":
        return `⚡ 员工 ${name} 正在执行任务：「${currentSimNode.title}」...`;
      case "employee_leave":
        return `🛡️ 员工 ${name} 阶段成果达成，退出会话以保护后续上下文并节省 Token`;
      case "approval_gate":
        return `⏳ 流程到达审批卡点【${currentSimNode.title}】，挂起等待人工确认`;
      case "merge":
        return `📦 各分支成果收敛归档，向老板交付最终报告`;
      default:
        return `流转推进: ${currentSimNode.title}`;
    }
  }, [currentSimNode]);

  const handleStartSimulation = useCallback(() => {
    setIsSimulating(true);
    setSimIndex(0);
    setSimPlaying(true);
  }, []);

  const handleStopSimulation = useCallback(() => {
    setIsSimulating(false);
    setSimPlaying(false);
    setSimIndex(0);
  }, []);

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

            const targetNode = graph.nodes.find((n) => n.id === edge.to);
            const fromNode = graph.nodes.find((n) => n.id === edge.from);

            // Simulation state on rail
            const isSimReached =
              isSimulating &&
              fromNode !== undefined &&
              targetNode !== undefined &&
              fromNode.order <= simIndex &&
              targetNode.order <= simIndex;

            // Ghost status: if target is pending and not reached by simulation
            const isGhost =
              targetNode?.status === "pending" && !isSimReached;

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
                  isSimReached && "simulating",
                  isGhost && "ghost",
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
            const isCurrentSim = isSimulating && node.id === currentSimNode?.id;
            const isSimPast = isSimulating && node.order <= simIndex;
            const isRunning = node.status === "running";

            const isNodeActive =
              activePathNodeIds === null || activePathNodeIds.has(node.id);

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
                    (isSelected || isRunning || isCurrentSim) && "active",
                  )}
                />

                {/* Pulsing Focus Halo for Running / Selected / Current Sim Node */}
                {(isRunning || isSelected || isCurrentSim) && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={15}
                    className="metro-dot-halo"
                  />
                )}

                {/* Track Node Circle */}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={isRunning || isSelected || isCurrentSim ? 8 : 6.5}
                  className={cls(
                    "metro-dot",
                    isCurrentSim
                      ? "status-running"
                      : isSimPast
                        ? "status-completed"
                        : `status-${node.status}`,
                    !isNodeActive && "dimmed",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectNode(node);
                  }}
                />

                {/* Optional Badge on Track Node */}
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
            const isCurrentSim = isSimulating && node.id === currentSimNode?.id;
            const isSimPast = isSimulating && node.order <= simIndex;
            const isNodeActive =
              activePathNodeIds === null || activePathNodeIds.has(node.id);

            const isGhost = node.status === "pending" && !isSimPast;

            const cardX = pos.x + 18;
            const cardY = pos.y - 24;

            return (
              <div
                key={`card_${node.id}`}
                className={cls(
                  "metro-card",
                  isSelected && "selected",
                  isCurrentSim && "sim-active",
                  isGhost && "ghost",
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
                {/* 1. Thumbnail Slot */}
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
                {isCurrentSim ? (
                  <span className="metro-card-status-chip status-running">
                    ● 推演中
                  </span>
                ) : isSimPast ? (
                  <span className="metro-card-status-chip status-completed">
                    ✓ 达标
                  </span>
                ) : (
                  <>
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
                    {node.status === "pending" && (
                      <span className="metro-card-status-chip status-pending">
                        ○ 预期
                      </span>
                    )}
                  </>
                )}

                {/* 5. Studio Mode Action Buttons */}
                {mode === "studio" && !isSimulating && (
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

      {/* Simulation Ticker Banner (Bottom Floating Commentary) */}
      {isSimulating && (
        <div className="metro-sim-ticker">
          <span className="metro-sim-badge">
            T+{simIndex + 1} / {sortedNodes.length}
          </span>
          <span className="metro-sim-text">{simCommentary}</span>
          <div className="metro-sim-ctrls">
            <button
              type="button"
              className="metro-sim-ctrl-btn"
              onClick={() => setSimPlaying(!simPlaying)}
            >
              {simPlaying ? "⏸ 暂停" : "▶ 继续"}
            </button>
            <button
              type="button"
              className="metro-sim-ctrl-btn"
              onClick={() => {
                setSimIndex((curr) =>
                  Math.min(curr + 1, sortedNodes.length - 1),
                );
              }}
            >
              步进 ▶|
            </button>
            <button
              type="button"
              className="metro-sim-ctrl-btn"
              onClick={() => {
                setSimIndex(0);
                setSimPlaying(true);
              }}
            >
              ↺ 重播
            </button>
            <button
              type="button"
              className="metro-sim-ctrl-btn exit"
              onClick={handleStopSimulation}
            >
              退出推演
            </button>
          </div>
        </div>
      )}

      {/* Floating HUD Controls */}
      <div className="metro-hud-controls">
        {!isSimulating ? (
          <button
            type="button"
            className="metro-hud-btn sim-btn"
            title="时序动态推演预览"
            onClick={handleStartSimulation}
          >
            ▶ 推演演示
          </button>
        ) : (
          <button
            type="button"
            className="metro-hud-btn sim-btn"
            onClick={handleStopSimulation}
          >
            ⏹ 停止推演
          </button>
        )}
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
