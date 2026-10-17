import { GRAPH_EDGE_KINDS, GRAPH_EDGE_LABELS } from "@shared/constants/graph";
import { t } from "@shared/l10n";
import type {
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphPayload,
} from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cls } from "reactutils";
import { appStore } from "../../../../app-store";
import { ModuleView } from "../../../app-shell";
import {
  IconClock,
  IconGear,
  IconGraph,
  IconPlay,
  IconSearch,
  IconX,
} from "../../../icons";
import "../../module-common.css";
import {
  DEFAULT_PHYSICS,
  GraphCanvas,
  type PhysicsConfig,
} from "../graph-canvas";
import "./index.css";

const DIRECTED_KINDS: ReadonlySet<GraphEdgeKind> = new Set([
  "spawned",
  "attached",
  "progress",
]);

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
  const [refreshToken, setRefreshToken] = useState(0);

  // Link filters
  const [enabled, setEnabled] = useState<ReadonlySet<GraphEdgeKind>>(
    () => new Set(GRAPH_EDGE_KINDS),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Advanced feature controls
  const [searchQuery, setSearchQuery] = useState("");
  const [colorMode, setColorMode] = useState<"kind" | "cluster">("kind");
  const [hideOrphans, setHideOrphans] = useState(false);

  // Physics tuning state
  const [physics, setPhysics] = useState<PhysicsConfig>(DEFAULT_PHYSICS);
  const [showPhysicsPanel, setShowPhysicsPanel] = useState(false);

  // Temporal timeline slider
  const [showTimeline, setShowTimeline] = useState(false);
  const [timeCutoff, setTimeCutoff] = useState<number | null>(null);
  const [isPlayingTimeline, setIsPlayingTimeline] = useState(false);

  const flyToNodeRef = useRef<((id: string) => void) | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    void imb.graph
      .get()
      .then((next) => {
        if (alive) {
          setPayload(next);
          if (next.maxTime) {
            setTimeCutoff(next.maxTime);
          }
        }
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

  // Timeline auto-play timer
  useEffect(() => {
    if (!isPlayingTimeline || !payload || !payload.minTime || !payload.maxTime)
      return;
    const min = payload.minTime;
    const max = payload.maxTime;
    const step = (max - min) / 80;

    const interval = setInterval(() => {
      setTimeCutoff((curr) => {
        const next = (curr ?? min) + step;
        if (next >= max) {
          setIsPlayingTimeline(false);
          return max;
        }
        return next;
      });
    }, 60);

    return () => clearInterval(interval);
  }, [isPlayingTimeline, payload]);

  // Filter visible nodes and edges
  const visible = useMemo((): {
    nodes: GraphNode[];
    edges: GraphEdge[];
  } => {
    if (!payload) return { nodes: [], edges: [] };

    let candidateNodes = payload.nodes;

    // Temporal cutoff filter
    if (timeCutoff !== null) {
      candidateNodes = candidateNodes.filter(
        (node) => !node.createdAt || node.createdAt <= timeCutoff,
      );
    }

    const candidateNodeIds = new Set(candidateNodes.map((n) => n.id));

    // Edge filtering
    const candidateEdges = payload.edges.filter(
      (edge) =>
        enabled.has(edge.kind) &&
        candidateNodeIds.has(edge.source) &&
        candidateNodeIds.has(edge.target),
    );

    const linked = new Set<string>();
    for (const edge of candidateEdges) {
      linked.add(edge.source);
      linked.add(edge.target);
    }

    // Hide orphans filter
    const nodes = candidateNodes.filter((node) => {
      if (hideOrphans) return linked.has(node.id);
      return true;
    });

    return { nodes, edges: candidateEdges };
  }, [payload, enabled, timeCutoff, hideOrphans]);

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

  useEffect(() => {
    if (selectedId === null) return;
    if (!visible.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(null);
    }
  }, [visible.nodes, selectedId]);

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

  const handleSearchSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!searchQuery.trim() || !flyToNodeRef.current) return;
    const q = searchQuery.trim().toLowerCase();
    const match = visible.nodes.find(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        (n.sub && n.sub.toLowerCase().includes(q)),
    );
    if (match) {
      setSelectedId(match.id);
      flyToNodeRef.current(match.id);
    }
  };

  const content = (
    <div className="imb-graph">
      {/* Collect UI Modern Header */}
      <header className="imb-graph-head">
        <div className="imb-graph-headline">
          <div className="imb-graph-headicon-wrap">
            <IconGraph className="imb-graph-headicon" />
          </div>
          <div className="imb-graph-head-meta">
            <h1 className="imb-graph-title">{t("Knowledge Graph")}</h1>
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

        {/* Search & Actions cluster */}
        <div className="imb-graph-actions-cluster">
          {/* Quick search input */}
          <form className="imb-graph-search-form" onSubmit={handleSearchSubmit}>
            <IconSearch className="imb-graph-search-icon" />
            <input
              type="text"
              className="imb-graph-search-input"
              placeholder={t("Filter or search…")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="imb-graph-search-clear"
                onClick={() => setSearchQuery("")}
              >
                ×
              </button>
            )}
          </form>

          {/* Action buttons */}
          <div className="imb-graph-toggles">
            <button
              type="button"
              className={cls(
                "imb-graph-action-chip",
                colorMode === "cluster" && "imb-is-active",
              )}
              onClick={() =>
                setColorMode((m) => (m === "kind" ? "cluster" : "kind"))
              }
              title={t("Toggle Cluster vs Kind Coloring")}
            >
              {colorMode === "cluster" ? t("Clusters") : t("Kinds")}
            </button>

            <button
              type="button"
              className={cls(
                "imb-graph-action-chip",
                hideOrphans && "imb-is-active",
              )}
              onClick={() => setHideOrphans((v) => !v)}
              title={t("Hide nodes without connections")}
            >
              {t("Hide Orphans")}
            </button>

            <button
              type="button"
              className={cls(
                "imb-graph-icon-chip",
                showTimeline && "imb-is-active",
              )}
              onClick={() => setShowTimeline((v) => !v)}
              title={t("Timeline / Evolution Playback")}
            >
              <IconClock className="imb-chip-icon" />
            </button>

            <button
              type="button"
              className={cls(
                "imb-graph-icon-chip",
                showPhysicsPanel && "imb-is-active",
              )}
              onClick={() => setShowPhysicsPanel((v) => !v)}
              title={t("Tuning physics simulation")}
            >
              <IconGear className="imb-chip-icon" />
            </button>
          </div>
        </div>

        {/* Link Filter Chips */}
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

      {/* Temporal Timeline Bar */}
      {showTimeline && payload && payload.minTime && payload.maxTime && (
        <div className="imb-graph-timeline-bar">
          <button
            type="button"
            className="imb-graph-timeline-play"
            onClick={() => {
              if (
                timeCutoff &&
                timeCutoff >= (payload.maxTime ?? 0) - 1000
              ) {
                setTimeCutoff(payload.minTime ?? null);
              }
              setIsPlayingTimeline((p) => !p);
            }}
            title={isPlayingTimeline ? t("Pause") : t("Play Evolution")}
          >
            <IconPlay className="imb-play-icon" />
            {isPlayingTimeline ? t("Pause") : t("Play")}
          </button>
          <span className="imb-graph-timeline-date">
            {timeCutoff
              ? new Date(timeCutoff).toLocaleDateString()
              : t("All time")}
          </span>
          <input
            type="range"
            className="imb-graph-timeline-slider"
            min={payload.minTime}
            max={payload.maxTime}
            value={timeCutoff ?? payload.maxTime}
            onChange={(e) => {
              setIsPlayingTimeline(false);
              setTimeCutoff(Number(e.target.value));
            }}
          />
          <button
            type="button"
            className="imb-graph-timeline-reset"
            onClick={() => {
              setIsPlayingTimeline(false);
              setTimeCutoff(payload.maxTime ?? null);
            }}
          >
            {t("Latest")}
          </button>
        </div>
      )}

      {/* Physics Tuning Flyout Panel */}
      {showPhysicsPanel && (
        <aside className="imb-graph-physics-popover">
          <div className="imb-graph-physics-head">
            <strong>{t("Physics Tuning")}</strong>
            <button
              type="button"
              className="imb-graph-popover-close"
              onClick={() => setShowPhysicsPanel(false)}
            >
              ×
            </button>
          </div>
          <div className="imb-graph-physics-body">
            <label className="imb-graph-physics-row">
              <span className="imb-graph-physics-label">{t("Repulsion")}</span>
              <input
                type="range"
                min="4000"
                max="28000"
                step="1000"
                value={physics.repulsion}
                onChange={(e) =>
                  setPhysics((p) => ({ ...p, repulsion: Number(e.target.value) }))
                }
              />
              <span className="imb-graph-physics-val">{physics.repulsion}</span>
            </label>
            <label className="imb-graph-physics-row">
              <span className="imb-graph-physics-label">{t("Link Distance")}</span>
              <input
                type="range"
                min="60"
                max="260"
                step="10"
                value={physics.linkDistance}
                onChange={(e) =>
                  setPhysics((p) => ({
                    ...p,
                    linkDistance: Number(e.target.value),
                  }))
                }
              />
              <span className="imb-graph-physics-val">{physics.linkDistance}</span>
            </label>
            <label className="imb-graph-physics-row">
              <span className="imb-graph-physics-label">{t("Gravity Pull")}</span>
              <input
                type="range"
                min="0.0005"
                max="0.008"
                step="0.0005"
                value={physics.centerPull}
                onChange={(e) =>
                  setPhysics((p) => ({
                    ...p,
                    centerPull: Number(e.target.value),
                  }))
                }
              />
              <span className="imb-graph-physics-val">
                {physics.centerPull.toFixed(4)}
              </span>
            </label>
            <button
              type="button"
              className="imb-graph-physics-reset"
              onClick={() => setPhysics(DEFAULT_PHYSICS)}
            >
              {t("Reset Defaults")}
            </button>
          </div>
        </aside>
      )}

      {/* Main Stage */}
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
              : t("No matching nodes")}
          </p>
        ) : (
          <GraphCanvas
            nodes={visible.nodes}
            edges={visible.edges}
            selectedId={selectedId}
            searchQuery={searchQuery}
            colorMode={colorMode}
            physicsConfig={physics}
            onSelect={setSelectedId}
            onOpen={openNode}
            onFlyToReady={(fn) => {
              flyToNodeRef.current = fn;
            }}
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
              {selected.sub ? (
                <span className="imb-graph-inspector-sub">{selected.sub}</span>
              ) : null}

              {/* Topology metrics badge group */}
              <div className="imb-graph-inspector-metrics">
                <span className="imb-graph-metric-tag">
                  {t("Degree")}: {selected.degree ?? links.length}
                </span>
                {selected.participants !== undefined &&
                  selected.participants > 0 && (
                    <span className="imb-graph-metric-tag">
                      {t("Participants")}: {selected.participants}
                    </span>
                  )}
                {selected.weight > 0 && (
                  <span className="imb-graph-metric-tag">
                    {selected.kind === "chat" ? t("Messages") : t("Weight")}:{" "}
                    {selected.weight}
                  </span>
                )}
              </div>
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
                        onClick={() => {
                          setSelectedId(link.node.id);
                          if (flyToNodeRef.current) {
                            flyToNodeRef.current(link.node.id);
                          }
                        }}
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
