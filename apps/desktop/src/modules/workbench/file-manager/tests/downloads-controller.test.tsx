import {
  act,
  renderHook,
  waitFor
} from "@testing-library/react";
import {
  describe,
  expect,
  test,
  vi
} from "vitest";

import type {
  DownloadManagerRemoteApiStatus,
  DownloadManagerSettings,
  DownloadManagerTask
} from "../../../../shared/download-manager";
import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import type {
  FileManagerAppState,
  FileManagerSurfaceLabels
} from "../types";
import {
  type FileManagerDownloadRefs,
  useFileManagerDownloadsController
} from "../downloads-controller";
import { createInitialState } from "../state-model";
import type { FileManagerStateStore } from "../state-store";

const labels = {
  title: "Files",
  downloadManagerTitle: "Downloads",
  unavailable: "Unavailable"
} as FileManagerSurfaceLabels;

const createTask = (id: string, createdAt: string): DownloadManagerTask => ({
  id,
  url: `https://example.test/${id}.zip`,
  fileName: `${id}.zip`,
  savePath: `/tmp/${id}.zip`,
  directory: "/tmp",
  protocol: "https",
  source: "manual",
  state: "queued",
  receivedBytes: 0,
  totalBytes: 0,
  speedBytesPerSecond: 0,
  priority: "normal",
  connectionsRequested: 1,
  connectionsActive: 0,
  canResume: false,
  createdAt,
  updatedAt: createdAt,
  tags: []
});

const createRefs = (): FileManagerDownloadRefs => ({
  tasksRef: { current: [] },
  statusRef: { current: "idle" },
  errorMessageRef: { current: undefined },
  settingsRef: { current: null },
  remoteApiStatusRef: { current: null }
});

const createStore = (
  initialStates: Record<string, FileManagerAppState>
): FileManagerStateStore => {
  const statesRef = { current: initialStates };
  const createState = vi.fn((instanceId: string) => createInitialState(instanceId, labels));
  const updateStates = vi.fn((
    updater: (
      current: Record<string, FileManagerAppState>
    ) => Record<string, FileManagerAppState>
  ) => {
    statesRef.current = updater(statesRef.current);
  });
  const patchState = vi.fn((instanceId: string, updater: (state: FileManagerAppState) => FileManagerAppState) => {
    updateStates((current) => {
      const base = current[instanceId] ?? createState(instanceId);
      return {
        ...current,
        [instanceId]: updater(base)
      };
    });
  });
  const replaceState = vi.fn((instanceId: string, nextState: FileManagerAppState) => {
    updateStates((current) => ({
      ...current,
      [instanceId]: nextState
    }));
  });

  return {
    statesRef,
    createState,
    updateStates,
    patchState,
    replaceState,
    createInstance: vi.fn(),
    ensureInstance: vi.fn(),
    getState: vi.fn(),
    syncExternalInstances: vi.fn(),
    syncTabInstances: vi.fn()
  } as unknown as FileManagerStateStore;
};

const createDownloadsApi = (overrides: Partial<NonNullable<LyraDesktopApi["downloads"]>> = {}) => ({
  list: vi.fn(async () => ({ tasks: [] })),
  enqueue: vi.fn(async () => ({ tasks: [createTask("task-1", "2026-01-01T00:00:00.000Z")] })),
  importExternalBrowser: vi.fn(async () => ({ tasks: [] })),
  pause: vi.fn(async () => undefined),
  resume: vi.fn(async () => undefined),
  cancel: vi.fn(async () => undefined),
  retry: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
  setPriority: vi.fn(async () => undefined),
  pauseAll: vi.fn(async () => ({ tasks: [] })),
  resumeAll: vi.fn(async () => ({ tasks: [] })),
  cancelAll: vi.fn(async () => ({ tasks: [] })),
  openFile: vi.fn(async () => undefined),
  revealFile: vi.fn(async () => undefined),
  readSettings: vi.fn(async () => null as unknown as DownloadManagerSettings),
  updateSettings: vi.fn(async (settings) => settings as unknown as DownloadManagerSettings),
  readRemoteApiStatus: vi.fn(async () => null as unknown as DownloadManagerRemoteApiStatus),
  startRemoteApi: vi.fn(async () => ({
    running: true,
    host: "127.0.0.1",
    port: 6800,
    baseUrl: "http://127.0.0.1:6800",
    token: "token"
  })),
  stopRemoteApi: vi.fn(async () => ({
    running: false,
    host: "127.0.0.1",
    port: null,
    baseUrl: null,
    token: ""
  })),
  onEvent: vi.fn(() => () => undefined),
  ...overrides
});

describe("file manager downloads controller", () => {
  test("marks downloads unavailable when the downloads API is missing", async () => {
    const store = createStore({
      instance: createInitialState("instance", labels)
    });
    const refs = createRefs();

    renderHook(() => useFileManagerDownloadsController({
      desktopApi: null,
      labels,
      store,
      refs,
      unsubscribeDirectoryForInstance: vi.fn()
    }));

    await waitFor(() => {
      expect(store.statesRef.current.instance?.downloadStatus).toBe("error");
    });
    expect(store.statesRef.current.instance?.downloadErrorMessage).toBe("Unavailable");
    expect(store.statesRef.current.instance?.downloadSettingsErrorMessage).toBe("Unavailable");
  });

  test("submits trimmed download text and broadcasts returned tasks", async () => {
    const store = createStore({
      instance: createInitialState("instance", labels)
    });
    const refs = createRefs();
    const downloads = createDownloadsApi();
    const desktopApi = { downloads } as unknown as LyraDesktopApi;

    const { result } = renderHook(() => useFileManagerDownloadsController({
      desktopApi,
      labels,
      store,
      refs,
      unsubscribeDirectoryForInstance: vi.fn()
    }));

    await waitFor(() => {
      expect(store.statesRef.current.instance?.downloadStatus).toBe("ready");
    });

    await act(async () => {
      await result.current.submitDownloadText("instance", "  https://example.test/file.zip  ");
    });

    expect(downloads.enqueue).toHaveBeenCalledWith({
      text: "https://example.test/file.zip"
    });
    expect(refs.tasksRef.current.map((task) => task.id)).toEqual(["task-1"]);
    expect(store.statesRef.current.instance?.downloadTasks.map((task) => task.id)).toEqual(["task-1"]);
    expect(store.statesRef.current.instance?.downloadUrlDraft).toBe("");
  });

  test("keeps remote API port validation errors on the settings draft", async () => {
    const store = createStore({
      instance: createInitialState("instance", labels)
    });
    const refs = createRefs();
    const downloads = createDownloadsApi();
    const desktopApi = { downloads } as unknown as LyraDesktopApi;

    const { result } = renderHook(() => useFileManagerDownloadsController({
      desktopApi,
      labels,
      store,
      refs,
      unsubscribeDirectoryForInstance: vi.fn()
    }));

    await waitFor(() => {
      expect(store.statesRef.current.instance?.downloadStatus).toBe("ready");
    });
    store.statesRef.current = {
      ...store.statesRef.current,
      instance: {
        ...store.statesRef.current.instance!,
        downloadSettingsDraft: {
          ...store.statesRef.current.instance!.downloadSettingsDraft,
          remotePort: "70000"
        }
      }
    };

    await act(async () => {
      await result.current.startDownloadRemoteApi("instance");
    });

    expect(downloads.startRemoteApi).not.toHaveBeenCalled();
    expect(store.statesRef.current.instance?.downloadSettingsErrorMessage).toBe(
      "Remote API port must be between 0 and 65535."
    );
  });
});
