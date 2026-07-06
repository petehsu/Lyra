import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  AgentModelCatalogSnapshot,
  AgentRuntimeEvent,
  AgentSessionListResponse,
  AgentSessionSnapshot
} from "../../../../shared/agent";
import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
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
    createSession: vi.fn(),
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
  test("removes a stale persisted session before readSession is invoked", async () => {
    const onMissingSession = vi.fn();
    const readSession = vi.fn<
      (request: { readonly sessionId: string }) => Promise<AgentSessionSnapshot>
    >();
    const listSessions = vi.fn<
      () => Promise<AgentSessionListResponse>
    >(async () => ({
      sessionsDir: "/tmp/lyra-agent-runtime/sessions",
      sessions: []
    }));
    const desktopApi = {
      agent: {
        onEvent: vi.fn((_: (event: AgentRuntimeEvent) => void) => () => undefined),
        createSession: vi.fn(),
        readSession,
        listSessions,
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

    expect(listSessions).toHaveBeenCalledWith({});
    expect(readSession).not.toHaveBeenCalled();
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
});
