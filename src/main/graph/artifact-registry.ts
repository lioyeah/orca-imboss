/**
 * Artifact & Dependency Registry (Graph-as-Infrastructure)
 *
 * Tracks code files, documents, visual media, and tool deliverables across
 * the multi-agent task DAG. Mounts artifacts explicitly on nodes and edges,
 * enabling downstream nodes to directly discover, reference, and consume
 * upstream deliverables.
 */

import type { UpstreamArtifact } from "@shared/types";
import { getDB } from "../db";
import { getEmployee } from "../db/employees";
import { parseJsonObject } from "../db/json";

export interface RegisteredArtifact extends UpstreamArtifact {
  createdAt: number;
  consumedByChatIds: number[];
  referencedByEmployeeIds: number[];
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

/**
 * List all registered artifacts in the workspace or filtered by chat/cluster.
 */
export function listArtifacts(options?: {
  chatId?: number;
  clusterChatId?: number;
}): RegisteredArtifact[] {
  const db = getDB();
  const rows = db
    .prepare(
      `SELECT id, chat_id, sender_employee_id, kind, content, steps, attachments, created_at ` +
        `FROM messages ` +
        `WHERE attachments IS NOT NULL OR kind = 'image' ` +
        `ORDER BY id ASC`,
    )
    .all() as Array<{
    id: number;
    chat_id: number;
    sender_employee_id: number | null;
    kind: string;
    content: string;
    steps: string | null;
    attachments: string | null;
    created_at: number;
  }>;

  const artifactMap = new Map<string, RegisteredArtifact>();

  for (const row of rows) {
    const createdAtMs =
      row.created_at > 1e11 ? row.created_at : row.created_at * 1000;
    const senderEmp =
      row.sender_employee_id !== null
        ? getEmployee(row.sender_employee_id)
        : null;

    if (row.kind === "image") {
      const artId = `artifact:img_${row.id}`;
      if (!artifactMap.has(artId)) {
        artifactMap.set(artId, {
          id: artId,
          name: `image_${row.id}.png`,
          type: "image/png",
          sourceChatId: row.chat_id,
          producedByEmployeeId: row.sender_employee_id ?? undefined,
          producedByEmployeeName: senderEmp?.name ?? undefined,
          description: row.content.trim().slice(0, 100) || "Generated Visual",
          createdAt: createdAtMs,
          consumedByChatIds: [],
          referencedByEmployeeIds: [],
        });
      }
    }

    const files = parseAttachedFiles(row.attachments);
    for (const file of files) {
      const artId = file.path
        ? `artifact:${file.path}`
        : `artifact:${row.chat_id}:${file.name}`;

      const existing = artifactMap.get(artId);
      if (!existing) {
        artifactMap.set(artId, {
          id: artId,
          name: file.name,
          path: file.path,
          type: file.type,
          size: file.size,
          sourceChatId: row.chat_id,
          producedByEmployeeId: row.sender_employee_id ?? undefined,
          producedByEmployeeName: senderEmp?.name ?? undefined,
          description: `Deliverable artifact (${file.name})`,
          createdAt: createdAtMs,
          consumedByChatIds: [],
          referencedByEmployeeIds: [],
        });
      } else {
        // Track references if another chat/sender references it
        if (row.chat_id !== existing.sourceChatId && !existing.consumedByChatIds.includes(row.chat_id)) {
          existing.consumedByChatIds.push(row.chat_id);
        }
        if (
          row.sender_employee_id !== null &&
          row.sender_employee_id !== existing.producedByEmployeeId &&
          !existing.referencedByEmployeeIds.includes(row.sender_employee_id)
        ) {
          existing.referencedByEmployeeIds.push(row.sender_employee_id);
        }
      }
    }
  }

  const all = Array.from(artifactMap.values());
  if (options?.chatId !== undefined) {
    return all.filter(
      (art) =>
        art.sourceChatId === options.chatId ||
        art.consumedByChatIds.includes(options.chatId!),
    );
  }
  return all;
}
