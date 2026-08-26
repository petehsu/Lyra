import { act, renderHook, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import type {
  AgentModelCatalogSnapshot,
  AgentRuntimeEvent,
  AgentSessionSnapshot
} from "../../../../shared/agent";
import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import { getLocale, setLocale, type Locale } from "../../i18n";
import type { GlobalDialogOpenRequest } from "../../global-dialog";
import { getStreamStore } from "../../agent-session-view-model/stream-store";
import { useLyraAgentDataProvider } from "../use-lyra-agent-data-provider";

const emptyModelCatalog = (): AgentModelCatalogSnapshot => ({
  sessionId: null,
  currentModel: "mimo-v2.5-pro",
  currentProvider: "mimo",
  defaultModel: "mimo-v2.5-pro",
  defaultProvider: "mimo",
  models: [],
  routes: [],
  reasoningEffort: {
    current: null,
    options: [],
    supported: false
  },
  verbosity: {
    current: null,
    options: [],
    supported: false
  },
  serviceTier: {
    current: null,
    options: [],
    supported: false
  }
});

const createSnapshot = (
  overrides: Partial<AgentSessionSnapshot> = {}
): AgentSessionSnapshot => ({
  id: "session-1",
  title: "新会话",
  sessionKind: "normal",
  agentMode: "solo",
  oma: null,
  workingDir: "/Users/petehsu/Documents/Lyra",
  projectBound: true,
  workingDirIsHome: false,
  messages: [],
  tools: [],
  todos: [],
  turnStatus: "idle",
  activeTurnId: null,
  follow: { running: false, activity: null },
  updatedAt: "2026-05-13T00:00:00.000Z",
  ...overrides
});

const createDesktopApi = (snapshot: AgentSessionSnapshot): LyraDesktopApi => ({
  agent: {
    onEvent: vi.fn((_: (event: AgentRuntimeEvent) => void) => () => undefined),
    createSession: vi.fn(async () => snapshot),
    readSession: vi.fn(async () => snapshot),
    listSessions: vi.fn(async () => ({
      sessionsDir: "/tmp/lyra-agent-runtime/sessions",
      sessions: [{ id: snapshot.id }]
    })),
    listAgentModels: vi.fn(async () => emptyModelCatalog()),
    readBrowserFollowMode: vi.fn(async () => ({ enabled: false })),
    updateBrowserFollowMode: vi.fn(async () => ({ enabled: false })),
    readActCache: vi.fn(async () => ({ enabled: false })),
    updateActCache: vi.fn(async () => ({ enabled: false }))
  }
} as unknown as LyraDesktopApi);

describe("useLyraAgentDataProvider", () => {
  let originalLocale: Locale;

  beforeAll(() => {
    originalLocale = getLocale();
    setLocale("en-US");
  });

  afterAll(() => {
    setLocale(originalLocale);
  });

  test("does not resync shell session metadata for streaming text deltas", async () => {
    // Reset the global streamStore to ensure test isolation (it's a singleton).
    getStreamStore().reset("message-1");
    const snapshot = createSnapshot({
      turnStatus: "running",
      activeTurnId: "turn-1",
      follow: { running: true, activity: "calling_model" },
      messages: [{
        id: "message-1",
        role: "assistant",
        text: "Hel",
        createdAt: "2026-05-13T00:00:00.000Z"
      }]
    });
    let listener: ((event: AgentRuntimeEvent) => void) | null = null;
    const desktopApi = createDesktopApi(snapshot);
    vi.mocked(desktopApi.agent!.onEvent).mockImplementation((next) => {
      listener = next;
      return () => {
        listener = null;
      };
    });
    const onActiveSessionChange = vi.fn();
    const onSessionSnapshotChange = vi.fn();

    const { result } = renderHook(() =>
      useLyraAgentDataProvider(
        desktopApi,
        undefined,
        snapshot.id,
        null,
        true,
        { onActiveSessionChange, onSessionSnapshotChange }
      )
    );

    await waitFor(() => {
      expect(result.current.data.messages.at(-1)?.blocks[0]).toMatchObject({
        type: "text",
        body: "Hel"
      });
      expect(onActiveSessionChange).toHaveBeenCalledTimes(1);
      expect(onSessionSnapshotChange).toHaveBeenCalledTimes(1);
    });

    act(() => {
      listener?.({
        kind: "messageDelta",
        sessionId: snapshot.id,
        messageId: "message-1",
        blockId: null,
        delta: "lo"
      });
    });

    // Deltas now go to the external StreamStore (O(1) push, RAF commit),
    // not through the React reducer. The reducer's message text is not
    // updated per-delta — it updates on messageCommitted. The streamStore
    // holds the accumulated text for the streaming view.
    await waitFor(() => {
      expect(onActiveSessionChange).toHaveBeenCalledTimes(1);
      expect(onSessionSnapshotChange).toHaveBeenCalledTimes(1);
    });
    // The streamStore should have accumulated the delta.
    const store = getStreamStore();
    store.flush();
    expect(store.getMessageText("message-1")).toBe("lo");
  });

  test("reports a missing persisted session when readSession rejects", async () => {
    const onMissingSession = vi.fn();
    const readSession = vi.fn<
      (request: { readonly sessionId: string }) => Promise<AgentSessionSnapshot>
    >(async () => {
      throw new Error("session not found");
    });
    const desktopApi = {
      agent: {
        onEvent: vi.fn((_: (event: AgentRuntimeEvent) => void) => () => undefined),
        createSession: vi.fn(),
        readSession,
        listSessions: vi.fn(async () => ({
          sessionsDir: "/tmp/lyra-agent-runtime/sessions",
          sessions: []
        })),
        listAgentModels: vi.fn(async () => emptyModelCatalog()),
        readBrowserFollowMode: vi.fn(async () => ({ enabled: false })),
        updateBrowserFollowMode: vi.fn(async () => ({ enabled: false })),
        readActCache: vi.fn(async () => ({ enabled: false })),
        updateActCache: vi.fn(async () => ({ enabled: false }))
      }
    } as unknown as LyraDesktopApi;

    const { result } = renderHook(() =>
      useLyraAgentDataProvider(
        desktopApi,
        undefined,
        "session-stale",
        null,
        true,
        { onMissingSession }
      )
    );

    await waitFor(() => {
      expect(onMissingSession).toHaveBeenCalledWith("session-stale");
    });

    expect(readSession).toHaveBeenCalledWith({ sessionId: "session-stale" });
    expect(result.current.error).toBeNull();
  });

  test("routes bound project file opens through the project tree", async () => {
    const onOpenFile = vi.fn();
    const onRevealProjectPath = vi.fn();
    const desktopApi = createDesktopApi(createSnapshot());

    const { result } = renderHook(() =>
      useLyraAgentDataProvider(
        desktopApi,
        undefined,
        "session-1",
        null,
        true,
        { onOpenFile, onRevealProjectPath }
      )
    );

    await waitFor(() => {
      expect(result.current.data.session.id).toBe("session-1");
    });

    await act(async () => {
      await result.current.data.openFileInWorkbench("src/App.tsx:42");
    });

    expect(onRevealProjectPath).toHaveBeenCalledWith({
      sessionId: "session-1",
      workingDir: "/Users/petehsu/Documents/Lyra",
      path: "/Users/petehsu/Documents/Lyra/src/App.tsx",
      location: { line: 42 },
      mode: "open-file"
    });
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  test("routes bound project path reveals through the project tree", async () => {
    const onRevealPathInWorkbench = vi.fn();
    const onRevealProjectPath = vi.fn();
    const desktopApi = createDesktopApi(createSnapshot());

    const { result } = renderHook(() =>
      useLyraAgentDataProvider(
        desktopApi,
        undefined,
        "session-1",
        null,
        true,
        { onRevealPathInWorkbench, onRevealProjectPath }
      )
    );

    await waitFor(() => {
      expect(result.current.data.session.id).toBe("session-1");
    });

    await act(async () => {
      await result.current.data.revealPathInWorkbench("src/components");
    });

    expect(onRevealProjectPath).toHaveBeenCalledWith({
      sessionId: "session-1",
      workingDir: "/Users/petehsu/Documents/Lyra",
      path: "/Users/petehsu/Documents/Lyra/src/components",
      mode: "reveal"
    });
    expect(onRevealPathInWorkbench).not.toHaveBeenCalled();
  });

  test("reveals unbound paths in the file manager", async () => {
    const onRevealPathInWorkbench = vi.fn();
    const onRevealProjectPath = vi.fn();
    const desktopApi = createDesktopApi(createSnapshot({
      workingDir: "/Users/petehsu/Documents/Lyra",
      projectBound: false
    }));

    const { result } = renderHook(() =>
      useLyraAgentDataProvider(
        desktopApi,
        undefined,
        "session-1",
        null,
        true,
        { onRevealPathInWorkbench, onRevealProjectPath }
      )
    );

    await waitFor(() => {
      expect(result.current.data.session.id).toBe("session-1");
    });

    await act(async () => {
      await result.current.data.revealPathInWorkbench("src/components");
    });

    expect(onRevealPathInWorkbench).toHaveBeenCalledWith(
      "/Users/petehsu/Documents/Lyra/src/components"
    );
    expect(onRevealProjectPath).not.toHaveBeenCalled();
  });

  test("warns before creating an experimental Oma session", async () => {
    const snapshot = createSnapshot();
    const desktopApi = createDesktopApi(snapshot);
    const openDialog = vi.fn<(request: GlobalDialogOpenRequest) => void>();

    const { result } = renderHook(() =>
      useLyraAgentDataProvider(
        desktopApi,
        undefined,
        snapshot.id,
        null,
        true,
        { openDialog }
      )
    );

    await waitFor(() => {
      expect(result.current.data.session.id).toBe(snapshot.id);
    });

    await act(async () => {
      await result.current.data.createSession("oma");
    });

    expect(openDialog).toHaveBeenCalledTimes(1);
    expect(vi.mocked(desktopApi.agent!.createSession)).not.toHaveBeenCalled();

    const dialog = openDialog.mock.calls[0]![0];
    expect(dialog.title).toBe("Oma is experimental");
    expect(dialog.description).toContain("may be unavailable or unstable");
    expect(dialog.source?.subtitle).toBe("Experimental");

    await act(async () => {
      await dialog.actions?.find((action) => action.id === "create")?.onSelect?.({});
    });

    await waitFor(() => {
      expect(vi.mocked(desktopApi.agent!.createSession)).toHaveBeenCalledWith(
        expect.objectContaining({ agentMode: "oma" })
      );
    });
  });
});
