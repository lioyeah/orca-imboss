import type { GraphPayload } from "@shared/types";
import { ipcMain } from "electron";
import { buildGraph } from "../db/graph";

export function registerGraphHandlers(): void {
  ipcMain.handle("graph:get", (): GraphPayload => buildGraph());
}
