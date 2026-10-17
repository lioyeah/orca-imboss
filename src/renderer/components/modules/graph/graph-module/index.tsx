import { GRAPH_EDGE_KINDS, GRAPH_EDGE_LABELS } from "@shared/constants/graph";
import { t } from "@shared/l10n";
import type {
  GraphEdge,
  GraphEdgeKind,
  GraphNode,
  GraphPayload,
  GraphPerspective,
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
  IconStats,
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
  "produces",
  "references",
  "invokes",
  "depends_on",
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

  // Cognitive perspective
  const [perspective, setPerspective] = useState<GraphPerspective>("all");

  // Link filters
  const [enabled, setEnabled] = useState<ReadonlySet<GraphEdgeKind>>(
    () => new Set(GRAPH_EDGE_KINDS),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Subgraph isolation & depth expansion
  const [isolatedId, setIsolatedId] = useState<string | null>(null);
  const [expansionDepth, setExpansionDepth] = useState<number>(1);
  const [expansionDirection, setExpansionDirection] = useState<
    "both" | "downstream" | "upstream"
  >("both");

  // Cluster Supernode Aggregation mode
  const [aggregateClusters, setAggregateClusters] = useState(false);
  const [expandedClusterIds, setExpandedClusterIds] = useState<
    ReadonlySet<string>
  >(() => new Set());

  // Advanced feature controls
  const [searchQuery, setSearchQuery] = useState("");
  const [colorMode, setColorMode] = useState<"kind" | "cluster">("kind");
  const [hideOrphans, setHideOrphans] = useState(false);

  // Topology Analysis Drawer
  const [showTopologyDrawer, setShowTopologyDrawer] = useState(false);

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

  // Perspective presets for links & entities
  useEffect(() => {
    if (perspective === "causality") {
      setEnabled(new Set(["spawned", "attached", "progress", "produces", "depends_on"]));
    } else if (perspective === "collaboration") {
      setEnabled(new Set(["participant", "session", "invokes"]));
    } else if (perspective === "artifacts") {
      setEnabled(new Set(["produces", "references", "invokes"]));
    } else if (perspective === "knowledge") {
      setEnabled(new Set(["tag", "attached", "references"]));
    } else {
      setEnabled(new Set(GRAPH_EDGE_KINDS));
    }
  }, [perspective]);

  // Compute Subgraph closure based on isolatedId, expansionDepth, and direction
  const isolatedSubtreeIds = useMemo(() => {
    if (!isolatedId || !payload) return null;

    // Breadth-first search along DAG edges up to expansionDepth
    const visited = new Set<string>([isolatedId]);
    let currentFrontier = new Set<string>([isolatedId]);

    const maxDepth = Math.max(1, Math.min(expansionDepth, 5));

    for (let d = 0; d < maxDepth; d++) {
      const nextFrontier = new Set<string>();

      for (const edge of payload.edges) {
        if (!enabled.has(edge.kind)) continue;

        // Downstream causality: source is in frontier -> target is added
        if (expansionDirection === "both" || expansionDirection === "downstream") {
          if (currentFrontier.has(edge.source) && !visited.has(edge.target)) {
            visited.add(edge.target);
            nextFrontier.add(edge.target);
          }
        }

        // Upstream provenance: target is in frontier -> source is added
        if (expansionDirection === "both" || expansionDirection === "upstream") {
          if (currentFrontier.has(edge.target) && !visited.has(edge.source)) {
            visited.add(edge.source);
            nextFrontier.add(edge.source);
          }
        }
      }

      if (nextFrontier.size === 0) break;
      currentFrontier = nextFrontier;
    }

    return visited;
  }, [isolatedId, expansionDepth, expansionDirection, payload, enabled]);

  // Filter visible nodes and edges
  const visible = useMemo((): {
    nodes: GraphNode[];
    edges: GraphEdge[];
  } => {
    if (!payload) return { nodes: [], edges: [] };

    let candidateNodes = payload.nodes;

    // Subgraph isolation filter
    if (isolatedSubtreeIds !== null) {
      candidateNodes = candidateNodes.filter((n) =>
        isolatedSubtreeIds.has(n.id),
      );
    }

    // Temporal cutoff filter
    if (timeCutoff !== null) {
      candidateNodes = candidateNodes.filter(
        (node) => !node.createdAt || node.createdAt <= timeCutoff,
      );
    }

    // Perspective entity filter
    if (perspective === "causality") {
      candidateNodes = candidateNodes.filter(
        (n) => n.kind === "chat" || n.kind === "artifact",
      );
    } else if (perspective === "collaboration") {
      candidateNodes = candidateNodes.filter(
        (n) => n.kind === "employee" || n.kind === "chat" || n.kind === "tool",
      );
    } else if (perspective === "artifacts") {
      candidateNodes = candidateNodes.filter(
        (n) =>
          n.kind === "artifact" ||
          n.kind === "tool" ||
          n.kind === "chat" ||
          n.kind === "employee",
      );
    } else if (perspective === "knowledge") {
      candidateNodes = candidateNodes.filter(
        (n) => n.kind === "tag" || n.kind === "chat" || n.kind === "artifact",
      );
    }

    // Cluster Supernode Aggregation
    if (aggregateClusters) {
      // Group candidate nodes by clusterId
      const clusterMap = new Map<string, GraphNode[]>();
      const nonClusterNodes: GraphNode[] = [];

      for (const node of candidateNodes) {
        if (node.clusterId && !node.isRoot) {
          let list = clusterMap.get(node.clusterId);
          if (!list) {
            list = [];
            clusterMap.set(node.clusterId, list);
          }
          list.push(node);
        } else {
          nonClusterNodes.push(node);
        }
      }

      const aggregatedNodes: GraphNode[] = [...nonClusterNodes];
      const remappedNodeId = new Map<string, string>();

      for (const [clusterId, members] of clusterMap.entries()) {
        if (members.length > 2 && !expandedClusterIds.has(clusterId)) {
          const superId = `supernode:${clusterId}`;
          const rootMember = nonClusterNodes.find(
            (n) => n.clusterId === clusterId && n.isRoot,
          );
          const supernode: GraphNode = {
            id: superId,
            kind: "chat",
            label: rootMember ? `${rootMember.label} [Cluster]` : `Cluster Hub`,
            sub: `${members.length} sub-tasks & artifacts`,
            weight: members.reduce((sum, m) => sum + m.weight, 0),
            isClusterSupernode: true,
            collapsedCount: members.length,
            clusterMemberIds: members.map((m) => m.id),
            clusterId,
            level: 1,
            lifecycle: members.some((m) => m.lifecycle === "running")
              ? "running"
              : "completed",
          };
          aggregatedNodes.push(supernode);

          for (const m of members) {
            remappedNodeId.set(m.id, superId);
          }
        } else {
          aggregatedNodes.push(...members);
        }
      }

      candidateNodes = aggregatedNodes;
      const candidateNodeIds = new Set(candidateNodes.map((n) => n.id));

      const candidateEdges = payload.edges
        .filter((edge) => enabled.has(edge.kind))
        .map((edge) => {
          const s = remappedNodeId.get(edge.source) ?? edge.source;
          const t = remappedNodeId.get(edge.target) ?? edge.target;
          if (s === t) return null;
          return {
            ...edge,
            id: `${edge.kind}|${s}|${t}`,
            source: s,
            target: t,
          };
        })
        .filter(
          (edge): edge is GraphEdge =>
            edge !== null &&
            candidateNodeIds.has(edge.source) &&
            candidateNodeIds.has(edge.target),
        );

      const linked = new Set<string>();
      for (const edge of candidateEdges) {
        linked.add(edge.source);
        linked.add(edge.target);
      }

      const nodes = candidateNodes.filter((node) => {
        if (hideOrphans) return linked.has(node.id);
        return true;
      });

      return { nodes, edges: candidateEdges };
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
  }, [
    payload,
    enabled,
    timeCutoff,
    hideOrphans,
    perspective,
    isolatedSubtreeIds,
    aggregateClusters,
    expandedClusterIds,
  ]);

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

  // Topology Analysis Metrics Computation
  const topologyMetrics = useMemo(() => {
    if (!payload) return null;
    const { nodes, edges } = payload;

    const chatCount = nodes.filter((n) => n.kind === "chat").length;
    const employeeCount = nodes.filter((n) => n.kind === "employee").length;
    const artifactCount = nodes.filter((n) => n.kind === "artifact").length;
    const toolCount = nodes.filter((n) => n.kind === "tool").length;

    // Causal DAG depth calculation
    let maxDepth = 0;
    for (const node of nodes) {
      if (node.level !== undefined && node.level > maxDepth) {
        maxDepth = node.level;
      }
    }

    // Unique clusters
    const clusters = new Set<string>();
    for (const node of nodes) {
      if (node.clusterId) clusters.add(node.clusterId);
    }

    // Top active employees by connections
    const empDegreeMap = new Map<string, { label: string; count: number }>();
    for (const edge of edges) {
      if (edge.kind === "participant" || edge.kind === "session") {
        const empNode = nodes.find((n) => n.id === edge.target);
        if (empNode) {
          const current = empDegreeMap.get(empNode.id) ?? {
            label: empNode.label,
            count: 0,
          };
          current.count++;
          empDegreeMap.set(empNode.id, current);
        }
      }
    }
    const topEmployees = Array.from(empDegreeMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Top tools invoked
    const toolDegreeMap = new Map<string, { label: string; count: number }>();
    for (const edge of edges) {
      if (edge.kind === "invokes") {
        const toolNode = nodes.find((n) => n.id === edge.target);
        if (toolNode) {
          const current = toolDegreeMap.get(toolNode.id) ?? {
            label: toolNode.label,
            count: 0,
          };
          current.count++;
          toolDegreeMap.set(toolNode.id, current);
        }
      }
    }
    const topTools = Array.from(toolDegreeMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const injectedContextCount = nodes.filter(
      (n) => n.kind === "chat" && n.hasUpstreamContext === true,
    ).length;
    const dependsOnLinks = edges.filter((e) => e.kind === "depends_on").length;

    return {
      chatCount,
      employeeCount,
      artifactCount,
      toolCount,
      maxDepth,
      clusterCount: clusters.size,
      totalLinks: edges.length,
      topEmployees,
      topTools,
      injectedContextCount,
      dependsOnLinks,
    };
  }, [payload]);

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
    // If it's a cluster supernode, expand it in place
    if (node.isClusterSupernode && node.clusterId) {
      setExpandedClusterIds((prev) => {
        const next = new Set(prev);
        next.add(node.clusterId!);
        return next;
      });
      return;
    }

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
      return;
    }
    if (node.kind === "artifact" && node.sourceChatId !== undefined) {
      void appStore.focusChat(node.sourceChatId);
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
      {/* Header */}
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
                {isolatedId && ` (${t("Isolated Subgraph")})`}
              </span>
            ) : null}
          </div>
        </div>

        {/* Cognitive Perspective Segmented Switcher */}
        <div className="imb-graph-perspective-segment" role="tablist">
          <button
            type="button"
            className={cls(
              "imb-graph-seg-btn",
              perspective === "all" && "imb-is-active",
            )}
            onClick={() => setPerspective("all")}
          >
            {t("Overview")}
          </button>
          <button
            type="button"
            className={cls(
              "imb-graph-seg-btn",
              perspective === "causality" && "imb-is-active",
            )}
            onClick={() => setPerspective("causality")}
          >
            {t("Causality Tree")}
          </button>
          <button
            type="button"
            className={cls(
              "imb-graph-seg-btn",
              perspective === "collaboration" && "imb-is-active",
            )}
            onClick={() => setPerspective("collaboration")}
          >
            {t("Collaboration")}
          </button>
          <button
            type="button"
            className={cls(
              "imb-graph-seg-btn",
              perspective === "artifacts" && "imb-is-active",
            )}
            onClick={() => setPerspective("artifacts")}
          >
            {t("Artifacts & Code")}
          </button>
          <button
            type="button"
            className={cls(
              "imb-graph-seg-btn",
              perspective === "knowledge" && "imb-is-active",
            )}
            onClick={() => setPerspective("knowledge")}
          >
            {t("Knowledge")}
          </button>
        </div>

        {/* Search & Actions cluster */}
        <div className="imb-graph-actions-cluster">
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
                aggregateClusters && "imb-is-active",
              )}
              onClick={() => {
                setAggregateClusters((v) => !v);
                setExpandedClusterIds(new Set());
              }}
              title={t("Aggregate complex clusters into supernodes")}
            >
              {aggregateClusters ? t("Aggregated") : t("Clusters")}
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

            {isolatedId && (
              <button
                type="button"
                className="imb-graph-action-chip imb-is-active"
                onClick={() => setIsolatedId(null)}
                title={t("Exit subgraph isolation mode")}
              >
                {t("Reset Isolation")} ×
              </button>
            )}

            <button
              type="button"
              className={cls(
                "imb-graph-icon-chip",
                showTopologyDrawer && "imb-is-active",
              )}
              onClick={() => setShowTopologyDrawer((v) => !v)}
              title={t("Topology & Synergy Analysis")}
            >
              <IconStats className="imb-chip-icon" />
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

      {/* Timeline Bar */}
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
                  setPhysics((p) => ({
                    ...p,
                    repulsion: Number(e.target.value),
                  }))
                }
              />
              <span className="imb-graph-physics-val">{physics.repulsion}</span>
            </label>
            <label className="imb-graph-physics-row">
              <span className="imb-graph-physics-label">
                {t("Link Distance")}
              </span>
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
              <span className="imb-graph-physics-val">
                {physics.linkDistance}
              </span>
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
            perspective={perspective}
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
                  {t(
                    selected.isClusterSupernode
                      ? "Cluster Hub"
                      : kindLabel(selected.kind),
                  )}
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
                {selected.level !== undefined && (
                  <span className="imb-graph-metric-tag">
                    {selected.level === 0
                      ? t("Root Level")
                      : `Level ${selected.level}`}
                  </span>
                )}
                {selected.lifecycle && (
                  <span
                    className={cls(
                      "imb-graph-metric-tag",
                      `imb-graph-metric--${selected.lifecycle}`,
                    )}
                  >
                    {t(selected.lifecycle)}
                  </span>
                )}
                <span className="imb-graph-metric-tag">
                  {t("Degree")}: {selected.degree ?? links.length}
                </span>
                {selected.participants !== undefined &&
                  selected.participants > 0 && (
                    <span className="imb-graph-metric-tag">
                      {t("Participants")}: {selected.participants}
                    </span>
                  )}
                {selected.hasUpstreamContext && (
                  <span
                    className="imb-graph-metric-tag imb-graph-metric--injected"
                    title={t("Upstream causal context injected into agent runtime")}
                  >
                    ✓ {t("Context Injected")}
                  </span>
                )}
                {selected.upstreamArtifactsCount !== undefined &&
                  selected.upstreamArtifactsCount > 0 && (
                    <span className="imb-graph-metric-tag">
                      {t("Upstream Artifacts")}: {selected.upstreamArtifactsCount}
                    </span>
                  )}
                {selected.kind === "artifact" && selected.producedByEmployeeName && (
                  <span className="imb-graph-metric-tag">
                    {t("Producer")}: {selected.producedByEmployeeName}
                  </span>
                )}
                {selected.weight > 0 && (
                  <span className="imb-graph-metric-tag">
                    {selected.kind === "chat"
                      ? t("Messages")
                      : selected.kind === "artifact"
                        ? t("Weight")
                        : t("Invocations")}
                    : {selected.weight}
                  </span>
                )}
              </div>

              {/* Local Subgraph Depth Expansion Stepper */}
              <div className="imb-graph-depth-controls">
                <span className="imb-graph-depth-label">{t("Local Depth")}:</span>
                <div className="imb-graph-depth-stepper">
                  <button
                    type="button"
                    className="imb-graph-depth-btn"
                    onClick={() =>
                      setExpansionDepth((d) => Math.max(1, d - 1))
                    }
                    title={t("Decrease expansion depth")}
                  >
                    −
                  </button>
                  <span className="imb-graph-depth-val">{expansionDepth}</span>
                  <button
                    type="button"
                    className="imb-graph-depth-btn"
                    onClick={() =>
                      setExpansionDepth((d) => Math.min(5, d + 1))
                    }
                    title={t("Increase expansion depth")}
                  >
                    +
                  </button>
                </div>
                <div className="imb-graph-dir-segment">
                  <button
                    type="button"
                    className={cls(
                      "imb-graph-dir-btn",
                      expansionDirection === "downstream" && "imb-is-active",
                    )}
                    onClick={() => setExpansionDirection("downstream")}
                    title={t("Follow causal forward links")}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={cls(
                      "imb-graph-dir-btn",
                      expansionDirection === "upstream" && "imb-is-active",
                    )}
                    onClick={() => setExpansionDirection("upstream")}
                    title={t("Follow provenance backward links")}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={cls(
                      "imb-graph-dir-btn",
                      expansionDirection === "both" && "imb-is-active",
                    )}
                    onClick={() => setExpansionDirection("both")}
                    title={t("Bidirectional neighborhood")}
                  >
                    ↔
                  </button>
                </div>
              </div>
            </header>

            <div className="imb-graph-inspector-body">
              {selected.kind === "artifact" && selected.artifactPath && (
                <div className="imb-graph-artifact-path-row">
                  <span
                    className="imb-graph-artifact-path-val"
                    title={selected.artifactPath}
                  >
                    {selected.artifactPath}
                  </span>
                  <button
                    type="button"
                    className="imb-graph-copy-btn"
                    onClick={() => {
                      if (selected.artifactPath) {
                        void navigator.clipboard.writeText(selected.artifactPath);
                      }
                    }}
                    title={t("Copy artifact file path")}
                  >
                    {t("Copy Path")}
                  </button>
                </div>
              )}
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
              <div className="imb-graph-inspector-actions">
                {selected.kind === "chat" ||
                selected.kind === "employee" ||
                selected.kind === "artifact" ? (
                  <button
                    type="button"
                    className="imb-graph-open"
                    onClick={() => openNode(selected)}
                  >
                    {t(
                      selected.kind === "employee"
                        ? "View Employee"
                        : selected.kind === "artifact"
                          ? "Open Origin Conversation"
                          : selected.isClusterSupernode
                            ? "Expand Cluster"
                            : "Open Conversation",
                    )}
                  </button>
                ) : null}

                {/* Subgraph Isolation Action */}
                <button
                  type="button"
                  className={cls(
                    "imb-graph-isolate-btn",
                    isolatedId === selected.id && "imb-is-active",
                  )}
                  onClick={() =>
                    setIsolatedId((curr) =>
                      curr === selected.id ? null : selected.id,
                    )
                  }
                  title={t("Isolate this node and its connected closure")}
                >
                  {isolatedId === selected.id
                    ? t("Restore All")
                    : t("Isolate Subgraph")}
                </button>
              </div>
            </footer>
          </aside>
        ) : null}

        {/* Topology & Agent Synergy Analysis Drawer */}
        {showTopologyDrawer && topologyMetrics && (
          <aside className="imb-graph-topo-drawer">
            <header className="imb-graph-topo-head">
              <h3 className="imb-graph-topo-title">
                {t("Topology & Network Analysis")}
              </h3>
              <button
                type="button"
                className="imb-graph-popover-close"
                onClick={() => setShowTopologyDrawer(false)}
              >
                ×
              </button>
            </header>

            <div className="imb-graph-topo-body">
              {/* Graph-as-Infrastructure Observability Card */}
              <div className="imb-graph-topo-card">
                <span className="imb-graph-topo-card-title">
                  {t("Graph-as-Infrastructure Observability")}
                </span>
                <div className="imb-graph-topo-grid">
                  <div className="imb-graph-topo-stat">
                    <span className="imb-graph-topo-val">
                      {topologyMetrics.injectedContextCount}
                    </span>
                    <span className="imb-graph-topo-sub">
                      {t("Causal Injections")}
                    </span>
                  </div>
                  <div className="imb-graph-topo-stat">
                    <span className="imb-graph-topo-val">
                      {topologyMetrics.artifactCount}
                    </span>
                    <span className="imb-graph-topo-sub">
                      {t("Artifacts Registered")}
                    </span>
                  </div>
                  <div className="imb-graph-topo-stat">
                    <span className="imb-graph-topo-val">
                      {topologyMetrics.dependsOnLinks}
                    </span>
                    <span className="imb-graph-topo-sub">
                      {t("Dependency Links")}
                    </span>
                  </div>
                  <div className="imb-graph-topo-stat">
                    <span className="imb-graph-topo-val" style={{ color: "#10b981" }}>
                      ● {t("Active")}
                    </span>
                    <span className="imb-graph-topo-sub">
                      {t("Backend Status")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Network Overview Card */}
              <div className="imb-graph-topo-card">
                <span className="imb-graph-topo-card-title">
                  {t("Network Footprint")}
                </span>
                <div className="imb-graph-topo-grid">
                  <div className="imb-graph-topo-stat">
                    <span className="imb-graph-topo-val">
                      {topologyMetrics.chatCount}
                    </span>
                    <span className="imb-graph-topo-sub">
                      {t("Conversations / Tasks")}
                    </span>
                  </div>
                  <div className="imb-graph-topo-stat">
                    <span className="imb-graph-topo-val">
                      {topologyMetrics.artifactCount}
                    </span>
                    <span className="imb-graph-topo-sub">
                      {t("Code & Deliverables")}
                    </span>
                  </div>
                  <div className="imb-graph-topo-stat">
                    <span className="imb-graph-topo-val">
                      {topologyMetrics.toolCount}
                    </span>
                    <span className="imb-graph-topo-sub">
                      {t("Tool Capabilities")}
                    </span>
                  </div>
                  <div className="imb-graph-topo-stat">
                    <span className="imb-graph-topo-val">
                      {topologyMetrics.clusterCount}
                    </span>
                    <span className="imb-graph-topo-sub">
                      {t("Causal Clusters")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Causal Flow DAG Card */}
              <div className="imb-graph-topo-card">
                <span className="imb-graph-topo-card-title">
                  {t("Causality Flow Analysis")}
                </span>
                <div className="imb-graph-topo-grid">
                  <div className="imb-graph-topo-stat">
                    <span className="imb-graph-topo-val">
                      {topologyMetrics.maxDepth}
                    </span>
                    <span className="imb-graph-topo-sub">
                      {t("Max DAG Hierarchy Level")}
                    </span>
                  </div>
                  <div className="imb-graph-topo-stat">
                    <span className="imb-graph-topo-val">
                      {topologyMetrics.totalLinks}
                    </span>
                    <span className="imb-graph-topo-sub">
                      {t("Total Semantic Links")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Agent Synergy Ranking Card */}
              <div className="imb-graph-topo-card">
                <span className="imb-graph-topo-card-title">
                  {t("Agent Collaboration Volume")}
                </span>
                {topologyMetrics.topEmployees.length > 0 ? (
                  <ul className="imb-graph-topo-list">
                    {topologyMetrics.topEmployees.map((emp) => (
                      <li key={emp.label} className="imb-graph-topo-list-item">
                        <span>{emp.label}</span>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <div className="imb-graph-topo-bar-wrap">
                            <div
                              className="imb-graph-topo-bar-fill"
                              style={{
                                width: `${Math.min((emp.count / Math.max(topologyMetrics.topEmployees[0]?.count || 1, 1)) * 100, 100)}%`,
                              }}
                            />
                          </div>
                          <span style={{ fontSize: 11, minWidth: 20 }}>
                            {emp.count}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="imb-module-note" style={{ margin: 0 }}>
                    {t("No agent collaborations recorded")}
                  </p>
                )}
              </div>

              {/* Tool Invocations Card */}
              <div className="imb-graph-topo-card">
                <span className="imb-graph-topo-card-title">
                  {t("Tool Pipeline Invocations")}
                </span>
                {topologyMetrics.topTools.length > 0 ? (
                  <ul className="imb-graph-topo-list">
                    {topologyMetrics.topTools.map((tool) => (
                      <li key={tool.label} className="imb-graph-topo-list-item">
                        <span>{tool.label}</span>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <div className="imb-graph-topo-bar-wrap">
                            <div
                              className="imb-graph-topo-bar-fill"
                              style={{
                                width: `${Math.min((tool.count / Math.max(topologyMetrics.topTools[0]?.count || 1, 1)) * 100, 100)}%`,
                                background: "#8b5cf6",
                              }}
                            />
                          </div>
                          <span style={{ fontSize: 11, minWidth: 20 }}>
                            {tool.count}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="imb-module-note" style={{ margin: 0 }}>
                    {t("No tool invocations recorded")}
                  </p>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );

  return <ModuleView content={content} />;
}

function kindLabel(kind: GraphNode["kind"]): string {
  switch (kind) {
    case "employee":
      return "Employee";
    case "artifact":
      return "Artifact";
    case "tool":
      return "Tool Capability";
    case "tag":
      return "Tag";
    default:
      return "Conversation";
  }
}
