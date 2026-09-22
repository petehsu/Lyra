import { ipcMain } from "electron";

import { LYRA_CHANNELS, type SqliteInspectResult } from "../../shared/desktop-bridge";
import { inspectSqliteFile } from "./inspect";

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export const createSqliteIpcBridge = (): { readonly dispose: () => void } => {
  ipcMain.handle(LYRA_CHANNELS.sqliteInspect, (_event, payload: unknown): SqliteInspectResult => {
    const record = asRecord(payload);
    const path = record.path;
    if (typeof path !== "string" || path.length === 0) {
      throw new Error("path is required");
    }
    const table = typeof record.table === "string" && record.table.length > 0 ? record.table : undefined;
    return inspectSqliteFile(path, table);
  });

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.sqliteInspect);
    }
  };
};
