/**
 * Build the workspace graph from the tables that already exist. Nothing is
 * persisted — the payload is derived on demand and handed to the renderer.
 *
 * Entity Cognitive Network:
 * - Chats: user-facing root conversations and spawned task groups.
 * - Employees: agent personas with dynamic tools, skills and sessions.
 * - Artifacts: code files, documents, visual assets produced or referenced across tasks.
 * - Tools: orchestration, shell, coding, and MCP capability nodes invoked across DAG flows.
 * - Tags: semantic categorical nodes.
 *
 * Semantic links:
 * - `spawned`: task DAG branching (parent -> child).
 * - `attached`: reference cards or attachments.
 * - `progress`: task reporting notice.
 * - `participant` & `session`: employee participation and active agent session.
 * - `produces`: chat or employee generated an artifact.
 * - `references`: chat or user referenced an artifact.
 * - `invokes`: chat or employee invoked a capability/tool.
 */

import type {
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphPayload,
  NodeLifecycle,
} from "@shared/types";
import { getDB } from "./index";
import {
  parseJsonObject,
  parseNumberArray,
  parseStringArray,
} from "./json";
import { listTags } from "./tags";

interface ChatRow {
  id: number;
  title: string;
  participants: string;
  from_chat_id: number | null;
  created_at: number;
  last_message_at: number;
}

interface EmployeeRow {
  id: number;
  name: string;
  role: string;
  disabled: number;
  avatar: string | null;
  mcp: string;
  skills: string;
}

interface MessageRow {
  id: number;
  chat_id: number;
  sender_employee_id: number | null;
  kind: string;
  content: string;
  steps: string | null;
  attachments: string | null;
  created_at: number;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0 || !Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extractFileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return "";
  return name.slice(dot).toLowerCase();
}

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".json",
  ".css",
  ".html",
  ".sql",
  ".sh",
  ".rs",
  ".go",
  ".yaml",
  ".yml",
  ".md",
]);

