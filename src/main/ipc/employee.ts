import { ASSISTANT_ID } from "@shared/constants/employees";
import { EMPLOYEE_EXPORT_EXTENSION } from "@shared/constants/employee_transfer";
import { t } from "@shared/l10n";
import type { Employee, EmployeeInput } from "@shared/types";
import { app, ipcMain } from "electron";
import { join } from "path";
import { disposeForEmployee } from "../agent/session-queue";
import { deleteAvatarFiles, saveAvatar } from "../avatars";
import * as cron from "../cron";
import * as dbEmployees from "../db/employees";
import { listByEmployee, unlinkSessionFile } from "../db/sessions";
import {
  defaultEmployeeExportFileName,
  exportEmployeeToFile,
} from "../employee-transfer/export";
import {
  applyEmployeeImport,
  cancelEmployeeImport,
  inspectEmployeeExport,
} from "../employee-transfer/import";
import {
  notifyEmployeesChanged,
  reconcileEmployeeRefsOnRead,
} from "../employee-events";
import { showOpenDialog, showSaveDialog } from "./dialog";
import { assertInteger, assertString, parsePageQuery } from "./helpers";

export function registerEmployeeHandlers(): void {
  // Both list handlers first run one throttled capability-reference self-heal
  // pass: MCP servers / skills / providers can be removed without going through
  // the app (the assistant edits `mcp.json` and `rm -rf`s skill folders by
  // design), so the moment the UI reads the collection is the moment the stored
  // references can be checked against the truth on disk. It only writes when
  // something is actually dangling, is idempotent, and never throws.
  ipcMain.handle("employees:list", () => {
    reconcileEmployeeRefsOnRead();
    return dbEmployees.listEmployees();
  });

  ipcMain.handle("employees:listPage", (_event, page: unknown) => {
    reconcileEmployeeRefsOnRead();
    return dbEmployees.listEmployeesPage(parsePageQuery(page));
  });

  ipcMain.handle(
    "employees:create",
    (_event, input: EmployeeInput): Employee => {
      const employee = dbEmployees.createEmployee(input);
      notifyEmployeesChanged([employee.id]);
      return employee;
    },
  );

  ipcMain.handle(
    "employees:update",
    (_event, id: unknown, input: EmployeeInput) => {
      const safeId = assertInteger(id, "employee id");
      const employee = dbEmployees.updateEmployee(safeId, input);
      if (employee) notifyEmployeesChanged([safeId]);
      return employee;
    },
  );

  ipcMain.handle("employees:delete", async (_event, id: unknown) => {
    const safeId = assertInteger(id, "employee id");
    // Capture disk session file paths BEFORE the FK cascade wipes the rows.
    const records = listByEmployee(safeId);
    // Tear down any warm agent sessions for this employee first.
    await disposeForEmployee(safeId);
    const result = dbEmployees.deleteEmployee(safeId);
    // Only a hard delete removes disk artifacts; a soft delete (employee still
    // a chat participant) keeps the session/avatar state intact.
    if (result === "deleted") {
      // The `cron_jobs.employee_id` FK cascade removed the rows, but the live
      // in-process Cron handles must be stopped explicitly.
      cron.stopJobsForEmployee(safeId);
      await Promise.all(records.map((r) => unlinkSessionFile(r.session)));
      deleteAvatarFiles(safeId);
    }
    notifyEmployeesChanged([safeId]);
    return result;
  });

  ipcMain.handle(
    "employees:updateAvatar",
    (_event, id: unknown, ext: unknown, data: unknown) => {
      const safeId = assertInteger(id, "employee id");
      const safeExt = assertString(ext, "ext");
      if (!(data instanceof Uint8Array)) {
        throw new Error("Avatar data must be bytes.");
      }
      const path = saveAvatar(safeId, safeExt, Buffer.from(data));
      const employee = dbEmployees.updateEmployeeAvatar(safeId, path);
      if (employee) notifyEmployeesChanged([safeId]);
      return employee;
    },
  );

  // --- export / import (one employee per zip) ----------------------------

  ipcMain.handle("employees:export", async (_event, id: unknown) => {
    const safeId = assertInteger(id, "employee id");
    // Defence in depth: the renderer never offers this for the assistant, and
    // main refuses it too (id 0 can only ever come back as a copy).
    if (safeId === ASSISTANT_ID) {
      throw new Error(t("The built-in assistant cannot be exported."));
    }
    const employee = dbEmployees.getEmployee(safeId);
    if (!employee) throw new Error(t("Employee not found."));
    const destination = await showSaveDialog({
      title: t("Export employee"),
      defaultPath: join(
        app.getPath("downloads"),
        defaultEmployeeExportFileName(employee),
      ),
      filters: [
        {
          name: t("imboss employee export"),
          extensions: [EMPLOYEE_EXPORT_EXTENSION],
        },
        { name: t("All files"), extensions: ["*"] },
      ],
    });
    if (destination === null) return null;
    return exportEmployeeToFile(employee, destination);
  });

  ipcMain.handle("employees:importInspect", async () => {
    const paths = await showOpenDialog({
      title: t("Import employee"),
      properties: ["openFile"],
      filters: [
        {
          name: t("imboss employee export"),
          extensions: [EMPLOYEE_EXPORT_EXTENSION],
        },
        { name: t("All files"), extensions: ["*"] },
      ],
    });
    if (paths === null) return null;
    return inspectEmployeeExport(paths[0]);
  });

  ipcMain.handle(
    "employees:importApply",
    (_event, token: unknown, options: unknown) => {
      const safeToken = assertString(token, "import token");
      const overwrite =
        typeof options === "object" &&
        options !== null &&
        (options as Record<string, unknown>)["overwrite"] === true;
      return applyEmployeeImport(safeToken, { overwrite });
    },
  );

  ipcMain.handle("employees:importCancel", (_event, token: unknown) => {
    cancelEmployeeImport(assertString(token, "import token"));
  });

  ipcMain.handle("employees:profileExtra", (_event, id: unknown) => {
    const safeId = assertInteger(id, "employee id");
    return dbEmployees.getEmployeeProfileExtra(safeId);
  });
}
