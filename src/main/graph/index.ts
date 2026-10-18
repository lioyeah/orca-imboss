/**
 * Graph-as-Infrastructure: Backend Subsystem
 *
 * Exposes causal DAG traversal, context injection, artifact registries,
 * and collaborator routing for runtime agent sessions.
 */

export * from "./artifact-registry";
export * from "./causal-context";
export * from "./collaborator-topology";
export { buildGraph } from "../db/graph";
