import { GRAPH_EDGE_KINDS, GRAPH_EDGE_LABELS } from "@shared/constants/graph";
import { t } from "@shared/l10n";
import type {
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphPayload,
} from "@shared/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cls } from "reactutils";
import { appStore } from "../../../../app-store";
import { ModuleView } from "../../../app-shell";
import { IconGraph, IconX } from "../../../icons";
import "../../module-common.css";
import { GraphCanvas } from "../graph-canvas";
import "./index.css";

/** The kinds of chat→chat link that carry a meaningful direction. */
const DIRECTED_KINDS: ReadonlySet<GraphEdgeKind> = new Set([
  "spawned",
  "attached",
  "progress",
]);

/** One row in the inspector's link list. */
interface InspectorLink {
  key: string;
  node: GraphNode;
  kind: GraphEdgeKind;
  outgoing: boolean;
}

export function GraphModule(): React.JSX.Element {
  const [payload, setPayload] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped by the chat/employee change subscriptions to re-fetch the graph.
  const [refreshToken, setRefreshToken] = useState(0);
  const [enabled, setEnabled] = useState<ReadonlySet<GraphEdgeKind>>(
    () => new Set(GRAPH_EDGE_KINDS),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void imb.graph
      .get()
      .then((next) => {
        if (alive) setPayload(next);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [refreshToken]);

  // Deriving the graph from conversations and roster
  useEffect(() => {
    const unsubscribes = [
      imb.chats.onChanged(() => setRefreshToken((n) => n + 1)),
      imb.chats.onDeleted(() => setRefreshToken((n) => n + 1)),
      imb.employees.onChanged(() => setRefreshToken((n) => n + 1)),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, []);

  const visible = useMemo((): {
    nodes: GraphNode[];
    edges: GraphEdge[];
  } => {
    if (!payload) return { nodes: [], edges: [] };
    const edges = payload.edges.filter((edge) => enabled.has(edge.kind));
    const linked = new Set<string>();
    for (const edge of edges) {
      linked.add(edge.source);
      linked.add(edge.target);
    }
    const everLinked = new Set<string>();
    for (const edge of payload.edges) {
      everLinked.add(edge.source);
      everLinked.add(edge.target);
    }
    const nodes = payload.nodes.filter(
      (node) => linked.has(node.id) || !everLinked.has(node.id),
    );
    return { nodes, edges };
  }, [payload, enabled]);

  const selected = useMemo(
    (): GraphNode | null =>
      visible.nodes.find((node) => node.id === selectedId) ?? null,
    [visible.nodes, selectedId],
  );

  const links = useMemo((): InspectorLink[] => {
    if (!selected) return [];
    const byId = new Map(visible.nodes.map((node) => [node.id, node]));
    const result: InspectorLink[] = [];
    for (const edge of visible.edges) {
      if (edge.source === selected.id) {
        const node = byId.get(edge.target);
        if (node) {
          result.push({
            key: edge.id,
            node,
            kind: edge.kind,
            outgoing: true,
          });
        }
      } else if (edge.target === selected.id) {
        const node = byId.get(edge.source);
        if (node) {
          result.push({
            key: edge.id,
            node,
            kind: edge.kind,
            outgoing: false,
          });
        }
      }
    }
    return result;
  }, [selected, visible]);

  // Drop selection if filtered out
  useEffect(() => {
    if (selectedId === null) return;
    if (!visible.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(null);
    }
  }, [visible.nodes, selectedId]);

  const selectedSub = useMemo((): string | null => {
    if (!selected) return null;
    if (selected.kind !== "chat") return selected.sub;
    const count = selected.participants ?? 0;
    return count > 0
      ? t("${count} participants", { count: String(count) })
      : null;
  }, [selected]);

  const toggleKind = (kind: GraphEdgeKind): void => {
    setEnabled((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const openNode = useCallback((node: GraphNode): void => {
    if (node.kind === "chat" && node.chatId !== undefined) {
      if (node.isRoot) {
        void appStore.focusChat(node.chatId);
        return;
      }
      void imb.chats.summary(node.chatId).then((summary) => {
        if (summary) appStore.openChat(summary);
      });
      return;
    }
    if (node.kind === "employee" && node.employeeId !== undefined) {
      void appStore.focusEmployee(node.employeeId);
    }
  }, []);

  const content = (
    <div className="imb-graph">
      <header className="imb-graph-head">
        <div className="imb-graph-headline">
          <div className="imb-graph-headicon-wrap">
            <IconGraph className="imb-graph-headicon" />
          </div>
          <div className="imb-graph-head-meta">
            <h1 className="imb-graph-title">{t("Graph")}</h1>
            {payload ? (
              <span className="imb-graph-stats">
                {t("${nodes} nodes · ${edges} links", {
                  nodes: String(visible.nodes.length),
                  edges: String(visible.edges.length),
                })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="imb-graph-legend" role="group" aria-label={t("Links")}>
          <span className="imb-graph-legend-title">{t("Links")}</span>
          {GRAPH_EDGE_KINDS.map((kind) => {
            const on = enabled.has(kind);
            return (
              <button
                key={kind}
                type="button"
                className={cls(
                  "imb-graph-chip",
                  `imb-graph-chip--${kind}`,
                  !on && "imb-is-off",
                )}
                aria-pressed={on}
                onClick={() => toggleKind(kind)}
              >
                <span className="imb-graph-chip-dot" />
                <span className="imb-graph-chip-label">
                  {t(GRAPH_EDGE_LABELS[kind])}
                </span>
              </button>
            );
          })}
        </div>
      </header>

      <div className="imb-graph-stage">
        {error !== null ? (
          <p className="imb-module-error">{error}</p>
        ) : loading && payload === null ? (
          <p className="imb-module-note imb-graph-placeholder">
            {t("Loading…")}
          </p>
        ) : visible.nodes.length === 0 ? (
          <p className="imb-module-note imb-graph-placeholder">
            {(payload?.nodes.length ?? 0) === 0
              ? t("No conversations yet")
              : t("No links")}
          </p>
        ) : (
          <GraphCanvas
            nodes={visible.nodes}
            edges={visible.edges}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpen={openNode}
          />
        )}

        {/* Collect UI Floating Inspector Panel */}
        {selected ? (
          <aside className="imb-graph-inspector">
            <header className="imb-graph-inspector-head">
              <div className="imb-graph-inspector-head-top">
                <span
                  className={cls(
                    "imb-graph-kind",
                    `imb-graph-kind--${selected.kind}`,
                  )}
                >
                  {t(kindLabel(selected.kind))}
                </span>
                <button
                  type="button"
                  className="imb-graph-inspector-close"
                  onClick={() => setSelectedId(null)}
                  aria-label={t("Close")}
                  title={t("Close (Esc)")}
                >
                  <IconX className="imb-graph-close-icon" />
                </button>
              </div>
              <strong className="imb-graph-inspector-name">
                {selected.label}
              </strong>
              {selectedSub ? (
                <span className="imb-graph-inspector-sub">{selectedSub}</span>
              ) : null}
            </header>

            <div className="imb-graph-inspector-body">
              <div className="imb-graph-inspector-section-title">
                {t("Connections")} ({links.length})
              </div>
              {links.length > 0 ? (
                <ul className="imb-graph-inspector-links">
                  {links.map((link) => (
                    <li key={link.key}>
                      <button
                        type="button"
                        className="imb-graph-link-node"
                        onClick={() => setSelectedId(link.node.id)}
                      >
                        <span
                          className={cls(
                            "imb-graph-dot",
                            `imb-graph-dot--${link.node.kind}`,
                          )}
                        />
                        <span className="imb-graph-link-label">
                          {link.node.label}
                        </span>
                      </button>
                      <span className="imb-graph-link-kind">
                        {DIRECTED_KINDS.has(link.kind)
                          ? `${link.outgoing ? "→" : "←"} `
                          : ""}
                        {t(GRAPH_EDGE_LABELS[link.kind])}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="imb-module-note imb-graph-no-links">
                  {t("No links")}
                </p>
              )}
            </div>

            <footer className="imb-graph-inspector-footer">
              {selected.kind === "chat" || selected.kind === "employee" ? (
                <button
                  type="button"
                  className="imb-graph-open"
                  onClick={() => openNode(selected)}
                >
                  {t(
                    selected.kind === "employee"
                      ? "View Employee"
                      : "Open Conversation",
                  )}
                </button>
              ) : null}
            </footer>
          </aside>
        ) : null}
      </div>
    </div>
  );

  return <ModuleView content={content} />;
}

/** The label for a node's kind badge. */
function kindLabel(kind: GraphNode["kind"]): string {
  switch (kind) {
    case "employee":
      return "Employee";
    case "tag":
      return "Tag";
    default:
      return "Conversation";
  }
}
