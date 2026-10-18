/**
 * DAG Causal Context Injection Engine (Graph-as-Infrastructure)
 *
 * Traverses in-edges of the causal DAG (parent chats, upstream task groups,
 * and sibling dependencies) to extract structured deliverables, ancestor
 * objectives, and milestones. Formats a concise, token-efficient
 * `<upstream_causal_context>` XML block injected directly into agent sessions.
 */

import type {
  UpstreamArtifact,
  UpstreamCausalContext,
  UpstreamMilestone,
} from "@shared/types";
import { getDB } from "../db";
import { getChat } from "../db/chats";
import { getEmployee } from "../db/employees";
import { parseJsonObject } from "../db/json";

interface RawMessageRow {
  id: number;
  chat_id: number;
  sender_employee_id: number | null;
  kind: string;
  content: string;
  steps: string | null;
  attachments: string | null;
  created_at: number;
}

interface ParsedFileInfo {
  name: string;
  path?: string;
  type?: string;
  size?: number;
}

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

function formatBytes(bytes: number): string {
  if (bytes <= 0 || !Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncateText(text: string, maxLen = 220): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1)}…`;
}

/**
 * Extract the upstream causal context for a chat by following in-edges along
 * the causal task DAG.
 */
export function buildUpstreamCausalContext(
  chatId: number,
  _employeeId?: number,
): UpstreamCausalContext {
  const chat = getChat(chatId);
  if (!chat) {
    return {
      chatId,
      isRoot: true,
      ancestorChain: [],
      artifacts: [],
      milestones: [],
      collaboratorIds: [],
      xml: "",
    };
  }

  const isRoot = chat.fromChatId === null;
  const db = getDB();

  // 1. Follow in-edges (from_chat_id) up to the root chat
  const ancestorIds: number[] = [];
  const visited = new Set<number>([chatId]);
  let currId = chat.fromChatId;

  while (currId !== null) {
    if (visited.has(currId)) break;
    visited.add(currId);
    ancestorIds.push(currId);
    const parentChat = getChat(currId);
    if (!parentChat || parentChat.fromChatId === null) break;
    currId = parentChat.fromChatId;
  }

  // Reverse so ancestor chain is root -> parent
  ancestorIds.reverse();

  const ancestorChain: UpstreamCausalContext["ancestorChain"] = [];
  for (let idx = 0; idx < ancestorIds.length; idx++) {
    const aId = ancestorIds[idx];
    const aChat = getChat(aId);
    if (aChat) {
      ancestorChain.push({
        chatId: aId,
        title: aChat.title.trim() || `Chat #${aId}`,
        level: idx,
        isRoot: aChat.fromChatId === null,
      });
    }
  }

  if (isRoot && ancestorChain.length === 0) {
    const rootXml = [
      '<upstream_causal_context role="root">',
      "  <causal_position>Root workspace conversation. You originate task assignments and decompose subtasks.</causal_position>",
      "</upstream_causal_context>",
    ].join("\n");
    return {
      chatId,
      isRoot: true,
      ancestorChain: [],
      artifacts: [],
      milestones: [],
      collaboratorIds: chat.participants,
      xml: rootXml,
    };
  }

  // 2. Discover parent objective from the immediate parent chat or spawning message
  const immediateParentId = chat.fromChatId;
  let parentObjective: string | undefined;

  if (immediateParentId !== null) {
    // Look for the message in parent chat that mentions this child chat or the prompt that framed it
    const spawnMsg = db
      .prepare(
        "SELECT content FROM messages WHERE chat_id = ? AND (kind = 'chat' AND content = ?) LIMIT 1",
      )
      .get(immediateParentId, String(chatId)) as { content: string } | undefined;

    if (spawnMsg) {
      // Find the prompt message right before the spawn card in the parent chat
      const precedingMsg = db
        .prepare(
          "SELECT content FROM messages WHERE chat_id = ? AND id < (SELECT id FROM messages WHERE chat_id = ? AND kind = 'chat' AND content = ? ORDER BY id DESC LIMIT 1) ORDER BY id DESC LIMIT 1",
        )
        .get(immediateParentId, immediateParentId, String(chatId)) as
        | { content: string }
        | undefined;
      if (precedingMsg && precedingMsg.content.trim()) {
        parentObjective = truncateText(precedingMsg.content);
      }
    }

    if (!parentObjective) {
      // Fallback: earliest user/assistant message in parent chat
      const firstParentMsg = db
        .prepare(
          "SELECT content FROM messages WHERE chat_id = ? AND kind IN ('text', 'report') ORDER BY id ASC LIMIT 1",
        )
        .get(immediateParentId) as { content: string } | undefined;
      if (firstParentMsg && firstParentMsg.content.trim()) {
        parentObjective = truncateText(firstParentMsg.content);
      }
    }
  }

  // 3. Collect upstream deliverables (Artifacts) and milestones from ancestors and sibling chats
  const relevantChatIds = new Set<number>(ancestorIds);

  // If immediate parent exists, include sibling chats that completed or reported
  if (immediateParentId !== null) {
    const siblingRows = db
      .prepare(
        "SELECT id FROM chats WHERE from_chat_id = ? AND id != ?",
      )
      .all(immediateParentId, chatId) as Array<{ id: number }>;
    for (const sib of siblingRows) {
      relevantChatIds.add(sib.id);
    }
  }

  const artifacts: UpstreamArtifact[] = [];
  const milestones: UpstreamMilestone[] = [];
  const collaboratorIds = new Set<number>();

  if (relevantChatIds.size > 0) {
    const placeholders = Array.from(relevantChatIds).map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT id, chat_id, sender_employee_id, kind, content, steps, attachments, created_at ` +
          `FROM messages WHERE chat_id IN (${placeholders}) ` +
          `AND (attachments IS NOT NULL OR kind IN ('progress', 'interrupted', 'image', 'report')) ` +
          `ORDER BY id ASC`,
      )
      .all(...Array.from(relevantChatIds)) as RawMessageRow[];

    for (const row of rows) {
      const senderEmp =
        row.sender_employee_id !== null
          ? getEmployee(row.sender_employee_id)
          : null;
      if (row.sender_employee_id !== null) {
        collaboratorIds.add(row.sender_employee_id);
      }

      // Collect milestones
      if (row.kind === "progress" || row.kind === "report" || row.kind === "interrupted") {
        const summary = truncateText(row.content);
        if (summary) {
          milestones.push({
            chatId: row.chat_id,
            employeeId: row.sender_employee_id ?? undefined,
            employeeName: senderEmp?.name ?? undefined,
            kind: row.kind,
            summary,
            timestamp: row.created_at > 1e11 ? row.created_at : row.created_at * 1000,
          });
        }
      }

      // Collect generated images as artifacts
      if (row.kind === "image") {
        const promptSnippet = truncateText(row.content, 64);
        artifacts.push({
          id: `artifact:img_${row.id}`,
          name: `image_${row.id}.png`,
          type: "image/png",
          sourceChatId: row.chat_id,
          producedByEmployeeId: row.sender_employee_id ?? undefined,
          producedByEmployeeName: senderEmp?.name ?? undefined,
          description: promptSnippet || "Generated Visual Artifact",
        });
      }

      // Collect file attachments as artifacts
      const attachedFiles = parseAttachedFiles(row.attachments);
      for (const file of attachedFiles) {
        const artId = file.path
          ? `artifact:${file.path}`
          : `artifact:${row.chat_id}:${file.name}`;
        artifacts.push({
          id: artId,
          name: file.name,
          path: file.path,
          type: file.type,
          size: file.size,
          sourceChatId: row.chat_id,
          producedByEmployeeId: row.sender_employee_id ?? undefined,
          producedByEmployeeName: senderEmp?.name ?? undefined,
          description: `Attached deliverable (${file.size ? formatBytes(file.size) : "file"})`,
        });
      }
    }
  }

  // Deduplicate artifacts by path or id
  const seenArtifacts = new Set<string>();
  const dedupedArtifacts: UpstreamArtifact[] = [];
  for (const art of artifacts) {
    const key = art.path || art.id;
    if (!seenArtifacts.has(key)) {
      seenArtifacts.add(key);
      dedupedArtifacts.push(art);
    }
  }

  // 4. Format into clean, token-efficient XML block
  const lines: string[] = ['<upstream_causal_context>'];

  // Causal Chain
  lines.push("  <causal_chain>");
  for (const node of ancestorChain) {
    const roleAttr = node.isRoot ? ' role="root"' : ' role="ancestor"';
    lines.push(
      `    <node id="chat:${node.chatId}" level="${node.level}" title="${escapeXml(node.title)}"${roleAttr} />`,
    );
  }
  lines.push("  </causal_chain>");

  // Task Ancestry & Objective
  if (parentObjective) {
    lines.push("  <task_ancestry>");
    lines.push(`    <parent_objective>${escapeXml(parentObjective)}</parent_objective>`);
    lines.push("  </task_ancestry>");
  }

  // Upstream Deliverables (Artifacts)
  if (dedupedArtifacts.length > 0) {
    lines.push(`  <upstream_artifacts count="${dedupedArtifacts.length}">`);
    for (const art of dedupedArtifacts) {
      const pathAttr = art.path ? ` path="${escapeXml(art.path)}"` : "";
      const typeAttr = art.type ? ` type="${escapeXml(art.type)}"` : "";
      const sizeAttr = art.size ? ` size="${formatBytes(art.size)}"` : "";
      const prodAttr = art.producedByEmployeeName
        ? ` producer="${escapeXml(art.producedByEmployeeName)}"`
        : art.producedByEmployeeId !== undefined
          ? ` producer="Employee #${art.producedByEmployeeId}"`
          : "";
      lines.push(
        `    <artifact id="${escapeXml(art.id)}" name="${escapeXml(art.name)}"${pathAttr}${typeAttr}${sizeAttr}${prodAttr}>`,
      );
      if (art.description) {
        lines.push(`      ${escapeXml(art.description)}`);
      }
      lines.push("    </artifact>");
    }
    lines.push("  </upstream_artifacts>");
  }

  // Upstream Milestones & Reports
  if (milestones.length > 0) {
    lines.push("  <upstream_milestones>");
    // Take the most recent 6 milestones to avoid token bloat
    const recentMilestones = milestones.slice(-6);
    for (const ms of recentMilestones) {
      const fromAttr = ms.employeeName
        ? ` from="${escapeXml(ms.employeeName)}"`
        : ms.employeeId !== undefined
          ? ` from="Employee #${ms.employeeId}"`
          : "";
      lines.push(
        `    <milestone chat_id="${ms.chatId}" kind="${ms.kind}"${fromAttr}>${escapeXml(ms.summary)}</milestone>`,
      );
    }
    lines.push("  </upstream_milestones>");
  }

  // Collaborators
  if (collaboratorIds.size > 0) {
    lines.push("  <collaborators>");
    for (const cid of collaboratorIds) {
      const emp = getEmployee(cid);
      if (emp) {
        lines.push(
          `    <collaborator id="${emp.id}" name="${escapeXml(emp.name)}" role="${escapeXml(emp.role)}" />`,
        );
      }
    }
    lines.push("  </collaborators>");
  }

  lines.push("  <runtime_guidelines>");
  lines.push(
    "    - Directly consume upstream artifacts by path or dependency without asking redundant questions.",
  );
  lines.push(
    "    - Output your deliverables with file attachments or imb_send_message so downstream agents can consume them.",
  );
  lines.push("  </runtime_guidelines>");
  lines.push("</upstream_causal_context>");

  const xml = lines.join("\n");

  return {
    chatId,
    isRoot,
    ancestorChain,
    parentObjective,
    artifacts: dedupedArtifacts,
    milestones,
    collaboratorIds: Array.from(collaboratorIds),
    xml,
  };
}