export function buildGraph(): GraphPayload {
  const db = getDB();
  const chatRows = db
    .prepare(
      "SELECT id, title, participants, from_chat_id, created_at, last_message_at FROM chats",
    )
    .all() as ChatRow[];
  const employeeRows = db
    .prepare(
      "SELECT id, name, role, disabled, avatar, mcp, skills FROM employees",
    )
    .all() as EmployeeRow[];
  const sessionRows = db
    .prepare("SELECT employee_id, chat_id FROM sessions")
    .all() as Array<{ employee_id: number; chat_id: number }>;
  const tagRows = db
    .prepare("SELECT chat_id, tag FROM chat_tags")
    .all() as Array<{ chat_id: number; tag: string }>;
  const countRows = db
    .prepare("SELECT chat_id, count(*) AS n FROM messages GROUP BY chat_id")
    .all() as Array<{ chat_id: number; n: number }>;

  // Check last message kind per chat for lifecycle status
  const lastMsgRows = db
    .prepare(
      "SELECT chat_id, kind FROM messages WHERE id IN (SELECT MAX(id) FROM messages GROUP BY chat_id)",
    )
    .all() as Array<{ chat_id: number; kind: string }>;
  const lastMsgKindMap = new Map<number, string>();
  for (const row of lastMsgRows) lastMsgKindMap.set(row.chat_id, row.kind);

  const messageCounts = new Map<number, number>();
  for (const row of countRows) messageCounts.set(row.chat_id, row.n);

  const chatIds = new Set<number>();
  const chatParentMap = new Map<number, number | null>();
  for (const row of chatRows) {
    chatIds.add(row.id);
    chatParentMap.set(row.id, row.from_chat_id);
  }
  const employeeIds = new Set<number>();
  const employeeNameMap = new Map<number, string>();
  for (const row of employeeRows) {
    employeeIds.add(row.id);
    employeeNameMap.set(row.id, row.name.trim());
  }

  // Compute clusterId and hierarchical level for each chat
  const resolveCausalMeta = (id: number): { rootId: number; level: number } => {
    let curr = id;
    let level = 0;
    const visited = new Set<number>();
    while (curr !== null) {
      if (visited.has(curr)) break;
      visited.add(curr);
      const parent = chatParentMap.get(curr);
      if (parent === null || parent === undefined || !chatIds.has(parent)) {
        return { rootId: curr, level };
      }
      level++;
      curr = parent;
    }
    return { rootId: curr, level };
  };

  const nodes: GraphNode[] = [];
  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeWeights = new Map<string, number>();
  const edgeObjMap = new Map<string, GraphEdge>();

  const addNode = (node: GraphNode): void => {
    if (!nodeMap.has(node.id)) {
      nodeMap.set(node.id, node);
      nodes.push(node);
    }
  };

  const addEdge = (
    source: string,
    target: string,
    kind: GraphEdgeKind,
    weight = 1,
  ): void => {
    if (source === target) return;
    const id = `${kind}|${source}|${target}`;
    const currWeight = edgeWeights.get(id) ?? 0;
    edgeWeights.set(id, currWeight + weight);

    if (!edgeObjMap.has(id)) {
      const edge: GraphEdge = { id, source, target, kind, weight };
      edgeObjMap.set(id, edge);
      edges.push(edge);
    } else {
      const edge = edgeObjMap.get(id)!;
      edge.weight = edgeWeights.get(id);
    }
  };

  let minTime = Infinity;
  let maxTime = -Infinity;

  // --- Chats: nodes, participant edges and spawn edges ---
  for (const row of chatRows) {
    const participants = parseNumberArray(row.participants);
    const title = row.title.trim();
    const createdAtMs =
      row.created_at > 1e11 ? row.created_at : row.created_at * 1000;
    const lastActiveMs =
      row.last_message_at > 0
        ? row.last_message_at > 1e11
          ? row.last_message_at
          : row.last_message_at * 1000
        : createdAtMs;

    if (createdAtMs < minTime) minTime = createdAtMs;
    if (lastActiveMs > maxTime) maxTime = lastActiveMs;

    const { rootId, level } = resolveCausalMeta(row.id);

    // Lifecycle state derivation
    let lifecycle: NodeLifecycle = "idle";
    const lastKind = lastMsgKindMap.get(row.id);
    if (row.from_chat_id === null) {
      lifecycle = "root";
    } else if (lastKind === "interrupted") {
      lifecycle = "interrupted";
    } else if (lastKind === "progress") {
      lifecycle = "running";
    } else if ((messageCounts.get(row.id) ?? 0) > 0) {
      lifecycle = "completed";
    }

    const isRoot = row.from_chat_id === null;
    const hasUpstream = !isRoot && chatIds.has(row.from_chat_id!);

    addNode({
      id: `chat:${row.id}`,
      kind: "chat",
      label: title.length > 0 ? title : `Chat #${row.id}`,
      sub: null,
      weight: messageCounts.get(row.id) ?? 0,
      chatId: row.id,
      isRoot,
      hasUpstreamContext: hasUpstream,
      upstreamChatId: row.from_chat_id,
      contextInjectionStatus: isRoot ? "root" : (hasUpstream ? "injected" : "none"),
      participants: participants.length,
      createdAt: createdAtMs,
      updatedAt: lastActiveMs,
      clusterId: `cluster:${rootId}`,
      level,
      lifecycle,
    });

    for (const employeeId of participants) {
      if (!employeeIds.has(employeeId)) continue;
      addEdge(`chat:${row.id}`, `employee:${employeeId}`, "participant", 1);
    }
    if (row.from_chat_id !== null && chatIds.has(row.from_chat_id)) {
      addEdge(`chat:${row.from_chat_id}`, `chat:${row.id}`, "spawned", 2);
      addEdge(`chat:${row.id}`, `chat:${row.from_chat_id}`, "depends_on", 2);
    }
  }

  // --- Employees & Capability Tools ---
  for (const row of employeeRows) {
    const name = row.name.trim();
    addNode({
      id: `employee:${row.id}`,
      kind: "employee",
      label: name.length > 0 ? name : `Employee #${row.id}`,
      sub: row.role.trim().length > 0 ? row.role.trim() : null,
      weight: 0,
      employeeId: row.id,
      avatar: row.avatar,
      disabled: row.disabled === 1,
      level: 0,
      lifecycle: row.disabled === 1 ? "idle" : "running",
    });

    // Employee linked skills / MCP tools
    const mcpServers = parseStringArray(row.mcp);
    const skills = parseStringArray(row.skills);
    for (const mcp of mcpServers) {
      const clean = mcp.trim();
      if (!clean) continue;
      const toolId = `tool:mcp_${clean}`;
      addNode({
        id: toolId,
        kind: "tool",
        label: clean,
        sub: "MCP Server",
        weight: 1,
        toolName: clean,
        toolCategory: "mcp",
        level: 1,
        lifecycle: "idle",
      });
      addEdge(`employee:${row.id}`, toolId, "invokes", 1);
    }
    for (const skill of skills) {
      const clean = skill.trim();
      if (!clean) continue;
      const toolId = `tool:skill_${clean}`;
      addNode({
        id: toolId,
        kind: "tool",
        label: clean,
        sub: "Skill Capability",
        weight: 1,
        toolName: clean,
        toolCategory: "general",
        level: 1,
        lifecycle: "idle",
      });
      addEdge(`employee:${row.id}`, toolId, "invokes", 1);
    }
  }

  // --- Sessions (chat → employee) ---
  for (const row of sessionRows) {
    if (!chatIds.has(row.chat_id) || !employeeIds.has(row.employee_id))
      continue;
    addEdge(`chat:${row.chat_id}`, `employee:${row.employee_id}`, "session", 2);
  }

  // --- Message-derived Semantics: Artifacts, Tool Calls, and Causal Links ---
  const messageRows = db
    .prepare(
      "SELECT id, chat_id, sender_employee_id, kind, content, steps, attachments, created_at " +
        "FROM messages " +
        "WHERE steps IS NOT NULL OR attachments IS NOT NULL OR kind IN ('progress', 'interrupted', 'image', 'ask')",
    )
    .all() as MessageRow[];

  for (const row of messageRows) {
    if (!chatIds.has(row.chat_id)) continue;
    const sourceChat = `chat:${row.chat_id}`;
    const chatMeta = nodeMap.get(sourceChat);
    const clusterId = chatMeta?.clusterId;
    const level = (chatMeta?.level ?? 0) + 1;
    const createdAtMs =
      row.created_at > 1e11 ? row.created_at : row.created_at * 1000;

    // 1. Causal task-group progression
    if (row.kind === "progress" || row.kind === "interrupted") {
      const target = parseLinkedChatId(row.steps);
      if (target !== null && chatIds.has(target)) {
        addEdge(sourceChat, `chat:${target}`, "progress", 3);
      }
      // Orchestration tool node
      const orchToolId = "tool:imb_progress";
      addNode({
        id: orchToolId,
        kind: "tool",
        label: "imb_progress",
        sub: "Task Orchestrator",
        weight: 1,
        toolName: "imb_progress",
        toolCategory: "orchestration",
        clusterId,
        level: 1,
        lifecycle: "completed",
      });
      addEdge(sourceChat, orchToolId, "invokes", 1);
    }

    // 2. Spawn dispatcher tool
    const chatNode = nodeMap.get(sourceChat);
    if (chatNode?.isRoot === false) {
      const spawnToolId = "tool:imb_create_chat";
      addNode({
        id: spawnToolId,
        kind: "tool",
        label: "imb_create_chat",
        sub: "Subtask Dispatcher",
        weight: 1,
        toolName: "imb_create_chat",
        toolCategory: "orchestration",
        level: 1,
        lifecycle: "completed",
      });
      addEdge(sourceChat, spawnToolId, "invokes", 1);
    }

    // 3. Image Generation Artifact & Tool
    if (row.kind === "image") {
      const imgToolId = "tool:imb_generate_image";
      addNode({
        id: imgToolId,
        kind: "tool",
        label: "imb_generate_image",
        sub: "Visual Synthesis",
        weight: 1,
        toolName: "imb_generate_image",
        toolCategory: "media",
        clusterId,
        level: 1,
        lifecycle: "completed",
      });
      addEdge(sourceChat, imgToolId, "invokes", 2);

      const artId = `artifact:img_${row.id}`;
      const promptSnippet = row.content.trim().slice(0, 32);
      const imgProducerName =
        row.sender_employee_id !== null
          ? employeeNameMap.get(row.sender_employee_id)
          : undefined;
      addNode({
        id: artId,
        kind: "artifact",
        label: promptSnippet.length > 0 ? `Image: ${promptSnippet}…` : `Image #${row.id}`,
        sub: "Generated Visual",
        weight: 2,
        artifactType: "image/png",
        sourceChatId: row.chat_id,
        producedByEmployeeId: row.sender_employee_id ?? undefined,
        producedByEmployeeName: imgProducerName,
        createdAt: createdAtMs,
        clusterId,
        level,
        lifecycle: "completed",
      });

      addEdge(imgToolId, artId, "produces", 2);
      addEdge(sourceChat, artId, "produces", 2);
      if (
        row.sender_employee_id !== null &&
        employeeIds.has(row.sender_employee_id)
      ) {
        addEdge(`employee:${row.sender_employee_id}`, artId, "produces", 2);
      }
    }

    // 4. File and Code Artifacts from attachments
    const attachedChats = parseAttachedChatIds(row.attachments);
    for (const target of attachedChats) {
      if (chatIds.has(target)) addEdge(sourceChat, `chat:${target}`, "attached", 1);
    }

    const files = parseAttachedFiles(row.attachments);
    for (const file of files) {
      const ext = extractFileExtension(file.name);
      const isCode = CODE_EXTENSIONS.has(ext);
      const fileKey = file.path
        ? file.path
        : `${row.chat_id}:${file.name}`;
      const artId = `artifact:${fileKey}`;
      const sizeStr = file.size ? formatBytes(file.size) : "";
      const subLabel = [ext.toUpperCase().replace(".", ""), sizeStr]
        .filter(Boolean)
        .join(" · ") || "File Artifact";

      const fileProducerName =
        row.sender_employee_id !== null
          ? employeeNameMap.get(row.sender_employee_id)
          : undefined;
      addNode({
        id: artId,
        kind: "artifact",
        label: file.name,
        sub: subLabel,
        weight: Math.max(1, Math.round((file.size ?? 1024) / 2048)),
        artifactPath: file.path,
        artifactType: ext || file.type,
        artifactSize: file.size,
        sourceChatId: row.chat_id,
        producedByEmployeeId: row.sender_employee_id ?? undefined,
        producedByEmployeeName: fileProducerName,
        createdAt: createdAtMs,
        clusterId,
        level,
        lifecycle: "completed",
      });

      const edgeKind: GraphEdgeKind =
        row.sender_employee_id !== null ? "produces" : "references";
      addEdge(sourceChat, artId, edgeKind, 2);

      if (
        row.sender_employee_id !== null &&
        employeeIds.has(row.sender_employee_id)
      ) {
        addEdge(`employee:${row.sender_employee_id}`, artId, "produces", 2);
      }

      if (isCode) {
        const codeToolId = "tool:code_authoring";
        addNode({
          id: codeToolId,
          kind: "tool",
          label: "Code & File Authoring",
          sub: "Tool Pipeline",
          weight: 2,
          toolName: "write",
          toolCategory: "code",
          clusterId,
          level: 1,
          lifecycle: "completed",
        });
        addEdge(codeToolId, artId, "produces", 1);
        addEdge(sourceChat, codeToolId, "invokes", 1);
      }
    }
  }

  // --- Tags ---
  for (const tag of listTags()) {
    addNode({
      id: `tag:${tag}`,
      kind: "tag",
      label: tag,
      sub: null,
      weight: 0,
      tag,
      level: 0,
      lifecycle: "idle",
    });
  }
  for (const row of tagRows) {
    if (!chatIds.has(row.chat_id)) continue;
    addEdge(`chat:${row.chat_id}`, `tag:${row.tag}`, "tag", 1);
  }

  // Calculate upstream artifacts count per chat along causal in-edges
  const chatProducedArtifacts = new Map<number, number>();
  for (const node of nodes) {
    if (node.kind === "artifact" && node.sourceChatId !== undefined) {
      chatProducedArtifacts.set(
        node.sourceChatId,
        (chatProducedArtifacts.get(node.sourceChatId) ?? 0) + 1,
      );
    }
  }

  for (const node of nodes) {
    if (node.kind === "chat" && node.chatId !== undefined) {
      let count = 0;
      let curr = chatParentMap.get(node.chatId);
      const visited = new Set<number>();
      while (curr !== null && curr !== undefined) {
        if (visited.has(curr)) break;
        visited.add(curr);
        count += chatProducedArtifacts.get(curr) ?? 0;
        curr = chatParentMap.get(curr);
      }
      node.upstreamArtifactsCount = count;
    }
  }

  // Calculate degrees (inDegree, outDegree, total degree)
  const inDegreeMap = new Map<string, number>();
  const outDegreeMap = new Map<string, number>();
  const totalDegreeMap = new Map<string, number>();

  for (const edge of edges) {
    outDegreeMap.set(edge.source, (outDegreeMap.get(edge.source) ?? 0) + 1);
    inDegreeMap.set(edge.target, (inDegreeMap.get(edge.target) ?? 0) + 1);
    totalDegreeMap.set(edge.source, (totalDegreeMap.get(edge.source) ?? 0) + 1);
    totalDegreeMap.set(edge.target, (totalDegreeMap.get(edge.target) ?? 0) + 1);
  }

  for (const node of nodes) {
    node.inDegree = inDegreeMap.get(node.id) ?? 0;
    node.outDegree = outDegreeMap.get(node.id) ?? 0;
    node.degree = totalDegreeMap.get(node.id) ?? 0;
    if (node.kind !== "chat" && node.weight === 0) {
      node.weight = node.degree;
    }
  }

  const now = Date.now();
  if (minTime === Infinity) minTime = now - 86400000;
  if (maxTime === -Infinity) maxTime = now;

  return {
    nodes,
    edges,
    generatedAt: now,
    minTime,
    maxTime,
  };
}

