/**
 * The latent graph of a workspace: conversations, employees, tags, artifacts,
 * and tools, plus the causal and semantic links between them.
 * A read-only view model — built in the main process from the tables that
 * already exist (see `main/db/graph.ts`) and never persisted.
 *
 * Ids are stable, namespaced strings (`chat:12`, `employee:3`, `tag:work`,
 * `artifact:...`, `tool:...`) so the renderer can key React elements and
 * resolve a click back to its origin.
 */

export type GraphNodeKind = "chat" | "employee" | "tag" | "artifact" | "tool";

/**
 * How two nodes are linked.
 * - `spawned`: a task group branched off its parent.
 * - `attached`: a chat card dropped into the conversation.
 * - `progress`: a progress/interrupted notice that reports on a task group.
 * - `participant`: a member of the conversation.
 * - `session`: an employee with an agent session in that conversation.
 * - `tag`: a topic or category tag associated with a chat.
 * - `produces`: a chat or employee produced an artifact.
 * - `references`: a chat or task references/consumes an artifact.
 * - `invokes`: a chat or employee invoked a tool/capability.
 */
export type GraphEdgeKind =
  | "spawned"
  | "attached"
  | "progress"
  | "participant"
  | "session"
  | "tag"
  | "produces"
  | "references"
  | "invokes";

/** Lifecycle state of a conversation or task node. */
export type NodeLifecycle =
  | "root"
  | "running"
  | "completed"
  | "interrupted"
  | "idle";

/** Cognitive perspective for architectural projection. */
export type GraphPerspective =
  | "all"
  | "causality"
  | "collaboration"
  | "knowledge"
  | "artifacts";

export interface GraphNode {
  /** Namespaced stable id, e.g. `chat:12`, `employee:3`, `tag:work`, `artifact:x`, `tool:y`. */
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Secondary line, already display-ready: an employee's role, artifact size/type, etc. */
  sub: string | null;
  /**
   * Size hint. Chats: message count. Employees: conversations they take part in.
   * Tags: chats carrying them. Artifacts: file size / references. Tools: invocation count.
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
  /** Artifact nodes only: absolute or relative file path. */
  artifactPath?: string;
  /** Artifact nodes only: MIME type or extension like '.ts', '.png'. */
  artifactType?: string;
  /** Artifact nodes only: file size in bytes. */
  artifactSize?: number;
  /** Tool nodes only: tool identifier. */
  toolName?: string;
  /** Tool nodes only: capability category. */
  toolCategory?:
    | "orchestration"
    | "code"
    | "media"
    | "shell"
    | "mcp"
    | "general";
  /** Source chat id where the artifact/tool was first created or invoked. */
  sourceChatId?: number;
  /** Employee id that produced the artifact or invoked the tool. */
  producedByEmployeeId?: number;
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
  /** Aggregation Supernode flag. */
  isClusterSupernode?: boolean;
  /** Number of subnodes aggregated into this supernode. */
  collapsedCount?: number;
  /** Member node IDs inside this cluster. */
  clusterMemberIds?: string[];
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
