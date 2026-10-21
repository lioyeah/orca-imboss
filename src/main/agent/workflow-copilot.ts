import { ASSISTANT_ID } from "@shared/constants/employees";
import type { TaskFlowNode, WorkflowDefinition } from "@shared/types";
import { getDB } from "../db/index.ts";
import { getEmployee } from "../db/employees.ts";
import { getModelRuntime, resolveModel } from "./model-runtime.ts";

interface EmployeeBrief {
  id: number;
  name: string;
  role: string;
  skills: string;
  mcp: string;
}

interface CopilotInput {
  prompt?: string;
  workflow?: WorkflowDefinition;
}

const COPILOT_TIMEOUT_MS = 25_000;

export async function optimizeWorkflowWithAI(
  input: CopilotInput,
): Promise<WorkflowDefinition> {
  const db = getDB();
  const employees = db
    .prepare("SELECT id, name, role, skills, mcp FROM employees WHERE disabled = 0")
    .all() as EmployeeBrief[];

  const userIntent =
    input.prompt?.trim() ||
    input.workflow?.description?.trim() ||
    input.workflow?.title?.trim() ||
    "多员工协作分析与落地任务";

  try {
    const aiResult = await requestModelOptimization(userIntent, employees, input.workflow);
    if (aiResult) return aiResult;
  } catch (err) {
    console.warn("[workflow-copilot] AI optimization call failed, using intelligent heuristic fallback:", err);
  }

  // Intelligent heuristic fallback
  return generateHeuristicWorkflow(userIntent, employees);
}