/** Read the linked task-group id stored alongside a step list. */
function parseLinkedChatId(raw: string | null): number | null {
  if (!raw) return null;
  const id = parseJsonObject(raw)["chatId"];
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? id
    : null;
}

/** Read every `chat`-kind attachment's chat id from a stored attachments blob. */
function parseAttachedChatIds(raw: string | null): number[] {
  if (!raw) return [];
  const list = parseJsonObject(raw)["attachments"];
  if (!Array.isArray(list)) return [];
  const ids: number[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (record["kind"] !== "chat") continue;
    const chatId = record["chatId"];
    if (
      typeof chatId === "number" &&
      Number.isSafeInteger(chatId) &&
      chatId > 0
    ) {
      ids.push(chatId);
    }
  }
  return ids;
}

interface ParsedFileInfo {
  name: string;
  path?: string;
  type?: string;
  size?: number;
}

/** Read every non-chat file attachment from stored attachments blob. */
function parseAttachedFiles(raw: string | null): ParsedFileInfo[] {
  if (!raw) return [];
  const list = parseJsonObject(raw)["attachments"];
  if (!Array.isArray(list)) return [];
  const files: ParsedFileInfo[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (rec["kind"] === "chat") continue;
    const name = typeof rec["name"] === "string" ? rec["name"].trim() : "";
    if (!name) continue;
    const path = typeof rec["path"] === "string" ? rec["path"] : undefined;
    const type = typeof rec["type"] === "string" ? rec["type"] : undefined;
    const size = typeof rec["size"] === "number" ? rec["size"] : undefined;
    files.push({ name, path, type, size });
  }
  return files;
}
