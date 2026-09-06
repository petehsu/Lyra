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

import type { DownloadManagerTask } from "../../../../shared/download-manager";
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
  updatedAt: createdAt
});

const createRefs = (): FileManagerDownloadRefs => ({
  tasksRef: { current: [] },
  statusRef: { current: "idle" },
  errorMessageRef: { current: undefined }
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
  readSettings: vi.fn(async () => ({})),
  updateSettings: vi.fn(async (settings) => settings),
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
      openDownloadSettings: vi.fn(),
      unsubscribeDirectoryForInstance: vi.fn()
    }));

    await waitFor(() => {
      expect(store.statesRef.current.instance?.downloadStatus).toBe("error");
    });
    expect(store.statesRef.current.instance?.downloadErrorMessage).toBe("Unavailable");
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
      openDownloadSettings: vi.fn(),
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
});