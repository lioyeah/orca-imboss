import type {
  MessageStep,
  StepStatus,
  TaskFlowEdge,
  TaskFlowNode,
  TaskFlowNodeStatus,
  TaskWorkflowGraph,
} from "@shared/types";
import { getDB } from "./index.ts";

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
  avatar: string | null;
  disabled: number;
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

function parseStepsFromBlob(stepsBlob: string | null): MessageStep[] {
  if (!stepsBlob) return [];
  try {
    const parsed = JSON.parse(stepsBlob);
    if (Array.isArray(parsed)) return parsed as MessageStep[];
    if (parsed && Array.isArray(parsed.steps)) return parsed.steps as MessageStep[];
  } catch {
    // ignore
  }
  return [];
}

function mapStepStatusToFlowStatus(status: StepStatus): TaskFlowNodeStatus {
  switch (status) {
    case "done":
      return "completed";
    case "busy":
      return "running";
    case "pending":
    default:
      return "pending";
  }
}

/**
 * Builds the Metro-Rail Branching Task Graph strictly from existing SQLite data.
 * Zero token cost, zero prompt injection.
 */
export function buildTaskWorkflowGraph(targetChatId?: number): TaskWorkflowGraph {
  const db = getDB();

  // 1. Employee lookup cache
  const employeeRows = db
    .prepare("SELECT id, name, role, avatar, disabled FROM employees")
    .all() as EmployeeRow[];
  const employeeMap = new Map<number, EmployeeRow>();
  for (const emp of employeeRows) {
    employeeMap.set(emp.id, emp);
  }

  // 2. Resolve Root Chat
  let rootChatId: number | null = null;
  if (targetChatId !== undefined && targetChatId > 0) {
    // Check if target is a child or root
    const targetChat = db
      .prepare("SELECT id, from_chat_id FROM chats WHERE id = ?")
      .get(targetChatId) as { id: number; from_chat_id: number | null } | undefined;
    if (targetChat) {
      if (targetChat.from_chat_id !== null) {
        // Walk up to find root
        let curr: number | null = targetChat.from_chat_id;
        while (curr !== null) {
          const parent = db
            .prepare("SELECT id, from_chat_id FROM chats WHERE id = ?")
            .get(curr) as { id: number; from_chat_id: number | null } | undefined;
          if (parent && parent.from_chat_id !== null) {
            curr = parent.from_chat_id;
          } else {
            rootChatId = curr;
            break;
          }
        }
      } else {
        rootChatId = targetChat.id;
      }
    }
  }

  // If no rootChatId resolved yet, pick the one with most child task chats, or latest
  if (rootChatId === null) {
    const mostSpawning = db
      .prepare(
        "SELECT from_chat_id, COUNT(*) as c FROM chats WHERE from_chat_id IS NOT NULL GROUP BY from_chat_id ORDER BY c DESC LIMIT 1",
      )
      .get() as { from_chat_id: number } | undefined;
    if (mostSpawning) {
      rootChatId = mostSpawning.from_chat_id;
    } else {
      const latestRoot = db
        .prepare(
          "SELECT id FROM chats WHERE from_chat_id IS NULL ORDER BY last_message_at DESC, id DESC LIMIT 1",
        )
        .get() as { id: number } | undefined;
      rootChatId = latestRoot ? latestRoot.id : null;
    }
  }

  if (rootChatId === null) {
    // Return empty graph
    return {
      nodes: [],
      edges: [],
      mode: "live",
      activeTaskId: null,
      chatId: null,
      chatTitle: null,
      generatedAt: Date.now(),
    };
  }

  const rootChat = db
    .prepare("SELECT * FROM chats WHERE id = ?")
    .get(rootChatId) as ChatRow | undefined;
  if (!rootChat) {
    return {
      nodes: [],
      edges: [],
      mode: "live",
      activeTaskId: null,
      chatId: null,
      chatTitle: null,
      generatedAt: Date.now(),
    };
  }

  const nodes: TaskFlowNode[] = [];
  const edges: TaskFlowEdge[] = [];
  let orderCounter = 0;

  // Add Root Node (Lane 0)
  const rootNodeId = `node_chat_${rootChat.id}`;
  nodes.push({
    id: rootNodeId,
    lane: 0,
    order: orderCounter++,
    type: "root",
    title: rootChat.title && rootChat.title.trim().length > 0 ? rootChat.title : `对话 #${rootChat.id}`,
    subtitle: "主任务与对话起点",
    status: "completed",
    chatId: rootChat.id,
    createdAt: rootChat.created_at > 1e11 ? rootChat.created_at : rootChat.created_at * 1000,
  });

  // Query direct messages in rootChat
  const rootMessages = db
    .prepare(
      "SELECT id, chat_id, sender_employee_id, kind, content, steps, attachments, created_at " +
        "FROM messages WHERE chat_id = ? ORDER BY id ASC",
    )
    .all(rootChat.id) as MessageRow[];

  let lastLane0NodeId = rootNodeId;

  // Query child task chats spawned from rootChat
  const childChats = db
    .prepare(
      "SELECT id, title, participants, from_chat_id, created_at, last_message_at " +
        "FROM chats WHERE from_chat_id = ? ORDER BY created_at ASC, id ASC",
    )
    .all(rootChat.id) as ChatRow[];

  // Also query any progress cards in root chat
  const progressMessages = rootMessages.filter(
    (m) => m.kind === "progress" || m.kind === "interrupted",
  );

  // If there are child task groups
  if (childChats.length > 0) {
    childChats.forEach((childChat, childIndex) => {
      const childLane = childIndex + 1; // Lane 1, Lane 2, ...
      let branchAnchorNodeId = lastLane0NodeId;

      // Check if there is an explicit progress step reported in root chat for this child
      const matchingProgress = progressMessages.find((m) => {
        if (!m.steps) return false;
        try {
          const parsed = JSON.parse(m.steps);
          return parsed.chatId === childChat.id;
        } catch {
          return false;
        }
      });

      const steps = matchingProgress ? parseStepsFromBlob(matchingProgress.steps) : [];

      // Query messages inside the child task chat
      const childMessages = db
        .prepare(
          "SELECT id, chat_id, sender_employee_id, kind, content, steps, attachments, created_at " +
            "FROM messages WHERE chat_id = ? ORDER BY id ASC",
        )
        .all(childChat.id) as MessageRow[];

      // Create branch head node for this task group
      const groupHeadId = `node_group_${childChat.id}`;
      const groupTitle =
        childChat.title && childChat.title.trim().length > 0
          ? childChat.title
          : `子任务群 #${childChat.id}`;

      // Check lifecycle of child chat
      let groupStatus: TaskFlowNodeStatus = "running";
      const lastChildMsg = childMessages[childMessages.length - 1];
      if (!lastChildMsg) {
        groupStatus = "pending";
      } else if (lastChildMsg.kind === "interrupted") {
        groupStatus = "interrupted";
      } else if (childMessages.some((m) => m.kind === "report")) {
        groupStatus = "completed";
      }

      nodes.push({
        id: groupHeadId,
        lane: childLane,
        order: orderCounter++,
        type: "employee_join",
        title: groupTitle,
        subtitle: `关联任务群 #${childChat.id}`,
        status: groupStatus,
        chatId: childChat.id,
        badge: childMessages.length > 0 ? childMessages.length : null,
      });

      // Branch curve from anchor on lane 0 to child lane
      edges.push({
        id: `edge_branch_${branchAnchorNodeId}_${groupHeadId}`,
        from: branchAnchorNodeId,
        to: groupHeadId,
        kind: "branch",
      });

      let prevChildNodeId = groupHeadId;

      // If we have explicit progress steps from imb_progress
      if (steps.length > 0) {
        steps.forEach((step, sIdx) => {
          const stepNodeId = `node_step_${childChat.id}_${sIdx}`;
          const emp = step.employeeId !== null ? employeeMap.get(step.employeeId) : undefined;
          const stepStatus = mapStepStatusToFlowStatus(step.status);

          // Find if there is an image attachment or thumbnail produced around this step
          let thumbnail: string | null = null;
          const imageMsg = childMessages.find((m) => m.kind === "image");
          if (imageMsg) {
            try {
              const atts = imageMsg.attachments ? JSON.parse(imageMsg.attachments) : [];
              if (Array.isArray(atts) && atts.length > 0 && atts[0].path) {
                thumbnail = atts[0].path;
              }
            } catch {
              // ignore
            }
          }

          nodes.push({
            id: stepNodeId,
            lane: childLane,
            order: orderCounter++,
            type: "task",
            title: step.name,
            subtitle: emp ? `${emp.name} · ${step.role}` : step.role,
            employeeId: step.employeeId,
            employeeName: emp?.name,
            employeeRole: step.role,
            employeeAvatar: emp?.avatar,
            status: stepStatus,
            thumbnail,
            chatId: childChat.id,
          });

          edges.push({
            id: `edge_seq_${prevChildNodeId}_${stepNodeId}`,
            from: prevChildNodeId,
            to: stepNodeId,
            kind: "sequence",
          });
          prevChildNodeId = stepNodeId;
        });
      } else {
        // Otherwise, extract key message actions from child chat
        const keyMessages = childMessages.filter(
          (m) => m.sender_employee_id !== null && m.content.trim().length > 0,
        );
        keyMessages.slice(0, 8).forEach((msg) => {
          const msgNodeId = `node_msg_${msg.id}`;
          const emp = msg.sender_employee_id !== null ? employeeMap.get(msg.sender_employee_id) : undefined;
          const title = msg.content.trim().slice(0, 36) || `执行回合 #${msg.id}`;

          let thumbnail: string | null = null;
          if (msg.kind === "image" && msg.attachments) {
            try {
              const atts = JSON.parse(msg.attachments);
              if (Array.isArray(atts) && atts[0]?.path) thumbnail = atts[0].path;
            } catch {
              // ignore
            }
          }

          nodes.push({
            id: msgNodeId,
            lane: childLane,
            order: orderCounter++,
            type: msg.kind === "report" ? "merge" : "task",
            title,
            subtitle: emp ? `${emp.name} · ${emp.role}` : null,
            employeeId: msg.sender_employee_id,
            employeeName: emp?.name,
            employeeRole: emp?.role,
            employeeAvatar: emp?.avatar,
            status: "completed",
            thumbnail,
            chatId: childChat.id,
            messageId: msg.id,
            outputSnippet: msg.content.slice(0, 120),
          });

          edges.push({
            id: `edge_seq_${prevChildNodeId}_${msgNodeId}`,
            from: prevChildNodeId,
            to: msgNodeId,
            kind: "sequence",
          });
          prevChildNodeId = msgNodeId;
        });
      }

      // If child finished, add merge back or completion node
      if (groupStatus === "completed") {
        const mergeNodeId = `node_done_${childChat.id}`;
        nodes.push({
          id: mergeNodeId,
          lane: childLane,
          order: orderCounter++,
          type: "merge",
          title: `完成交付: ${groupTitle}`,
          subtitle: "子任务执行完毕，结果汇报给老板",
          status: "completed",
          chatId: childChat.id,
        });
        edges.push({
          id: `edge_done_${prevChildNodeId}_${mergeNodeId}`,
          from: prevChildNodeId,
          to: mergeNodeId,
          kind: "sequence",
        });
      }
    });
  } else {
    // No child task chats spawned yet: render the root chat's turn progression directly
    const significantMessages = rootMessages.filter(
      (m) => m.content && m.content.trim().length > 0,
    );

    significantMessages.slice(0, 12).forEach((msg) => {
      const msgNodeId = `node_root_msg_${msg.id}`;
      const emp = msg.sender_employee_id !== null ? employeeMap.get(msg.sender_employee_id) : undefined;
      const title = msg.content.trim().slice(0, 38) || `消息 #${msg.id}`;
      const isUser = msg.sender_employee_id === null;

      let thumbnail: string | null = null;
      if (msg.kind === "image" && msg.attachments) {
        try {
          const atts = JSON.parse(msg.attachments);
          if (Array.isArray(atts) && atts[0]?.path) thumbnail = atts[0].path;
        } catch {
          // ignore
        }
      }

      nodes.push({
        id: msgNodeId,
        lane: 0,
        order: orderCounter++,
        type: isUser ? "task" : "task",
        title,
        subtitle: isUser ? "Boss 指令" : emp ? `${emp.name} · 回复` : "助手回复",
        employeeId: msg.sender_employee_id,
        employeeName: emp?.name,
        employeeRole: emp?.role,
        employeeAvatar: emp?.avatar,
        status: "completed",
        thumbnail,
        chatId: rootChat.id,
        messageId: msg.id,
      });

      edges.push({
        id: `edge_seq_${lastLane0NodeId}_${msgNodeId}`,
        from: lastLane0NodeId,
        to: msgNodeId,
        kind: "sequence",
      });
      lastLane0NodeId = msgNodeId;
    });
  }

  return {
    nodes,
    edges,
    mode: "live",
    activeTaskId: null,
    chatId: rootChat.id,
    chatTitle: rootChat.title,
    generatedAt: Date.now(),
  };
}