async function requestModelOptimization(
  userIntent: string,
  employees: EmployeeBrief[],
  existingWf?: WorkflowDefinition,
): Promise<WorkflowDefinition | null> {
  const modelRuntime = await getModelRuntime();
  const model = resolveModel(modelRuntime, getEmployee(ASSISTANT_ID)?.modelId);
  if (!model) return null;

  const employeeDesc = employees
    .map(
      (e) =>
        `- ID: ${e.id}, 姓名: ${e.name}, 角色: ${e.role}, 技能: ${e.skills || "通用"}`,
    )
    .join("\n");

  const systemPrompt = `You are Employee 0 (Chief Orchestrator / 助手) of imboss.
Your goal is to optimize or generate a highly efficient multi-agent workflow DAG based on the user's intent.
Available team members in this workspace:
${employeeDesc}

Rules for the workflow:
1. Divide work logically into lanes:
   - Lane 0: Main trunk / primary deliverables / checkpoints.
   - Lane 1: Parallel research, analysis, or engineering sub-branches.
2. Structure nodes with proper types:
   - "root": Starting goal from the boss.
   - "employee_join": Assign an employee to join the task group when their turn starts.
   - "task": Concrete action step with a clear promptTemplate.
   - "employee_leave": Explicitly remove the employee when their part finishes (to protect context & save tokens!).
   - "approval_gate": An approval pause gate before high-risk or final deliverables.
   - "merge": Converge outputs back to the boss.
3. Every node must have: id, lane (0 or 1), order (0, 1, 2...), type, title (short, < 20 chars), subtitle, employeeId, employeeName, employeeRole, status: "pending", promptTemplate (for task nodes).
4. Edges must connect nodes sequentially or via branch/merge.
5. Return ONLY a valid JSON object matching:
{
  "title": "string",
  "description": "string",
  "nodes": [...],
  "edges": [{ "id": "e1", "from": "id1", "to": "id2", "kind": "sequence" | "branch" | "merge" }]
}`;

  const userMessage = `User's Goal: ${userIntent}\n${
    existingWf ? `Existing Draft Nodes: ${JSON.stringify(existingWf.nodes)}` : ""
  }\nPlease generate the optimized workflow JSON.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COPILOT_TIMEOUT_MS);

  try {
    const response = await modelRuntime.completeSimple(
      model,
      {
        systemPrompt,
        messages: [{ role: "user", content: userMessage, timestamp: Date.now() }],
      },
      { signal: controller.signal, maxTokens: 2048 },
    );

    if (response.stopReason === "error" || response.stopReason === "aborted") {
      return null;
    }

    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    // Extract JSON block if wrapped in markdown
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;

    const now = Math.floor(Date.now() / 1000);
    return {
      id: existingWf?.id || `wf_ai_${Date.now()}`,
      title: parsed.title || `0号员工优化: ${userIntent.slice(0, 20)}`,
      description: parsed.description || `由 0 号员工针对「${userIntent}」全自动优化生成的敏捷流`,
      nodes: parsed.nodes.map((n: TaskFlowNode, idx: number) => ({
        ...n,
        order: n.order ?? idx,
        status: "pending",
      })),
      edges: parsed.edges,
      createdAt: existingWf?.createdAt || now,
      updatedAt: now,
    };
  } finally {
    clearTimeout(timer);
  }
}

function generateHeuristicWorkflow(
  userIntent: string,
  employees: EmployeeBrief[],
): WorkflowDefinition {
  const now = Math.floor(Date.now() / 1000);
  const emp1 = employees[1] || employees[0] || { id: 0, name: "助手", role: "Assistant" };
  const emp2 = employees[2] || emp1;

  const nodes: TaskFlowNode[] = [
    {
      id: "ai_node_root",
      lane: 0,
      order: 0,
      type: "root",
      title: "总任务目标规划",
      subtitle: userIntent.slice(0, 30),
      status: "pending",
    },
    {
      id: "ai_node_emp1_join",
      lane: 0,
      order: 1,
      type: "employee_join",
      title: `${emp1.name} 介入前期工作`,
      subtitle: `根据「${emp1.role}」专长调配资源`,
      employeeId: emp1.id,
      employeeName: emp1.name,
      employeeRole: emp1.role,
      status: "pending",
    },
    {
      id: "ai_node_task_1",
      lane: 0,
      order: 2,
      type: "task",
      title: `需求调研与核心方案设计`,
      subtitle: `由 ${emp1.name} 产出初步执行规划`,
      employeeId: emp1.id,
      employeeName: emp1.name,
      employeeRole: emp1.role,
      promptTemplate: `针对目标「${userIntent}」，请完成详尽的前期调研、关键风险评估与分步落地大纲。`,
      status: "pending",
    },
    {
      id: "ai_node_emp2_join",
      lane: 1,
      order: 3,
      type: "employee_join",
      title: `${emp2.name} 并行介入落地`,
      subtitle: `调配「${emp2.role}」开展实操落地`,
      employeeId: emp2.id,
      employeeName: emp2.name,
      employeeRole: emp2.role,
      status: "pending",
    },
    {
      id: "ai_node_task_2",
      lane: 1,
      order: 4,
      type: "task",
      title: `落地开发与成果实现`,
      subtitle: `根据调研大纲完成实际输出`,
      employeeId: emp2.id,
      employeeName: emp2.name,
      employeeRole: emp2.role,
      promptTemplate: `根据上一步输出的设计大纲，请开始具体落地实现，产出核心代码或交付文档。`,
      badge: 1,
      status: "pending",
    },
    {
      id: "ai_node_emp1_leave",
      lane: 0,
      order: 5,
      type: "employee_leave",
      title: `${emp1.name} 阶段达成离场`,
      subtitle: `移出会话以保护后续上下文与节省 Token`,
      employeeId: emp1.id,
      employeeName: emp1.name,
      employeeRole: emp1.role,
      status: "pending",
    },
    {
      id: "ai_node_gate",
      lane: 1,
      order: 6,
      type: "approval_gate",
      title: `老板成果审批断点 (Gate)`,
      subtitle: `等待人工确认核心成果后方可汇总`,
      badge: "!",
      status: "pending",
    },
    {
      id: "ai_node_merge",
      lane: 0,
      order: 7,
      type: "merge",
      title: `成果终验与总结汇报`,
      subtitle: `全流程结项，输出完整交付包`,
      status: "pending",
    },
  ];

  const edges = [
    { id: "ae1", from: "ai_node_root", to: "ai_node_emp1_join", kind: "sequence" as const },
    { id: "ae2", from: "ai_node_emp1_join", to: "ai_node_task_1", kind: "sequence" as const },
    { id: "ae3", from: "ai_node_task_1", to: "ai_node_emp2_join", kind: "branch" as const },
    { id: "ae4", from: "ai_node_task_1", to: "ai_node_emp1_leave", kind: "sequence" as const },
    { id: "ae5", from: "ai_node_emp2_join", to: "ai_node_task_2", kind: "sequence" as const },
    { id: "ae6", from: "ai_node_task_2", to: "ai_node_gate", kind: "sequence" as const },
    { id: "ae7", from: "ai_node_gate", to: "ai_node_merge", kind: "merge" as const },
    { id: "ae8", from: "ai_node_emp1_leave", to: "ai_node_merge", kind: "merge" as const },
  ];

  return {
    id: `wf_copilot_${Date.now()}`,
    title: `0号员工优化: ${userIntent.slice(0, 16)}`,
    description: `0 号员工根据「${userIntent}」自适应工作区员工画像生成的敏捷协同流`,
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
  };
}
