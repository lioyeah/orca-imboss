/**
 * The latent graph of a workspace: conversations, employees and tags, plus the
 * links between them. A read-only view model — built in the main process from
 * the tables that already exist (see `main/db/graph.ts`) and never persisted.
 *
 * Ids are stable, namespaced strings (`chat:12`, `employee:3`, `tag:work`) so
 * the renderer can key React elements and resolve a click back to its row.
 */

export type GraphNodeKind = "chat" | "employee" | "tag";

/**
 * How two nodes are linked. Chats point at each other through four independent
 * channels the app already records: `spawned` (a task group branched off its
 * parent), `attached` (a chat card dropped into the conversation), `progress`
 * (a progress/interrupted notice that reports on a task group), and `tag`.
 * Chat→employee links are `participant` (a member) and `session` (an employee
 * with an agent session in that conversation).
 */
export type GraphEdgeKind =
  | "spawned"
  | "attached"
  | "progress"
  | "participant"
  | "session"
  | "tag";

/** Lifecycle state of a conversation or task node. */
export type NodeLifecycle = "root" | "running" | "completed" | "interrupted" | "idle";

/** Cognitive perspective for architectural projection. */
export type GraphPerspective = "all" | "causality" | "collaboration" | "knowledge";

export interface GraphNode {
  /** Namespaced stable id, e.g. `chat:12`, `employee:3`, `tag:work`. */
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Secondary line, already display-ready: an employee's role. */
  sub: string | null;
  /**
   * Size hint. Chats: message count. Employees: conversations they take part
   * in. Tags: chats carrying them.
   */
  weight: number;
  /** Chat nodes only. */
  chatId?: number;
  /** Chat nodes only: true for a root (user-facing) chat. */
  isRoot?: boolean;
  /** Chat nodes only: how many employees are members. */
  participants?: number;
  /** Employee nodes only. */
  employeeId?: number;
  /** Employee avatar asset path or URI. */
  avatar?: string | null;
  /** Employee disabled flag. */
  disabled?: boolean;
  /** Tag nodes only. */
  tag?: string;
  /** Milliseconds epoch timestamp when node was created. */
  createdAt?: number;
  /** Milliseconds epoch timestamp when node was last active/updated. */
  updatedAt?: number;
  /** In-degree (incoming links count). */
  inDegree?: number;
  /** Out-degree (outgoing links count). */
  outDegree?: number;
  /** Total degree of connections. */
  degree?: number;
  /** Topology cluster ID (e.g. root chat id) for community grouping/coloring. */
  clusterId?: string;
  /** Hierarchical causal level (0 for root chats / primary employees, 1+ for spawned child task branches). */
  level?: number;
  /** Lifecycle runtime state. */
  lifecycle?: NodeLifecycle;
}

export interface GraphEdge {
  id: string;
  /** Node id of the source. */
  source: string;
  /** Node id of the target. */
  target: string;
  kind: GraphEdgeKind;
  /** Edge interaction strength or link weight. */
  weight?: number;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Epoch ms the payload was built. */
  generatedAt: number;
  /** Earliest createdAt across all nodes in epoch ms. */
  minTime?: number;
  /** Latest updatedAt/createdAt across all nodes in epoch ms. */
  maxTime?: number;
}
