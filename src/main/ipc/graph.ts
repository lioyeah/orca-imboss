import type {
  GraphPayload,
  TaskWorkflowGraph,
  WorkflowDefinition,
} from "@shared/types";
import { ipcMain } from "electron";
import { buildGraph } from "../db/graph";
import { buildTaskWorkflowGraph } from "../db/task-graph";
import {
  deleteWorkflow,
  exportTaskGraphToWorkflow,
  getWorkflow,
  listWorkflows,
  saveWorkflow,
} from "../db/workflows";
import { optimizeWorkflowWithAI } from "../agent/workflow-copilot.ts";

export function registerGraphHandlers(): void {
  // Legacy graph
  ipcMain.handle("graph:get", (): GraphPayload => buildGraph());

  // Unified Metro-Rail Task Graph & Workflow handlers
  ipcMain.handle(
    "graph:getTasks",
    (_event, targetChatId?: number): TaskWorkflowGraph =>
      buildTaskWorkflowGraph(targetChatId),
  );

  ipcMain.handle(
    "graph:listWorkflows",
    (): WorkflowDefinition[] => listWorkflows(),
  );

  ipcMain.handle(
    "graph:getWorkflow",
    (_event, id: string): WorkflowDefinition | null => getWorkflow(id),
  );

  ipcMain.handle(
    "graph:saveWorkflow",
    (_event, wf: WorkflowDefinition): WorkflowDefinition => saveWorkflow(wf),
  );

  ipcMain.handle(
    "graph:deleteWorkflow",
    (_event, id: string): boolean => deleteWorkflow(id),
  );

  ipcMain.handle(
    "graph:exportToWorkflow",
    (_event, graph: TaskWorkflowGraph, title?: string): WorkflowDefinition =>
      exportTaskGraphToWorkflow(graph, title),
  );

  ipcMain.handle(
    "graph:copilotOptimize",
    (
      _event,
      input: { prompt?: string; workflow?: WorkflowDefinition },
    ): Promise<WorkflowDefinition> => optimizeWorkflowWithAI(input),
  );
}
