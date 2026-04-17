import { ipcMain } from "electron";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  LYRA_CHANNELS,
  type WorkbenchStateKey
} from "../../shared/desktop-bridge";

type SyncReply<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

const WORKBENCH_STATE_FILENAMES: Readonly<Record<WorkbenchStateKey, string>> = {
  preferences: "preferences.v1.json",
  "workspace-tabs": "workspace-tabs.v1.json",
  "terminal-dock": "terminal-dock.v1.json",
  notifications: "notifications.v1.json",
  layout: "layout.v1.json"
};

const isWorkbenchStateKey = (value: unknown): value is WorkbenchStateKey =>
  value === "preferences"
  || value === "workspace-tabs"
  || value === "terminal-dock"
  || value === "notifications"
  || value === "layout";

const normalizeKey = (value: unknown): WorkbenchStateKey => {
  if (isWorkbenchStateKey(value) === false) {
    throw new Error(`unknown workbench state key: ${String(value)}`);
  }
  return value;
};

const normalizeJson = (value: unknown): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("workbench-state json payload is required");
  }

  try {
    JSON.parse(value);
  } catch (error) {
    throw new Error(`workbench-state payload must be valid JSON: ${String(error)}`);
  }

  return value;
};

const resolveStateFilePath = (storageRoot: string, key: WorkbenchStateKey): string =>
  path.join(storageRoot, WORKBENCH_STATE_FILENAMES[key]);

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const withSyncReply = <T>(run: () => T): SyncReply<T> => {
  try {
    return {
      ok: true,
      value: run()
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error)
    };
  }
};

export type WorkbenchStateIpcBridge = {
  readonly dispose: () => void;
  readonly readState: (key: WorkbenchStateKey) => string | null;
  readonly subscribe: (
    listener: (event: {
      readonly key: WorkbenchStateKey;
      readonly json: string | null;
    }) => void
  ) => () => void;
};

export const createWorkbenchStateIpcBridge = (
  storageRoot: string
): WorkbenchStateIpcBridge => {
  mkdirSync(storageRoot, { recursive: true });
  const stateListeners = new Set<(
    event: { readonly key: WorkbenchStateKey; readonly json: string | null }
  ) => void>();

  const publish = (key: WorkbenchStateKey, json: string | null): void => {
    for (const listener of stateListeners) {
      listener({ key, json });
    }
  };

  const readState = (key: WorkbenchStateKey): string | null => {
    const filePath = resolveStateFilePath(storageRoot, key);
    try {
      return readFileSync(filePath, "utf8");
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  };

  const listeners: Array<readonly [string, Parameters<typeof ipcMain.on>[1]]> = [
    [
      LYRA_CHANNELS.workbenchStateReadSync,
      (event, payload: unknown) => {
        event.returnValue = withSyncReply(() => {
          const key = normalizeKey((payload as { readonly key?: unknown })?.key);
          return readState(key);
        }) satisfies SyncReply<string | null>;
      }
    ],
    [
      LYRA_CHANNELS.workbenchStateWriteSync,
      (event, payload: unknown) => {
        event.returnValue = withSyncReply(() => {
          const key = normalizeKey((payload as { readonly key?: unknown })?.key);
          const json = normalizeJson((payload as { readonly json?: unknown })?.json);
          const filePath = resolveStateFilePath(storageRoot, key);
          writeFileSync(filePath, json, "utf8");
          publish(key, json);
          return null;
        }) satisfies SyncReply<null>;
      }
    ],
    [
      LYRA_CHANNELS.workbenchStateRemoveSync,
      (event, payload: unknown) => {
        event.returnValue = withSyncReply(() => {
          const key = normalizeKey((payload as { readonly key?: unknown })?.key);
          const filePath = resolveStateFilePath(storageRoot, key);
          rmSync(filePath, { force: true });
          publish(key, null);
          return null;
        }) satisfies SyncReply<null>;
      }
    ]
  ];

  for (const [channel, listener] of listeners) {
    ipcMain.on(channel, listener);
  }

  return {
    readState,
    subscribe: (listener) => {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    },
    dispose: () => {
      stateListeners.clear();
      for (const [channel, listener] of listeners) {
        ipcMain.removeListener(channel, listener);
      }
    }
  };
};
