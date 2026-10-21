import type { TaskWorkflowGraph, WorkflowDefinition } from "@shared/types";
import { getDB } from "./index.ts";

/**
 * Idempotently ensure the workflows table exists in SQLite.
 * Uses the same database connection as other tables without requiring a version bump.
 */
function ensureWorkflowTable(): void {
  const db = getDB();
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL DEFAULT '',
      definition TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
      updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
    );
  `);
}

interface WorkflowRow {
  id: string;
  title: string;
  definition: string;
  created_at: number;
  updated_at: number;
}

export function listWorkflows(): WorkflowDefinition[] {
  ensureWorkflowTable();
  const db = getDB();
  const rows = db
    .prepare("SELECT * FROM workflows ORDER BY updated_at DESC, created_at DESC")
    .all() as WorkflowRow[];

  if (rows.length === 0) {
    // Populate an initial starter template for easy demonstration
    const starter = createDefaultTemplate();
    saveWorkflow(starter);
    return [starter];
  }

  return rows.map((row) => {
    try {
      const parsed = JSON.parse(row.definition);
      return {
        id: row.id,
        title: row.title,
        description: parsed.description,
        nodes: parsed.nodes ?? [],
        edges: parsed.edges ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } catch {
      return {
        id: row.id,
        title: row.title,
        nodes: [],
        edges: [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }
  });
}

export function getWorkflow(id: string): WorkflowDefinition | null {
  ensureWorkflowTable();
  const db = getDB();
  const row = db
    .prepare("SELECT * FROM workflows WHERE id = ?")
    .get(id) as WorkflowRow | undefined;
  if (!row) return null;

  try {
    const parsed = JSON.parse(row.definition);
    return {
      id: row.id,
      title: row.title,
      description: parsed.description,
      nodes: parsed.nodes ?? [],
      edges: parsed.edges ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch {
    return {
      id: row.id,
      title: row.title,
      nodes: [],
      edges: [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export function saveWorkflow(wf: WorkflowDefinition): WorkflowDefinition {
  ensureWorkflowTable();
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  const definitionJson = JSON.stringify({
    description: wf.description ?? "",
    nodes: wf.nodes,
    edges: wf.edges,
  });

  db.prepare(
    `INSERT INTO workflows (id, title, definition, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       definition = excluded.definition,
       updated_at = excluded.updated_at`,
  ).run(wf.id, wf.title, definitionJson, wf.createdAt || now, now);

  return {
    ...wf,
    updatedAt: now,
  };
}

export function deleteWorkflow(id: string): boolean {
  ensureWorkflowTable();
  const db = getDB();
  const result = db.prepare("DELETE FROM workflows WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Creates a default starter multi-agent workflow:
 * Objective -> Alice (Researcher) joins -> Market Research Task -> Bob (Coder) joins -> Implementation Task -> Alice leaves -> Approval Gate -> Done.
 */
export function createDefaultTemplate(): WorkflowDefinition {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "wf_starter_template",
    title: "多员工协同分析与实施模板 (Starter Workflow)",
    description: "演示如何编排员工介入、并行/串行任务交付、员工离场与人工审批卡点",
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "node_root",
        lane: 0,
        order: 0,
        type: "root",
        title: "项目目标与背景输入",
        subtitle: "老板总要求输入",
        status: "completed",
        badge: null,
      },
      {
        id: "node_alice_join",
        lane: 0,
        order: 1,
        type: "employee_join",
        title: "调配研究专员 (Alice) 接入",
        subtitle: "拉入会话开始前期调研",
        status: "completed",
        employeeId: null,
        employeeName: "Alice",
        employeeRole: "Researcher",
      },
      {
        id: "node_research_task",
        lane: 0,
        order: 2,
        type: "task",
        title: "竞品调研与方案初稿",
        subtitle: "收集核心数据与功能对比",
        status: "completed",
        employeeId: null,
        employeeName: "Alice",
        employeeRole: "Researcher",
        promptTemplate: "请调研并列出核心竞品的功能优劣势与技术路线方案。",
      },
      {
        id: "node_bob_join",
        lane: 1,
        order: 3,
        type: "employee_join",
        title: "调配研发工程师 (Bob) 接入",
        subtitle: "技术评审与代码落地",
        status: "running",
        employeeId: null,
        employeeName: "Bob",
        employeeRole: "Engineer",
      },
      {
        id: "node_code_task",
        lane: 1,
        order: 4,
        type: "task",
        title: "技术方案评估与核心代码落地",
        subtitle: "根据调研成果编写架构原型",
        status: "running",
        employeeId: null,
        employeeName: "Bob",
        employeeRole: "Engineer",
        badge: 2,
        promptTemplate: "根据上一步的竞品调研方案，编写技术实现方案与架构原型。",
      },
      {
        id: "node_alice_leave",
        lane: 0,
        order: 5,
        type: "employee_leave",
        title: "Alice 任务完成，离场移出会话",
        subtitle: "保护后续上下文，节省 Token 消耗",
        status: "completed",
        employeeId: null,
        employeeName: "Alice",
        employeeRole: "Researcher",
      },
      {
        id: "node_approval_gate",
        lane: 1,
        order: 6,
        type: "approval_gate",
        title: "人工审核卡点 (Boss Gate)",
        subtitle: "需老板确认技术原型后方可推进",
        status: "waiting_approval",
        badge: "!",
      },
      {
        id: "node_finalize",
        lane: 0,
        order: 7,
        type: "merge",
        title: "成果汇总与归档发布",
        subtitle: "全流程结项报告",
        status: "pending",
      },
    ],
    edges: [
      { id: "e1", from: "node_root", to: "node_alice_join", kind: "sequence" },
      { id: "e2", from: "node_alice_join", to: "node_research_task", kind: "sequence" },
      { id: "e3", from: "node_research_task", to: "node_bob_join", kind: "branch" },
      { id: "e4", from: "node_research_task", to: "node_alice_leave", kind: "sequence" },
      { id: "e5", from: "node_bob_join", to: "node_code_task", kind: "sequence" },
      { id: "e6", from: "node_code_task", to: "node_approval_gate", kind: "sequence" },
      { id: "e7", from: "node_approval_gate", to: "node_finalize", kind: "merge" },
      { id: "e8", from: "node_alice_leave", to: "node_finalize", kind: "merge" },
    ],
  };
}

/**
 * Converts a live-tracked task graph into an editable workflow template.
 */
export function exportTaskGraphToWorkflow(
  graph: TaskWorkflowGraph,
  title?: string,
): WorkflowDefinition {
  const now = Math.floor(Date.now() / 1000);
  const wfId = `wf_${Date.now()}`;
  const wf: WorkflowDefinition = {
    id: wfId,
    title: title || `根据任务群转存的模板: ${graph.chatTitle || "自动任务流"}`,
    description: `从会话 #${graph.chatId || 0} 自动提取转化的工作流模板`,
    nodes: graph.nodes.map((n) => ({
      ...n,
      status: "pending", // Reset statuses to pending for the new template
    })),
    edges: graph.edges,
    createdAt: now,
    updatedAt: now,
  };
  saveWorkflow(wf);
  return wf;
}
