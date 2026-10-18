/**
 * Collaborator Topology & Agent Routing (Graph-as-Infrastructure)
 *
 * Models the dynamic multi-agent collaboration network, interaction
 * frequency, and capability matching. Provides routing recommendations
 * for task distribution across domain specialists.
 */

import { getDB } from "../db";
import { listEmployees } from "../db/employees";
import { parseNumberArray, parseStringArray } from "../db/json";

export interface EmployeeSynergy {
  employeeId: number;
  name: string;
  role: string;
  skills: string[];
  mcp: string[];
  disabled: boolean;
  /** Number of shared task groups or conversations with target. */
  sharedChatsCount: number;
  /** Total messages contributed across the workspace. */
  totalMessagesCount: number;
  /** Number of artifacts produced by this employee. */
  artifactsProducedCount: number;
  /** Domain specialty affinity tags (e.g. 'code', 'database', 'design', 'review'). */
  specialties: string[];
}

export interface CollaboratorTopologySummary {
  callingEmployeeId: number;
  collaborators: EmployeeSynergy[];
  recommendedReroutes: Array<{
    employeeId: number;
    name: string;
    role: string;
    matchReason: string;
  }>;
}

export function queryCollaboratorTopology(
  callingEmployeeId: number,
  taskHint?: string,
): CollaboratorTopologySummary {
  const db = getDB();
  const allEmployees = listEmployees();

  // 1. Compute shared chats
  const chatRows = db
    .prepare("SELECT participants FROM chats")
    .all() as Array<{ participants: string }>;

  const sharedChatCounts = new Map<number, number>();
  for (const row of chatRows) {
    const pids = parseNumberArray(row.participants);
    if (pids.includes(callingEmployeeId)) {
      for (const pid of pids) {
        if (pid !== callingEmployeeId) {
          sharedChatCounts.set(pid, (sharedChatCounts.get(pid) ?? 0) + 1);
        }
      }
    }
  }

  // 2. Count messages and artifacts per employee
  const msgCounts = new Map<number, number>();
  const msgRows = db
    .prepare(
      "SELECT sender_employee_id, count(*) as count FROM messages WHERE sender_employee_id IS NOT NULL GROUP BY sender_employee_id",
    )
    .all() as Array<{ sender_employee_id: number; count: number }>;
  for (const r of msgRows) {
    msgCounts.set(r.sender_employee_id, r.count);
  }

  const artCounts = new Map<number, number>();
  const artRows = db
    .prepare(
      "SELECT sender_employee_id, count(*) as count FROM messages WHERE sender_employee_id IS NOT NULL AND (attachments IS NOT NULL OR kind = 'image') GROUP BY sender_employee_id",
    )
    .all() as Array<{ sender_employee_id: number; count: number }>;
  for (const r of artRows) {
    artCounts.set(r.sender_employee_id, r.count);
  }

  // 3. Assemble synergy profiles
  const collaborators: EmployeeSynergy[] = [];
  const normalizedHint = (taskHint ?? "").toLowerCase();

  for (const emp of allEmployees) {
    if (emp.id === callingEmployeeId) continue;
    const skills = parseStringArray(emp.skills as unknown as string);
    const mcp = parseStringArray(emp.mcp as unknown as string);

    const specialties: string[] = [];
    const roleLower = emp.role.toLowerCase();
    const skillsLower = skills.map((s) => s.toLowerCase());

    if (roleLower.includes("architect") || roleLower.includes("lead")) specialties.push("architecture");
    if (roleLower.includes("code") || roleLower.includes("engineer") || roleLower.includes("dev") || skillsLower.some((s) => s.includes("code"))) specialties.push("development");
    if (roleLower.includes("db") || roleLower.includes("data") || roleLower.includes("sql")) specialties.push("database");
    if (roleLower.includes("design") || roleLower.includes("ui") || roleLower.includes("frontend")) specialties.push("ui/ux");
    if (roleLower.includes("test") || roleLower.includes("qa") || roleLower.includes("review")) specialties.push("qa/review");
    if (roleLower.includes("copy") || roleLower.includes("write") || roleLower.includes("doc")) specialties.push("documentation");

    collaborators.push({
      employeeId: emp.id,
      name: emp.name,
      role: emp.role,
      skills,
      mcp,
      disabled: emp.disabled,
      sharedChatsCount: sharedChatCounts.get(emp.id) ?? 0,
      totalMessagesCount: msgCounts.get(emp.id) ?? 0,
      artifactsProducedCount: artCounts.get(emp.id) ?? 0,
      specialties,
    });
  }

  // Sort by synergy (shared chats desc, then active messages desc)
  collaborators.sort((a, b) => {
    if (b.sharedChatsCount !== a.sharedChatsCount) {
      return b.sharedChatsCount - a.sharedChatsCount;
    }
    return b.totalMessagesCount - a.totalMessagesCount;
  });

  // 4. Recommend reroutes if task hint was provided
  const recommendedReroutes: CollaboratorTopologySummary["recommendedReroutes"] = [];
  if (normalizedHint) {
    for (const collab of collaborators) {
      if (collab.disabled) continue;
      let matched = false;
      let reason = "";

      for (const spec of collab.specialties) {
        if (normalizedHint.includes(spec)) {
          matched = true;
          reason = `Specialist in ${spec} (Role: ${collab.role})`;
          break;
        }
      }

      if (!matched) {
        for (const skill of collab.skills) {
          if (normalizedHint.includes(skill.toLowerCase())) {
            matched = true;
            reason = `Equipped with skill "${skill}"`;
            break;
          }
        }
      }

      if (matched) {
        recommendedReroutes.push({
          employeeId: collab.employeeId,
          name: collab.name,
          role: collab.role,
          matchReason: reason,
        });
      }
    }
  }

  return {
    callingEmployeeId,
    collaborators,
    recommendedReroutes: recommendedReroutes.slice(0, 5),
  };
}
