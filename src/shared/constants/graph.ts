import type { GraphEdgeKind } from "../types/graph";

/**
 * The Graph module is self-contained: shared/types/graph.ts,
 * shared/constants/graph.ts, main/db/graph.ts, main/ipc/graph.ts and
 * renderer/components/modules/graph/. This constant is its SINGLE integration
 * point — flip it to `false` and the nav entry, the module view and the IPC
 * handler all disappear, with nothing else to change.
 */
export const GRAPH_VIEW_ENABLED = true;

/** Edge kinds in legend order. */
export const GRAPH_EDGE_KINDS: readonly GraphEdgeKind[] = [
  "spawned",
  "attached",
  "progress",
  "participant",
  "session",
  "tag",
];

/** Human labels for the legend (English keys; l10n overrides them). */
export const GRAPH_EDGE_LABELS: Record<GraphEdgeKind, string> = {
  spawned: "Spawned",
  attached: "Attached",
  progress: "Progress",
  participant: "Participant",
  session: "Agent session",
  tag: "Tag",
};

/** True when `value` is one of the known edge kinds. */
export function isGraphEdgeKind(value: unknown): value is GraphEdgeKind {
  return (
    typeof value === "string" &&
    (GRAPH_EDGE_KINDS as readonly string[]).includes(value)
  );
}
