/**
 * Build the workspace graph from the tables that already exist. Nothing is
 * persisted — the payload is derived on demand and handed to the renderer.
 *
 * Node kinds: chats (root and task groups), employees and tags. Chat→chat
 * edges come from four independent channels the app already records:
 *   - `from_chat_id`      → spawned  (a task group branched off its parent)
 *   - `attachments`       → attached (a chat card dropped into the conversation)
 *   - `steps.chatId`      → progress (a notice reporting on a task group)
 * Chat→employee edges are `participant` (chat members) and `session` (an
 * employee with an agent session in that conversation). Chat→tag edges are
 * `tag`.
 */

import type {
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphPayload,
} from "@shared/types";
import { getDB } from "./index";
import { parseJsonObject, parseNumberArray } from "./json";
import { listTags } from "./tags";

interface ChatRow {
  id: number;
  title: string;
  participants: string;
  from_chat_id: number | null;
}

interface EmployeeRow {
  id: number;
  name: string;
  role: string;
  disabled: number;
}

interface MessageLinkRow {
  chat_id: number;
  kind: string;
  steps: string | null;
  attachments: string | null;
}

export function buildGraph(): GraphPayload {
  const db = getDB();
  const chatRows = db
    .prepare("SELECT id, title, participants, from_chat_id FROM chats")
    .all() as ChatRow[];
  const employeeRows = db
    .prepare("SELECT id, name, role, disabled FROM employees")
    .all() as EmployeeRow[];
  const sessionRows = db
    .prepare("SELECT chat_id, employee_id FROM sessions")
    .all() as Array<{ chat_id: number; employee_id: number }>;
  const tagRows = db
    .prepare("SELECT chat_id, tag FROM chat_tags")
    .all() as Array<{ chat_id: number; tag: string }>;
  const countRows = db
    .prepare("SELECT chat_id, COUNT(*) AS n FROM messages GROUP BY chat_id")
    .all() as Array<{ chat_id: number; n: number }>;

  const messageCounts = new Map<number, number>();
  for (const row of countRows) messageCounts.set(row.chat_id, row.n);

  const chatIds = new Set<number>();
  for (const row of chatRows) chatIds.add(row.id);
  const employeeIds = new Set<number>();
  for (const row of employeeRows) employeeIds.add(row.id);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();

  const addEdge = (
    source: string,
    target: string,
    kind: GraphEdgeKind,
  ): void => {
    if (source === target) return;
    const id = `${kind}|${source}|${target}`;
    if (seenEdges.has(id)) return;
    seenEdges.add(id);
    edges.push({ id, source, target, kind });
  };

  // --- Chats: nodes, participant edges and spawn edges ---
  for (const row of chatRows) {
    const participants = parseNumberArray(row.participants);
    const title = row.title.trim();
    nodes.push({
      id: `chat:${row.id}`,
      kind: "chat",
      label: title.length > 0 ? title : `Chat #${row.id}`,
      sub: null,
      weight: messageCounts.get(row.id) ?? 0,
      chatId: row.id,
      isRoot: row.from_chat_id === null,
      participants: participants.length,
    });
    for (const employeeId of participants) {
      if (!employeeIds.has(employeeId)) continue;
      addEdge(`chat:${row.id}`, `employee:${employeeId}`, "participant");
    }
    if (row.from_chat_id !== null && chatIds.has(row.from_chat_id)) {
      addEdge(`chat:${row.from_chat_id}`, `chat:${row.id}`, "spawned");
    }
  }

  // --- Employees ---
  for (const row of employeeRows) {
    const name = row.name.trim();
    nodes.push({
      id: `employee:${row.id}`,
      kind: "employee",
      label: name.length > 0 ? name : `Employee #${row.id}`,
      sub: row.role.trim().length > 0 ? row.role.trim() : null,
      weight: 0,
      employeeId: row.id,
    });
  }

  // --- Sessions (chat → employee) ---
  for (const row of sessionRows) {
    if (!chatIds.has(row.chat_id) || !employeeIds.has(row.employee_id))
      continue;
    addEdge(`chat:${row.chat_id}`, `employee:${row.employee_id}`, "session");
  }

  // --- Message-derived chat → chat links ---
  const messageLinks = db
    .prepare(
      "SELECT chat_id, kind, steps, attachments FROM messages " +
        "WHERE steps IS NOT NULL OR attachments IS NOT NULL",
    )
    .all() as MessageLinkRow[];
  for (const row of messageLinks) {
    if (!chatIds.has(row.chat_id)) continue;
    const source = `chat:${row.chat_id}`;
    if (row.kind === "progress" || row.kind === "interrupted") {
      const target = parseLinkedChatId(row.steps);
      if (target !== null && chatIds.has(target)) {
        addEdge(source, `chat:${target}`, "progress");
      }
    }
    for (const target of parseAttachedChatIds(row.attachments)) {
      if (chatIds.has(target)) addEdge(source, `chat:${target}`, "attached");
    }
  }

  // --- Tags ---
  for (const tag of listTags()) {
    nodes.push({
      id: `tag:${tag}`,
      kind: "tag",
      label: tag,
      sub: null,
      weight: 0,
      tag,
    });
  }
  for (const row of tagRows) {
    if (!chatIds.has(row.chat_id)) continue;
    addEdge(`chat:${row.chat_id}`, `tag:${row.tag}`, "tag");
  }

  // Employees and tags are sized by how connected they are; chats keep their
  // message count as the weight.
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  for (const node of nodes) {
    if (node.kind !== "chat") node.weight = degree.get(node.id) ?? 0;
  }

  return { nodes, edges, generatedAt: Date.now() };
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
