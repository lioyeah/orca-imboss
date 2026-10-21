import type {
  Employee,
  TaskFlowNode,
  TaskFlowNodeType,
  TaskWorkflowGraph,
  WorkflowDefinition,
} from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cls } from "reactutils";
import { appStore } from "../../../../app-store";
import { ModuleView } from "../../../app-shell";
import {
  IconCheck,
  IconChevronDown,
  IconClock,
  IconCollapse,
  IconEdit,
  IconGraph,
  IconOpen,
  IconPlay,
  IconPlus,
  IconTrash,
  IconX,
} from "../../../icons";
import "../../module-common.css";
import { MetroCanvas } from "../metro-canvas";
import "./index.css";

export function GraphModule(): React.JSX.Element {
  // Mode switch: "live" (Task Observability) vs "studio" (ComfyUI Workflow Planning)
  const [mode, setMode] = useState<"live" | "studio">("live");

  // Live Task Observability State
  const [liveGraph, setLiveGraph] = useState<TaskWorkflowGraph | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<number | undefined>(undefined);
  const [chatSummaries, setChatSummaries] = useState<Array<{ id: number; title: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  // Workflow Studio State
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [currentWorkflow, setCurrentWorkflow] = useState<WorkflowDefinition | null>(null);

  // Workspace Employees (for Assigning / Joining / Leaving in Studio)
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Selected Node (for Canvas & Inspector Drawer)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showInspector, setShowInspector] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Workflow Copilot (Employee 0 Optimization) State
  const [showCopilotModal, setShowCopilotModal] = useState(false);
  const [copilotPrompt, setCopilotPrompt] = useState("");
  const [isCopilotRunning, setIsCopilotRunning] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  }, []);

  // Load Workspace Employees
  useEffect(() => {
    void imb.employees.list().then(setEmployees).catch(() => {});
  }, []);

  // Load Chats for Selector
  useEffect(() => {
    void imb.chats
      .summaries()
      .then((items) => {
        setChatSummaries(
          items.map((c) => ({
            id: c.id,
            title: c.title.trim().length > 0 ? c.title : `对话 #${c.id}`,
          })),
        );
      })
      .catch(() => {});
  }, [refreshToken]);

  // Load Live Tasks
  useEffect(() => {
    if (mode !== "live") return;
    let alive = true;
    setLoading(true);
    setError(null);

    void imb.graph
      .getTasks(selectedChatId)
      .then((g) => {
        if (!alive) return;
        setLiveGraph(g);
        if (!selectedChatId && g.chatId) {
          setSelectedChatId(g.chatId);
        }
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [mode, selectedChatId, refreshToken]);

  // Load Workflows in Studio Mode
  useEffect(() => {
    if (mode !== "studio") return;
    let alive = true;
    void imb.graph
      .listWorkflows()
      .then((wfs) => {
        if (!alive) return;
        setWorkflows(wfs);
        if (wfs.length > 0 && !currentWorkflow) {
          setCurrentWorkflow(wfs[0]);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [mode, currentWorkflow]);

  // Subscribe to Chat and Message changes for live reactive updating
  useEffect(() => {
    const unsubs = [
      imb.chats.onChanged(() => setRefreshToken((n) => n + 1)),
      imb.chats.onDeleted(() => setRefreshToken((n) => n + 1)),
    ];
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, []);

  // Active Graph for Canvas
  const activeGraph: TaskWorkflowGraph | null = useMemo(() => {
    if (mode === "live") return liveGraph;
    if (!currentWorkflow) return null;
    return {
      nodes: currentWorkflow.nodes,
      edges: currentWorkflow.edges,
      mode: "studio",
      activeTaskId: currentWorkflow.id,
      chatId: null,
      chatTitle: currentWorkflow.title,
      generatedAt: currentWorkflow.updatedAt * 1000,
    };
  }, [mode, liveGraph, currentWorkflow]);

  // Selected Node Object
  const selectedNode = useMemo(() => {
    if (!activeGraph || !selectedNodeId) return null;
    return activeGraph.nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [activeGraph, selectedNodeId]);

  // Live Metrics
  const metrics = useMemo(() => {
    if (!activeGraph) return { total: 0, completed: 0, running: 0 };
    let completed = 0;
    let running = 0;
    for (const n of activeGraph.nodes) {
      if (n.status === "completed") completed++;
      if (n.status === "running") running++;
    }
    return { total: activeGraph.nodes.length, completed, running };
  }, [activeGraph]);

  // Save current live task tree as a Workflow Template
  const handleExportAsTemplate = useCallback(async () => {
    if (!liveGraph || liveGraph.nodes.length === 0) return;
    try {
      const saved = await imb.graph.exportToWorkflow(liveGraph);
      setWorkflows((prev) => [saved, ...prev]);
      setCurrentWorkflow(saved);
      showToast(`已成功转存为工作流模板:「${saved.title}」`);
      setMode("studio");
    } catch (err: unknown) {
      showToast(`转存失败: ${String(err)}`);
    }
  }, [liveGraph, showToast]);

  // Create New Empty Workflow
  const handleCreateNewWorkflow = useCallback(() => {
    const now = Math.floor(Date.now() / 1000);
    const newWf: WorkflowDefinition = {
      id: `wf_${Date.now()}`,
      title: "新任务流编排",
      description: "自定义多员工接入/离场与串并行任务规划",
      nodes: [
        {
          id: "node_start",
          lane: 0,
          order: 0,
          type: "root",
          title: "总任务目标",
          subtitle: "在此输入需要达成的总任务要求",
          status: "pending",
        },
      ],
      edges: [],
      createdAt: now,
      updatedAt: now,
    };
    void imb.graph.saveWorkflow(newWf).then((saved) => {
      setWorkflows((prev) => [saved, ...prev]);
      setCurrentWorkflow(saved);
      setSelectedNodeId("node_start");
      showToast("已创建新工作流");
    });
  }, [showToast]);

  // Save Studio Workflow
  const handleSaveCurrentWorkflow = useCallback(async () => {
    if (!currentWorkflow) return;
    try {
      const saved = await imb.graph.saveWorkflow(currentWorkflow);
      setWorkflows((prev) => prev.map((w) => (w.id === saved.id ? saved : w)));
      setCurrentWorkflow(saved);
      showToast("工作流已保存");
    } catch (err) {
      showToast(`保存失败: ${String(err)}`);
    }
  }, [currentWorkflow, showToast]);

  // Delete Workflow
  const handleDeleteCurrentWorkflow = useCallback(async () => {
    if (!currentWorkflow) return;
    if (!confirm(`确认删除工作流模板「${currentWorkflow.title}」？`)) return;
    await imb.graph.deleteWorkflow(currentWorkflow.id);
    const remaining = workflows.filter((w) => w.id !== currentWorkflow.id);
    setWorkflows(remaining);
    setCurrentWorkflow(remaining[0] ?? null);
    setSelectedNodeId(null);
    showToast("工作流已删除");
  }, [currentWorkflow, workflows, showToast]);

  // Copilot AI Optimization
  const handleCopilotOptimize = useCallback(async () => {
    setIsCopilotRunning(true);
    try {
      const optimized = await imb.graph.copilotOptimize({
        prompt: copilotPrompt.trim() || undefined,
        workflow: currentWorkflow ?? undefined,
      });
      await imb.graph.saveWorkflow(optimized);
      setWorkflows((prev) => [
        optimized,
        ...prev.filter((w) => w.id !== optimized.id),
      ]);
      setCurrentWorkflow(optimized);
      setSelectedNodeId(optimized.nodes[0]?.id ?? null);
      setShowCopilotModal(false);
      setCopilotPrompt("");
      showToast("✦ 0号员工已完成流架构优化并载入画布！");
    } catch (err: unknown) {
      showToast(`优化失败: ${String(err)}`);
    } finally {
      setIsCopilotRunning(false);
    }
  }, [copilotPrompt, currentWorkflow, showToast]);

  // Studio: Add Node (sequential or branch)
  const handleAddNode = useCallback(
    (fromNodeId: string, asBranch: boolean) => {
      if (!currentWorkflow) return;
      const fromNode = currentWorkflow.nodes.find((n) => n.id === fromNodeId);
      if (!fromNode) return;

      const newId = `node_${Date.now()}`;
      const targetLane = asBranch ? fromNode.lane + 1 : fromNode.lane;
      const targetOrder = fromNode.order + 1;

      // Shift subsequent nodes' order
      const updatedNodes = currentWorkflow.nodes.map((n) =>
        n.order >= targetOrder ? { ...n, order: n.order + 1 } : n,
      );

      const newNode: TaskFlowNode = {
        id: newId,
        lane: targetLane,
        order: targetOrder,
        type: asBranch ? "employee_join" : "task",
        title: asBranch ? "新员工接入" : "新任务步骤",
        subtitle: asBranch ? "配置加入该任务群的员工" : "配置任务提示词与产出",
        status: "pending",
      };

      const newEdge = {
        id: `e_${fromNodeId}_${newId}`,
        from: fromNodeId,
        to: newId,
        kind: asBranch ? ("branch" as const) : ("sequence" as const),
      };

      const nextWf: WorkflowDefinition = {
        ...currentWorkflow,
        nodes: [...updatedNodes, newNode],
        edges: [...currentWorkflow.edges, newEdge],
      };

      setCurrentWorkflow(nextWf);
      setSelectedNodeId(newId);
    },
    [currentWorkflow],
  );

  // Studio: Delete Node
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      if (!currentWorkflow) return;
      const nextNodes = currentWorkflow.nodes.filter((n) => n.id !== nodeId);
      const nextEdges = currentWorkflow.edges.filter(
        (e) => e.from !== nodeId && e.to !== nodeId,
      );
      setCurrentWorkflow({
        ...currentWorkflow,
        nodes: nextNodes,
        edges: nextEdges,
      });
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
    },
    [currentWorkflow, selectedNodeId],
  );

  // Studio: Update Node Properties
  const handleUpdateSelectedNode = useCallback(
    (patch: Partial<TaskFlowNode>) => {
      if (!currentWorkflow || !selectedNodeId) return;
      const nextNodes = currentWorkflow.nodes.map((n) =>
        n.id === selectedNodeId ? { ...n, ...patch } : n,
      );
      setCurrentWorkflow({
        ...currentWorkflow,
        nodes: nextNodes,
      });
    },
    [currentWorkflow, selectedNodeId],
  );

  // Jump to Chat from Live Node
  const handleJumpToChat = useCallback(async (chatId: number) => {
    try {
      const summary = await imb.chats.summary(chatId);
      if (summary) {
        appStore.openChat(summary);
      }
    } catch {
      // ignore
    }
  }, []);

  return (
    <ModuleView
      content={
        <div className="imb-graph-module-root">
          {/* Top Header & Toolbar (Refined Linear-style Unified Single Bar) */}
          <div className="metro-graph-header">
            {/* Left: Mode Segmented Pill + Divider + Title Dropdown */}
            <div className="metro-header-left">
              <div className="metro-segmented-control">
                <button
                  type="button"
                  className={cls("metro-segment-btn", mode === "live" && "active")}
                  onClick={() => {
                    setMode("live");
                    setSelectedNodeId(null);
                  }}
                >
                  <IconGraph className="metro-segment-icon" />
                  <span>任务监控</span>
                </button>
                <button
                  type="button"
                  className={cls("metro-segment-btn", mode === "studio" && "active")}
                  onClick={() => {
                    setMode("studio");
                    setSelectedNodeId(null);
                  }}
                >
                  <IconEdit className="metro-segment-icon" />
                  <span>流程编排</span>
                </button>
              </div>

              <div className="metro-header-divider" />

              {/* Document Title Picker Dropdown */}
              {mode === "live" ? (
                <div className="metro-title-picker-wrap">
                  <select
                    className="metro-title-select"
                    value={selectedChatId ?? ""}
                    onChange={(e) => setSelectedChatId(Number(e.target.value))}
                  >
                    {chatSummaries.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                  <div className="metro-title-picker-display">
                    <span className="metro-title-text">
                      {chatSummaries.find((c) => c.id === selectedChatId)?.title || "当前任务群"}
                    </span>
                    <IconChevronDown className="metro-title-chevron" />
                  </div>
                </div>
              ) : (
                <div className="metro-title-picker-wrap">
                  <select
                    className="metro-title-select"
                    value={currentWorkflow?.id ?? ""}
                    onChange={(e) => {
                      const target = workflows.find((w) => w.id === e.target.value);
                      if (target) setCurrentWorkflow(target);
                    }}
                  >
                    {workflows.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.title}
                      </option>
                    ))}
                  </select>
                  <div className="metro-title-picker-display">
                    <span className="metro-title-text">
                      {currentWorkflow?.title || "未命名方案"}
                    </span>
                    <IconChevronDown className="metro-title-chevron" />
                  </div>
                </div>
              )}
            </div>

            {/* Center: Clean Status / Metrics Pill */}
            <div className="metro-header-center">
              <div className="metro-stats-pill">
                <span className="metro-stat-dot" />
                <span className="metro-stat-num">{metrics.total}</span>
                <span className="metro-stat-label">步骤</span>
                <span className="metro-stat-sep">·</span>
                <span className="metro-stat-num text-success">{metrics.completed}</span>
                <span className="metro-stat-label">完成</span>
                {metrics.running > 0 && (
                  <>
                    <span className="metro-stat-sep">·</span>
                    <span className="metro-stat-num text-running">{metrics.running}</span>
                    <span className="metro-stat-label">运行中</span>
                  </>
                )}
              </div>
            </div>

            {/* Right: Actions Cluster & Drawer Trigger */}
            <div className="metro-header-right">
              {mode === "live" ? (
                <button
                  type="button"
                  className="metro-tool-btn primary-ghost"
                  onClick={handleExportAsTemplate}
                  title="将当前任务群的执行树转存为工作流模板"
                >
                  <span>另存为模板</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="metro-tool-btn copilot"
                    onClick={() => setShowCopilotModal(true)}
                    title="由 0 号员工（助手）基于目标优化工作流"
                  >
                    <span className="copilot-sparkle">✦</span>
                    <span>助手完善流</span>
                  </button>

                  <button
                    type="button"
                    className="metro-tool-btn ghost"
                    onClick={handleCreateNewWorkflow}
                    title="新建空白工作流"
                  >
                    <IconPlus className="btn-icon" />
                    <span>新建</span>
                  </button>

                  <button
                    type="button"
                    className="metro-tool-btn ghost"
                    onClick={handleSaveCurrentWorkflow}
                    title="保存当前工作流更改"
                  >
                    <IconCheck className="btn-icon" />
                    <span>保存</span>
                  </button>

                  <button
                    type="button"
                    className="metro-tool-btn run-btn"
                    onClick={() => {
                      showToast("已启动任务流调度！正在创建群组并派遣员工...");
                    }}
                    title="在工作区运行此工作流"
                  >
                    <IconPlay className="btn-icon" />
                    <span>运行</span>
                  </button>

                  {currentWorkflow && (
                    <button
                      type="button"
                      className="metro-tool-btn icon-only danger"
                      title="删除该工作流模板"
                      onClick={handleDeleteCurrentWorkflow}
                    >
                      <IconTrash className="btn-icon" />
                    </button>
                  )}
                </>
              )}

              <div className="metro-header-divider" />

              <button
                type="button"
                className={cls("metro-tool-btn icon-only drawer-toggle", showInspector && "active")}
                onClick={() => setShowInspector(!showInspector)}
                title="切换属性详情抽屉"
              >
                <IconCollapse className={cls("btn-icon", !showInspector && "rotate-180")} />
              </button>
            </div>
          </div>

      {/* Main Content Area */}
      <div className="metro-graph-body">
        {loading && mode === "live" ? (
          <div className="metro-graph-loading">
            <IconClock className="animate-spin" />
            <span>加载分支任务图谱...</span>
          </div>
        ) : error && mode === "live" ? (
          <div className="metro-graph-error">
            <span>{error}</span>
          </div>
        ) : activeGraph && activeGraph.nodes.length > 0 ? (
          <MetroCanvas
            graph={activeGraph}
            selectedId={selectedNodeId}
            mode={mode}
            onSelectNode={(node) => {
              setSelectedNodeId(node ? node.id : null);
              if (node) setShowInspector(true);
            }}
            onAddNode={handleAddNode}
            onDeleteNode={handleDeleteNode}
            onApproveGate={() => {
              showToast("人工审核已通过，继续推进下游任务节点！");
            }}
          />
        ) : (
          <div className="metro-graph-empty">
            <IconGraph className="empty-icon" />
            <h3>暂无任务图谱数据</h3>
            <p>
              {mode === "live"
                ? "选择一个包含子任务群的会话，或者在工作流编排中自行规划。"
                : "点击「新建流」开始规划多员工协同工作流。"}
            </p>
          </div>
        )}

        {/* Inspector Drawer (Right Side) */}
        {showInspector && selectedNode && (
          <div className="metro-inspector-drawer">
            <div className="metro-inspector-header">
              <div className="metro-inspector-title-row">
                <span className={cls("metro-type-badge", selectedNode.type)}>
                  {selectedNode.type === "root" && "目标起点"}
                  {selectedNode.type === "task" && "任务步骤"}
                  {selectedNode.type === "employee_join" && "员工接入"}
                  {selectedNode.type === "employee_leave" && "员工离场"}
                  {selectedNode.type === "approval_gate" && "人工审批"}
                  {selectedNode.type === "merge" && "成果汇聚"}
                </span>
                <span className="metro-node-id">{selectedNode.id}</span>
              </div>
              <button
                type="button"
                className="metro-close-btn"
                onClick={() => setSelectedNodeId(null)}
              >
                <IconX />
              </button>
            </div>

            <div className="metro-inspector-content">
              {mode === "live" ? (
                /* Live Mode Read-only Detail */
                <div className="metro-inspector-live-view">
                  <h3 className="metro-live-title">{selectedNode.title}</h3>
                  {selectedNode.subtitle && (
                    <p className="metro-live-sub">{selectedNode.subtitle}</p>
                  )}

                  {/* Status */}
                  <div className="metro-live-section">
                    <label>执行状态</label>
                    <div className="metro-live-status-row">
                      <span className={cls("status-pill", selectedNode.status)}>
                        {selectedNode.status === "completed" && "✓ 已完成"}
                        {selectedNode.status === "running" && "● 正在执行"}
                        {selectedNode.status === "pending" && "○ 等待触发"}
                        {selectedNode.status === "interrupted" && "✕ 已中断"}
                        {selectedNode.status === "waiting_approval" && "⏳ 等待审批"}
                      </span>
                    </div>
                  </div>

                  {/* Assigned Employee */}
                  {(selectedNode.employeeName || selectedNode.employeeRole) && (
                    <div className="metro-live-section">
                      <label>责任员工</label>
                      <div className="metro-employee-profile-card">
                        {selectedNode.employeeAvatar ? (
                          <img
                            src={selectedNode.employeeAvatar}
                            className="emp-avatar"
                            alt="avatar"
                          />
                        ) : (
                          <div className="emp-avatar-placeholder">
                            {selectedNode.employeeName?.[0] ?? "E"}
                          </div>
                        )}
                        <div className="emp-meta">
                          <span className="emp-name">{selectedNode.employeeName}</span>
                          <span className="emp-role">{selectedNode.employeeRole}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Output Snippet */}
                  {selectedNode.outputSnippet && (
                    <div className="metro-live-section">
                      <label>产物交付 / 回复摘要</label>
                      <div className="metro-snippet-box">
                        {selectedNode.outputSnippet}
                      </div>
                    </div>
                  )}

                  {/* Thumbnail / Image Preview */}
                  {selectedNode.thumbnail && (
                    <div className="metro-live-section">
                      <label>生成产物图片</label>
                      <div className="metro-large-preview">
                        <img src={selectedNode.thumbnail} alt="preview" />
                      </div>
                    </div>
                  )}

                  {/* Jump to Chat button */}
                  {selectedNode.chatId && (
                    <button
                      type="button"
                      className="metro-jump-btn"
                      onClick={() => handleJumpToChat(selectedNode.chatId!)}
                    >
                      <IconOpen className="metro-btn-icon" /> 跳转进入对应会话 #
                      {selectedNode.chatId}
                    </button>
                  )}
                </div>
              ) : (
                /* Studio Mode Editable Form */
                <div className="metro-inspector-form">
                  <div className="metro-form-field">
                    <label>步骤标题</label>
                    <input
                      type="text"
                      className="metro-input"
                      value={selectedNode.title}
                      onChange={(e) =>
                        handleUpdateSelectedNode({ title: e.target.value })
                      }
                    />
                  </div>

                  <div className="metro-form-field">
                    <label>节点类型</label>
                    <select
                      className="metro-select-field"
                      value={selectedNode.type}
                      onChange={(e) =>
                        handleUpdateSelectedNode({
                          type: e.target.value as TaskFlowNodeType,
                        })
                      }
                    >
                      <option value="task">执行任务 (Task)</option>
                      <option value="employee_join">员工介入 (Employee Join)</option>
                      <option value="employee_leave">员工离场 (Employee Leave)</option>
                      <option value="approval_gate">人工审批卡点 (Approval Gate)</option>
                      <option value="merge">汇聚收敛 (Merge Output)</option>
                    </select>
                  </div>

                  {/* Employee Select */}
                  <div className="metro-form-field">
                    <label>指派员工</label>
                    <select
                      className="metro-select-field"
                      value={selectedNode.employeeId ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val) {
                          handleUpdateSelectedNode({
                            employeeId: null,
                            employeeName: null,
                            employeeRole: null,
                            employeeAvatar: null,
                          });
                        } else {
                          const emp = employees.find((emp) => emp.id === Number(val));
                          if (emp) {
                            handleUpdateSelectedNode({
                              employeeId: emp.id,
                              employeeName: emp.name,
                              employeeRole: emp.role,
                              employeeAvatar: emp.avatar,
                            });
                          }
                        }
                      }}
                    >
                      <option value="">-- 未指定 / 助手 (Assistant) --</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.name} ({emp.role})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="metro-form-field">
                    <label>任务描述 / 提示词模板 (Prompt)</label>
                    <textarea
                      className="metro-textarea"
                      rows={5}
                      placeholder="定义该步骤交由员工处理的任务 prompt，支持 {{step1.output}} 变量引用..."
                      value={selectedNode.promptTemplate ?? ""}
                      onChange={(e) =>
                        handleUpdateSelectedNode({
                          promptTemplate: e.target.value,
                        })
                      }
                    />
                  </div>

                  <div className="metro-form-field">
                    <label>辅助说明 (Subtitle)</label>
                    <input
                      type="text"
                      className="metro-input"
                      value={selectedNode.subtitle ?? ""}
                      onChange={(e) =>
                        handleUpdateSelectedNode({ subtitle: e.target.value })
                      }
                    />
                  </div>

                  <div className="metro-form-field">
                    <label>状态重置</label>
                    <select
                      className="metro-select-field"
                      value={selectedNode.status}
                      onChange={(e) =>
                        handleUpdateSelectedNode({
                          status: e.target.value as any,
                        })
                      }
                    >
                      <option value="pending">待处理 (Pending)</option>
                      <option value="running">进行中 (Running)</option>
                      <option value="completed">已完成 (Completed)</option>
                      <option value="waiting_approval">等待审批 (Waiting Approval)</option>
                    </select>
                  </div>

                  {selectedNode.type !== "root" && (
                    <button
                      type="button"
                      className="metro-delete-node-btn"
                      onClick={() => handleDeleteNode(selectedNode.id)}
                    >
                      <IconTrash /> 删除该步骤节点
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

          {/* 0号员工 Copilot 优化弹窗 */}
      {showCopilotModal && (
        <div
          className="metro-copilot-modal-backdrop"
          onClick={() => setShowCopilotModal(false)}
        >
          <div
            className="metro-copilot-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="metro-copilot-head">
              <h3>✦ 0 号员工流架构协创器</h3>
              <button
                type="button"
                className="metro-close-btn"
                onClick={() => setShowCopilotModal(false)}
              >
                <IconX />
              </button>
            </div>
            <div className="metro-copilot-body">
              <p>
                告诉 0 号员工你的预期目标，它将读取工作区内全体员工的专长与技能，自动规划出包含
                <strong> 员工介入、精细 Prompt、阶段性离场（节约 Token）与人工审批 Gate </strong>
                的完整 Metro-Rail 敏捷流。
              </p>
              <textarea
                className="metro-copilot-input"
                rows={4}
                placeholder="例如：对近半年三家主流竞品进行功能差异分析，编写数据对比爬虫，并完成一份包含图表的最终汇报..."
                value={copilotPrompt}
                onChange={(e) => setCopilotPrompt(e.target.value)}
              />
            </div>
            <div className="metro-copilot-foot">
              <button
                type="button"
                className="metro-copilot-btn"
                onClick={() => setShowCopilotModal(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="metro-copilot-btn primary"
                disabled={isCopilotRunning}
                onClick={handleCopilotOptimize}
              >
                {isCopilotRunning ? "0号员工正在规划中..." : "一键优化并生成流"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
          {toastMessage && (
            <div className="metro-floating-toast">
              <span>{toastMessage}</span>
            </div>
          )}
        </div>
      }
    />
  );
}
