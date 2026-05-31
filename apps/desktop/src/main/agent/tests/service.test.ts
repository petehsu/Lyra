import { beforeEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => unknown;
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      })
    }
  };
});

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain
}));

import { LYRA_CHANNELS } from "../../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../../runtime-client";
import { WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID } from "../../workbench-browser/types";
import type { WorkbenchObservationService } from "../../workbench-observation/types";
import { createAgentIpcBridge } from "../service";

type RuntimeListener = (event: string, payload: unknown) => void;

describe("Agent IPC bridge", () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.ipcMain.handle.mockClear();
    electronMock.ipcMain.removeHandler.mockClear();
  });

  test("forwards Agent IPC channels to runtime methods", async () => {
    const request = vi.fn(async (method: string, payload: unknown) => ({ method, payload }));
    const bridge = createAgentIpcBridge({
      runtimeClient: {
        request,
        subscribe: vi.fn(() => vi.fn()),
        registerRequestHandler: vi.fn(),
        unregisterRequestHandler: vi.fn()
      } as unknown as LyraRuntimeClient,
      storageRoot: "/tmp/lyra-agent-test",
      getWindow: () => null,
      getBrowserBridge: () => null,
      getWorkbenchObservationService: () => null
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentSessionCreate)?.({}, { title: "Agent" })
    ).resolves.toEqual({
      method: "agent.session.create",
      payload: { title: "Agent" }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentTurnSend)?.({}, {
        sessionId: "session-1",
        text: "hello"
      })
    ).resolves.toEqual({
      method: "agent.turn.send",
      payload: {
        sessionId: "session-1",
        text: "hello"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentTurnCancel)?.({}, { sessionId: "session-1" })
    ).resolves.toEqual({
      method: "agent.turn.cancel",
      payload: { sessionId: "session-1" }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentRollbackPreview)?.({}, {
        sessionId: "session-1",
        messageId: "message-1"
      })
    ).resolves.toEqual({
      method: "agent.rollback.preview",
      payload: {
        sessionId: "session-1",
        messageId: "message-1"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentRollbackRestore)?.({}, {
        sessionId: "session-1",
        messageId: "message-1",
        mode: "taskAndWorkspace"
      })
    ).resolves.toEqual({
      method: "agent.rollback.restore",
      payload: {
        sessionId: "session-1",
        messageId: "message-1",
        mode: "taskAndWorkspace"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentSessionSave)?.({}, {
        sessionId: "session-1",
        label: null
      })
    ).resolves.toEqual({
      method: "agent.session.save",
      payload: {
        sessionId: "session-1",
        label: null
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentSessionRename)?.({}, {
        sessionId: "session-1",
        title: "Planning"
      })
    ).resolves.toEqual({
      method: "agent.session.rename",
      payload: {
        sessionId: "session-1",
        title: "Planning"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentSessionArchive)?.({}, {
        sessionId: "session-1",
        archived: true
      })
    ).resolves.toEqual({
      method: "agent.session.archive",
      payload: {
        sessionId: "session-1",
        archived: true
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentSessionDelete)?.({}, {
        sessionId: "session-1"
      })
    ).resolves.toEqual({
      method: "agent.session.delete",
      payload: {
        sessionId: "session-1"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentSessionBindProject)?.({}, {
        sessionId: "session-1",
        workingDir: "/Users/petehsu/Documents/Lyra"
      })
    ).resolves.toEqual({
      method: "agent.session.bindProject",
      payload: {
        sessionId: "session-1",
        workingDir: "/Users/petehsu/Documents/Lyra"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentModelsList)?.({}, { sessionId: "session-1" })
    ).resolves.toEqual({
      method: "agent.models.list",
      payload: { sessionId: "session-1" }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentModelSwitch)?.({}, {
        sessionId: "session-1",
        model: "gpt-5"
      })
    ).resolves.toEqual({
      method: "agent.models.switch",
      payload: {
        sessionId: "session-1",
        model: "gpt-5"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentProviderOptionsUpdate)?.({}, {
        sessionId: "session-1",
        reasoningEffort: "high"
      })
    ).resolves.toEqual({
      method: "agent.provider.options.update",
      payload: {
        sessionId: "session-1",
        reasoningEffort: "high"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentImproveRun)?.({}, {
        sessionId: "session-1",
        planOnly: false
      })
    ).resolves.toEqual({
      method: "agent.action.improve",
      payload: {
        sessionId: "session-1",
        planOnly: false
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentRefactorRun)?.({}, {
        sessionId: "session-1",
        planOnly: true
      })
    ).resolves.toEqual({
      method: "agent.action.refactor",
      payload: {
        sessionId: "session-1",
        planOnly: true
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentPokeTrigger)?.({}, {
        sessionId: "session-1"
      })
    ).resolves.toEqual({
      method: "agent.action.poke",
      payload: {
        sessionId: "session-1"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentReviewRun)?.({}, {
        sessionId: "session-1"
      })
    ).resolves.toEqual({
      method: "agent.action.review",
      payload: {
        sessionId: "session-1"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentJudgeRun)?.({}, {
        sessionId: "session-1"
      })
    ).resolves.toEqual({
      method: "agent.action.judge",
      payload: {
        sessionId: "session-1"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentOvernightStart)?.({}, {
        sessionId: "session-1",
        durationMinutes: 240,
        mission: "Stabilize tests",
        inheritContext: true
      })
    ).resolves.toEqual({
      method: "agent.overnight.start",
      payload: {
        sessionId: "session-1",
        durationMinutes: 240,
        mission: "Stabilize tests",
        inheritContext: true
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentOvernightStatus)?.({}, {
        runId: "overnight-1"
      })
    ).resolves.toEqual({
      method: "agent.overnight.status",
      payload: {
        runId: "overnight-1"
      }
    });
    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentClarificationRespond)?.({}, {
        sessionId: "session-1",
        clarificationId: "clar-1",
        answer: "Use the compact version",
        selectedOption: "Compact"
      })
    ).resolves.toEqual({
      method: "agent.clarification.respond",
      payload: {
        sessionId: "session-1",
        clarificationId: "clar-1",
        answer: "Use the compact version",
        selectedOption: "Compact"
      }
    });

    bridge.dispose();
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.agentSessionCreate);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.agentTurnCancel);
    expect(electronMock.ipcMain.removeHandler).toHaveBeenCalledWith(LYRA_CHANNELS.agentRollbackPreview);
  });

  test("forwards runtime Agent events to the renderer", () => {
    let runtimeListener: RuntimeListener | null = null;
    const unsubscribe = vi.fn();
    const send = vi.fn();
    const bridge = createAgentIpcBridge({
      runtimeClient: {
        request: vi.fn(),
        subscribe: vi.fn((listener) => {
          runtimeListener = listener;
          return unsubscribe;
        }),
        registerRequestHandler: vi.fn(),
        unregisterRequestHandler: vi.fn()
      } as unknown as LyraRuntimeClient,
      storageRoot: "/tmp/lyra-agent-test",
      getWindow: () => ({
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send
        }
      }) as never,
      getBrowserBridge: () => null,
      getWorkbenchObservationService: () => null
    });

    expect(runtimeListener).not.toBeNull();
    const listener = runtimeListener as unknown as RuntimeListener;
    listener("agent.runtime", {
      kind: "followStateChanged",
      sessionId: "session-1",
      follow: { running: true, activity: "Running" }
    });
    expect(send).toHaveBeenCalledWith(LYRA_CHANNELS.agentEvent, {
      kind: "followStateChanged",
      sessionId: "session-1",
      follow: { running: true, activity: "Running" }
    });

    bridge.dispose();
    expect(unsubscribe).toHaveBeenCalled();
  });

  test("registers Workbench observation host capability handlers", async () => {
    const registered = new Map<string, (payload: unknown) => unknown>();
    const tabs = {
      activeTabId: "settings-1",
      visibleTabIds: ["settings-1"],
      tabs: [
        {
          tabId: "settings-1",
          title: "Settings",
          pageKind: "settings",
          active: true,
          visible: true,
          focusedPane: true,
          observable: false
        }
      ]
    };
    const observationService = {
      dispose: vi.fn(),
      listTabs: vi.fn(async () => tabs),
      readTab: vi.fn(async () => ({
        tab: tabs.tabs[0],
        observation: {
          kind: "tab-summary",
          title: "Settings",
          pageKind: "settings",
          active: true,
          visible: true,
          focusedPane: true,
          observable: false,
          reason: "Observation is unsupported for settings."
        }
      })),
      readWorkspace: vi.fn(async () => ({
        layoutMode: "single",
        activeTabId: "settings-1",
        focusedTabId: "settings-1",
        visibleTabs: []
      })),
      extractTabText: vi.fn(async () => ({
        tabId: "settings-1",
        scope: "main",
        text: "settings",
        truncated: false,
        startChar: 0,
        endChar: 8,
        totalChars: 8,
        hasMore: false,
        extractionMethod: "test"
      })),
      activateTab: vi.fn(async () => ({
        tabId: "settings-1",
        activeTabId: "settings-1"
      })),
      captureVisual: vi.fn()
    } as unknown as WorkbenchObservationService;

    const bridge = createAgentIpcBridge({
      runtimeClient: {
        request: vi.fn(),
        subscribe: vi.fn(() => vi.fn()),
        registerRequestHandler: vi.fn((method, handler) => {
          registered.set(method, handler);
        }),
        unregisterRequestHandler: vi.fn()
      } as unknown as LyraRuntimeClient,
      storageRoot: "/tmp/lyra-agent-test",
      getWindow: () => null,
      getBrowserBridge: () => null,
      getWorkbenchObservationService: () => observationService
    });

    await expect(registered.get("workbench.listTabs")?.({ scope: "visible" })).resolves.toBe(tabs);
    expect(observationService.listTabs).toHaveBeenLastCalledWith({
      scope: "visible",
      includeUnsupported: true
    });
    await expect(registered.get("workbench.readTab")?.({ tabId: "settings-1" })).resolves.toEqual({
      tab: tabs.tabs[0],
      observation: expect.objectContaining({ kind: "tab-summary" })
    });
    await expect(registered.get("workbench.readWorkspace")?.({ detail: "summary" })).resolves.toEqual({
      layoutMode: "single",
      activeTabId: "settings-1",
      focusedTabId: "settings-1",
      visibleTabs: []
    });
    await expect(registered.get("workbench.extractTabText")?.({ tabId: "settings-1" })).resolves.toEqual(
      expect.objectContaining({ text: "settings" })
    );
    await expect(registered.get("workbench.activateTab")?.({ tabId: "settings-1" })).resolves.toEqual({
      tabId: "settings-1",
      activeTabId: "settings-1"
    });

    bridge.dispose();
  });

  test("normalizes short Workbench tab ids before reading renderer tabs", async () => {
    const registered = new Map<string, (payload: unknown) => unknown>();
    const imageTab = {
      tabId: "browser-tab-35",
      title: "ChatGPT Image 2026年5月10日 00_10_01.png",
      pageKind: "app",
      appId: "image-viewer",
      active: true,
      visible: true,
      focusedPane: true,
      observable: true,
      observationKind: "image-viewer"
    };
    const tabs = {
      activeTabId: "browser-tab-35",
      visibleTabIds: ["browser-tab-35"],
      tabs: [imageTab]
    };
    const observationService = {
      dispose: vi.fn(),
      listTabs: vi.fn(async () => tabs),
      readTab: vi.fn(async (request: { readonly tabId: string }) => ({
        tab: imageTab,
        observation: {
          kind: "image-viewer",
          filePath: "/Users/petehsu/Pictures/ChatGPT Image 2026年5月10日 00_10_01.png",
          title: imageTab.title,
          status: "ready",
          levels: [],
          viewport: {
            zoom: 1,
            offsetX: 0,
            offsetY: 0,
            rotation: 0,
            background: "checkerboard"
          },
          siblingIndex: 0,
          siblingCount: 1,
          truncated: false,
          request
        }
      })),
      readWorkspace: vi.fn(),
      extractTabText: vi.fn(async (request: { readonly tabId: string }) => ({
        tabId: request.tabId,
        scope: "main",
        text: "image metadata",
        truncated: false,
        startChar: 0,
        endChar: 14,
        totalChars: 14,
        hasMore: false,
        extractionMethod: "structured:image-viewer"
      })),
      captureVisual: vi.fn()
    } as unknown as WorkbenchObservationService;

    const bridge = createAgentIpcBridge({
      runtimeClient: {
        request: vi.fn(),
        subscribe: vi.fn(() => vi.fn()),
        registerRequestHandler: vi.fn((method, handler) => {
          registered.set(method, handler);
        }),
        unregisterRequestHandler: vi.fn()
      } as unknown as LyraRuntimeClient,
      storageRoot: "/tmp/lyra-agent-test",
      getWindow: () => null,
      getBrowserBridge: () => null,
      getWorkbenchObservationService: () => observationService
    });

    await expect(registered.get("workbench.readTab")?.({ tabId: "35" })).resolves.toEqual(
      expect.objectContaining({ tab: imageTab })
    );
    expect(observationService.readTab).toHaveBeenLastCalledWith(
      expect.objectContaining({ tabId: "browser-tab-35" })
    );

    await expect(registered.get("workbench.extractTabText")?.({ tabId: "35" })).resolves.toEqual(
      expect.objectContaining({ tabId: "browser-tab-35" })
    );
    expect(observationService.extractTabText).toHaveBeenLastCalledWith(
      expect.objectContaining({ tabId: "browser-tab-35" })
    );

    bridge.dispose();
  });

  test("registers browser session recovery host capabilities", async () => {
    const registered = new Map<string, (payload: unknown) => unknown>();
    const snapshot = {
      schemaVersion: 1,
      snapshotId: "browser-session-1",
      activeTabId: "browser-tab-1",
      capturedAt: 100,
      tabs: [],
      storageState: {
        schemaVersion: 1,
        profileId: "lyra-browser-live",
        profileMode: "live",
        profilePartition: "persist:lyra-browser-live",
        persistence: "chromium-profile",
        cookies: { availability: "available", manifestOnly: true, count: 2 }
      },
      recoveryAnchor: {
        schemaVersion: 1,
        tabId: "browser-tab-1",
        address: "https://example.com/app",
        title: "Example App",
        targetRef: "lumen:stable-target",
        storageStateRef: {
          profilePartition: "persist:lyra-browser-live",
          siteOrigin: "https://example.com"
        },
        authState: "possibly_logged_in",
        capturedAt: 100
      }
    };
    const storageState = {
      schemaVersion: 1,
      profileId: "lyra-browser-live",
      profileMode: "live",
      profilePartition: "persist:lyra-browser-live",
      persistence: "chromium-profile"
    };
    const clearResult = {
      ok: true,
      origin: "https://example.com",
      profilePartitions: ["persist:lyra-browser-live"],
      cookiesRemoved: 2,
      storageCleared: true,
      snapshot
    };
    const browserBridge = {
      readSessionSnapshot: vi.fn(() => snapshot),
      readStorageState: vi.fn(async () => storageState),
      clearSiteData: vi.fn(async () => clearResult)
    };

    const bridge = createAgentIpcBridge({
      runtimeClient: {
        request: vi.fn(),
        subscribe: vi.fn(() => vi.fn()),
        registerRequestHandler: vi.fn((method, handler) => {
          registered.set(method, handler);
        }),
        unregisterRequestHandler: vi.fn()
      } as unknown as LyraRuntimeClient,
      storageRoot: "/tmp/lyra-agent-test",
      getWindow: () => null,
      getBrowserBridge: () => browserBridge as never,
      getWorkbenchObservationService: () => null
    });

    expect(registered.get("workbench.browser.readSessionSnapshot")?.({})).toBe(snapshot);
    await expect(
      registered.get("workbench.browser.readStorageState")?.({ origin: "https://example.com" })
    ).resolves.toBe(storageState);
    expect(browserBridge.readStorageState).toHaveBeenLastCalledWith({
      origin: "https://example.com"
    });
    await expect(
      registered.get("workbench.browser.clearSiteData")?.({ origin: "https://example.com" })
    ).resolves.toBe(clearResult);
    expect(browserBridge.clearSiteData).toHaveBeenLastCalledWith({
      origin: "https://example.com"
    });

    bridge.dispose();
  });

  test("lyraLumen map uses page tabs and legacy browser handlers are not registered", async () => {
    const registered = new Map<string, (payload: unknown) => unknown>();
    const tabs = {
      activeTabId: "page-1",
      visibleTabIds: ["page-1"],
      tabs: [
        {
          tabId: "page-1",
          title: "Example",
          pageKind: "page",
          active: true,
          visible: true,
          focusedPane: true,
          observable: true,
          observationKind: "page"
        }
      ]
    };
    const observationService = {
      dispose: vi.fn(),
      listTabs: vi.fn(async () => tabs),
      readWorkspace: vi.fn(),
      extractTabText: vi.fn(),
      readTab: vi.fn(),
      captureVisual: vi.fn()
    } as unknown as WorkbenchObservationService;
    const browserBridge = {
      readActiveTabId: vi.fn(() => "page-1"),
      observeAgentPage: vi.fn(async (
        _tabId: string,
        request: { readonly targetMode?: "isolated" | "live" }
      ) => ({
        ok: true,
        kind: "lyraLumenMap",
        tabId: "page-1",
        targetMode: request.targetMode ?? "live",
        observationId: "obs-1",
        strategy: "picker",
        url: "https://example.com",
        title: "Example",
        elements: [] as Array<Record<string, unknown>>,
        activeElementId: null,
        focusOrder: [] as number[]
      })),
      actOnAgentElement: vi.fn(async (
        _tabId: string,
        request: {
          readonly elementId?: number;
          readonly targetRef?: string;
          readonly targetMode?: "isolated" | "live";
        }
      ) => ({
        ok: true,
        kind: "lyraLumenActionResult",
        tabId: "page-1",
        inputMode: "chromium",
        targetMode: request.targetMode ?? "live",
        ...(request.elementId === undefined ? {} : { elementId: request.elementId }),
        ...(request.targetRef === undefined ? {} : { targetRef: request.targetRef }),
        x: 40,
        y: 50
      })),
      actOnAgentPoint: vi.fn(async (
        _tabId: string,
        request: { readonly targetMode?: "isolated" | "live" }
      ) => ({
        ok: true,
        kind: "lyraLumenActionResult",
        tabId: "page-1",
        inputMode: "chromium",
        targetMode: request.targetMode ?? "live",
        x: 12,
        y: 34
      })),
      focusAgentPage: vi.fn(async (
        _tabId: string,
        request: { readonly targetMode?: "isolated" | "live" }
      ) => ({
        ok: true,
        kind: "lyraLumenFocusResult",
        tabId: "page-1",
        inputMode: "chromium",
        targetMode: request.targetMode ?? "live",
        direction: "scan",
        steps: 3,
        activeElementId: 2,
        focusTrail: [
          { step: 1, elementId: 1, label: "Search" },
          { step: 2, elementId: 2, label: "Submit" }
        ]
      })),
      typeIntoAgentElement: vi.fn(async (
        _tabId: string,
        request: { readonly targetMode?: "isolated" | "live" }
      ) => ({
        ok: true,
        kind: "lyraLumenActionResult",
        tabId: "page-1",
        inputMode: "chromium",
        targetMode: request.targetMode ?? "live",
        message: "Typed into the focused element with Chromium virtual keyboard."
      })),
      pressAgentKey: vi.fn(async (
        _tabId: string,
        request: { readonly targetMode?: "isolated" | "live" }
      ) => ({
        ok: true,
        kind: "lyraLumenActionResult",
        tabId: "page-1",
        inputMode: "chromium",
        targetMode: request.targetMode ?? "live",
        message: "Pressed Enter with Chromium virtual keyboard."
      })),
      readAgentPage: vi.fn(async (
        _tabId: string,
        request: { readonly targetMode?: "isolated" | "live" }
      ) => ({
        tabId: "page-1",
        targetMode: request.targetMode ?? "live",
        scope: "main",
        text: "recent page tail",
        content: "recent page tail",
        truncated: false,
        startChar: 0,
        endChar: 16,
        totalChars: 16,
        hasMore: false,
        extractionMethod: "lumen:recent-text-tail"
      })),
      captureAgentPage: vi.fn(async (
        _tabId: string,
        request: { readonly targetMode?: "isolated" | "live" }
      ) => ({
        tabId: "page-1",
        targetMode: request.targetMode ?? "live",
        mimeType: "image/png",
        imageBase64: "aGVsbG8=",
        width: 320,
        height: 180,
        visibleOnly: true
      })),
      showAgentActivity: vi.fn(async (
        _tabId: string,
        request: { readonly action: "wait"; readonly targetMode?: "isolated" | "live" }
      ) => ({
        tabId: "page-1",
        targetMode: request.targetMode ?? "live",
        action: request.action
      })),
      navigate: vi.fn(async () => ({
        address: "https://example.com/docs",
        tabId: null,
        title: "Docs"
      })),
      navigateAgentPage: vi.fn(async (
        _tabId: string,
        request: { readonly targetMode?: "isolated" | "live" }
      ) => ({
        address: "https://example.com/docs",
        tabId: "page-1",
        title: "Docs",
        targetMode: request.targetMode ?? "live"
      })),
      readAgentFollowAudit: vi.fn(async () => ({
        ok: true,
        kind: "lyraLumenFollowAudit",
        tabId: "page-1",
        targetMode: "live",
        sessionId: "follow-1",
        turnId: "turn-1",
        startedAt: 100,
        endedAt: null,
        updatedAt: 200,
        status: "running",
        reason: null,
        totalActions: 2,
        actions: [],
        compactSummary: {
          observeCount: 1,
          readCount: 0,
          captureCount: 0,
          waitCount: 0,
          navigationCount: 0,
          focusCount: 0,
          pointerCount: 1,
          typeCount: 0,
          keyCount: 0,
          revealCount: 0,
          elevateCount: 0,
          interruptedCount: 0
        },
        compactText: "observe -> act",
        chunks: []
      })),
      explainAgentTargetRef: vi.fn(async () => ({
        ok: true,
        kind: "lyraLumenTargetExplanation",
        tabId: "page-1",
        targetMode: "live",
        targetRef: "lumen:stable-target",
        available: true,
        lastSeenAt: 200,
        recommendedAction: "lyra_lumen.act"
      })),
      auditAgentPageDiagnostics: vi.fn(async () => ({
        ok: true,
        kind: "lyraLumenPageDiagnostics",
        tabId: "page-1",
        targetMode: "live",
        address: "https://example.com",
        title: "Example",
        entries: [],
        summary: {
          errors: 0,
          warnings: 0,
          networkFailures: 0,
          consoleErrors: 0
        }
      })),
      elevateAgentPage: vi.fn(async () => ({
        ok: true,
        kind: "lyraLumenElevation",
        tabId: "page-1",
        targetMode: "isolated",
        address: "https://example.com/login",
        title: "Login",
        userActionRequired: true,
        message: "visible tab requested"
      })),
      completeElevationSession: vi.fn(async () => ({
        ok: true,
        kind: "lyraLumenElevationCompletion",
        tabId: "page-1",
        targetMode: "isolated",
        liveTabId: "browser-elevated-1",
        address: "https://example.com/app",
        title: "App",
        verified: true,
        message: "verified"
      })),
      resolveSharedControlDecision: vi.fn(async () => ({
        ok: true,
        tabId: "page-1",
        decision: "continue_agent"
      })),
      finishAgentFollowSessions: vi.fn()
    };

    const bridge = createAgentIpcBridge({
      runtimeClient: {
        request: vi.fn(),
        subscribe: vi.fn(() => vi.fn()),
        registerRequestHandler: vi.fn((method, handler) => {
          registered.set(method, handler);
        }),
        unregisterRequestHandler: vi.fn()
      } as unknown as LyraRuntimeClient,
      storageRoot: "/tmp/lyra-agent-test",
      getWindow: () => null,
      getBrowserBridge: () => browserBridge as never,
      getWorkbenchObservationService: () => observationService
    });

    expect(registered.has("browser.listTabs")).toBe(false);
    expect(registered.has("browser.click")).toBe(false);
    expect(registered.has("browserAgent.observe")).toBe(false);
    expect(registered.has("lyraLumen.map")).toBe(true);

    await expect(registered.get("lyraLumen.map")?.({})).resolves.toMatchObject({
      kind: "lyraLumenMap",
      tabId: "page-1",
      observationId: "obs-1"
    });
    expect(observationService.listTabs).toHaveBeenLastCalledWith({
      scope: "all",
      includeUnsupported: true
    });
    expect(browserBridge.observeAgentPage).toHaveBeenCalledWith("page-1", {
      strategy: "picker",
      targetMode: "live"
    });

    expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentBrowserFollowRead)?.({})
    ).toEqual({
      enabled: false
    });
    expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentBrowserFollowUpdate)?.({}, { enabled: true })
    ).toEqual({
      enabled: true
    });
    browserBridge.observeAgentPage.mockClear();
    await expect(registered.get("lyraLumen.map")?.({})).resolves.toMatchObject({
      kind: "lyraLumenMap"
    });
    expect(browserBridge.observeAgentPage).toHaveBeenLastCalledWith("page-1", {
      strategy: "picker",
      targetMode: "live",
      visibleFollow: true
    });
    browserBridge.observeAgentPage.mockClear();
    await expect(registered.get("lyraLumen.map")?.({ target: "isolated" })).resolves.toMatchObject({
      kind: "lyraLumenMap"
    });
    expect(browserBridge.observeAgentPage).toHaveBeenLastCalledWith("page-1", {
      strategy: "picker",
      targetMode: "isolated"
    });
    browserBridge.actOnAgentElement.mockClear();
    await expect(
      registered.get("lyraLumen.act")?.({
        elementId: 3,
        interaction: "hover",
        target: "isolated"
      })
    ).resolves.toMatchObject({
      kind: "lyraLumenActionResult",
      inputMode: "chromium",
      elementId: 3
    });
    expect(browserBridge.actOnAgentElement).toHaveBeenLastCalledWith("page-1", {
      elementId: 3,
      interaction: "hover",
      targetMode: "isolated"
    });
    expect(
      electronMock.handlers.get(LYRA_CHANNELS.agentBrowserFollowUpdate)?.({}, { enabled: false })
    ).toEqual({
      enabled: false
    });

    browserBridge.observeAgentPage.mockClear();
    await expect(
      registered.get("lyraLumen.map")?.({
        targetMode: "isolated",
        authState: "borrowLiveLogin"
      })
    ).resolves.toMatchObject({
      kind: "lyraLumenMap",
      targetMode: "isolated"
    });
    expect(browserBridge.observeAgentPage).toHaveBeenLastCalledWith("page-1", {
      strategy: "picker",
      targetMode: "isolated",
      authState: "borrowLiveLogin",
      useLiveLoginState: true
    });

    await expect(
      registered.get("lyraLumen.act")?.({ elementId: 3, interaction: "hover" })
    ).resolves.toMatchObject({
      kind: "lyraLumenActionResult",
      inputMode: "chromium",
      elementId: 3
    });
    expect(browserBridge.actOnAgentElement).toHaveBeenCalledWith("page-1", {
      elementId: 3,
      interaction: "hover",
      targetMode: "live"
    });

    await expect(
      registered.get("lyraLumen.act")?.({
        targetRef: "lumen:stable-target",
        interaction: "click"
      })
    ).resolves.toMatchObject({
      kind: "lyraLumenActionResult",
      targetRef: "lumen:stable-target"
    });
    expect(browserBridge.actOnAgentElement).toHaveBeenLastCalledWith("page-1", {
      targetRef: "lumen:stable-target",
      interaction: "click",
      targetMode: "live"
    });

    await expect(
      registered.get("lyraLumen.act")?.({
        elementId: "browser-tab-75",
        interaction: "click"
      })
    ).resolves.toMatchObject({
      ok: false,
      kind: "lyraLumenResult",
      invalidIdentifier: {
        field: "elementId",
        received: "browser-tab-75",
        expected: "lumenElementId"
      },
      correction: {
        recommendedTool: "lyra_lumen_map"
      }
    });

    await expect(
      registered.get("lyraLumen.act")?.({
        point: { x: 12, y: 34, reason: "vision fallback" },
        interaction: "click"
      })
    ).resolves.toMatchObject({
      kind: "lyraLumenActionResult",
      inputMode: "chromium",
      x: 12,
      y: 34
    });
    expect(browserBridge.actOnAgentPoint).toHaveBeenCalledWith("page-1", {
      point: { x: 12, y: 34, reason: "vision fallback" },
      interaction: "click",
      targetMode: "live"
    });

    browserBridge.observeAgentPage.mockResolvedValueOnce({
      ok: true,
      kind: "lyraLumenMap",
      tabId: "page-1",
      targetMode: "isolated",
      observationId: "obs-before-reveal",
      strategy: "hybrid",
      url: "https://example.com",
      title: "Example",
      elements: [
        {
          id: 3,
          targetRef: "lumen:stable-target",
          semanticNodeKey: "semantic:more-button",
          frameTreeNodeId: 1,
          tagName: "button",
          role: "button",
          label: "More",
          selectorPreview: "button.more",
          bounds: { x: 20, y: 20, width: 30, height: 30 },
          focusable: true,
          disabled: false,
          editable: false
        },
        {
          id: 7,
          targetRef: "lumen:template-delete-target",
          semanticNodeKey: "semantic:template-delete",
          frameTreeNodeId: 1,
          tagName: "button",
          role: "menuitem",
          label: "Delete",
          selectorPreview: "[role=menuitem]",
          bounds: { x: 24, y: 58, width: 80, height: 32 },
          focusable: true,
          disabled: false,
          editable: false
        }
      ],
      activeElementId: null,
      focusOrder: [3, 7]
    });
    browserBridge.observeAgentPage.mockResolvedValueOnce({
      ok: true,
      kind: "lyraLumenMap",
      tabId: "page-1",
      targetMode: "isolated",
      observationId: "obs-after-reveal",
      strategy: "hybrid",
      url: "https://example.com",
      title: "Example",
      elements: [
        {
          id: 3,
          targetRef: "lumen:stable-target",
          semanticNodeKey: "semantic:more-button",
          frameTreeNodeId: 1,
          tagName: "button",
          role: "button",
          label: "More",
          selectorPreview: "button.more",
          bounds: { x: 20, y: 20, width: 30, height: 30 },
          focusable: true,
          disabled: false,
          editable: false
        },
        {
          id: 7,
          targetRef: "lumen:template-delete-target",
          semanticNodeKey: "semantic:template-delete",
          frameTreeNodeId: 1,
          tagName: "button",
          role: "menuitem",
          label: "Delete",
          selectorPreview: "[role=menuitem]",
          bounds: { x: 24, y: 58, width: 80, height: 32 },
          focusable: true,
          disabled: false,
          editable: false
        },
        {
          id: 8,
          targetRef: "lumen:delete-target",
          semanticNodeKey: "semantic:portal-delete",
          frameTreeNodeId: 1,
          tagName: "button",
          role: "menuitem",
          label: "Delete",
          selectorPreview: "[role=menuitem]",
          bounds: { x: 24, y: 58, width: 80, height: 32 },
          focusable: true,
          disabled: false,
          editable: false
        }
      ],
      activeElementId: null,
      focusOrder: [3, 7, 8]
    });
    const revealResult = await registered.get("lyraLumen.reveal")?.({
      targetRef: "lumen:stable-target",
      idleMs: 80
    });
    expect(revealResult).toMatchObject({
      kind: "lyraLumenActionResult",
      revealed: true,
      beforeObservationId: "obs-before-reveal",
      afterObservationId: "obs-after-reveal",
      revealedElements: [
        expect.objectContaining({
          id: 8,
          label: "Delete"
        })
      ],
      nextRecommendedAction: "lyra_lumen.act"
    });
    expect((revealResult as { revealedElements?: unknown[] }).revealedElements).toHaveLength(1);
    expect(browserBridge.actOnAgentElement).toHaveBeenLastCalledWith("page-1", {
      targetRef: "lumen:stable-target",
      interaction: "hover",
      targetMode: "live"
    });
    await expect(
      registered.get("lyraLumen.act")?.({
        targetRef: "lumen:delete-target",
        interaction: "click"
      })
    ).resolves.toMatchObject({
      kind: "lyraLumenActionResult",
      targetRef: "lumen:delete-target"
    });
    expect(browserBridge.actOnAgentElement).toHaveBeenLastCalledWith("page-1", {
      targetRef: "lumen:delete-target",
      interaction: "click",
      targetMode: "live"
    });

    await expect(
      registered.get("lyraLumen.type")?.({ text: "hello focused editor" })
    ).resolves.toMatchObject({
      kind: "lyraLumenActionResult",
      inputMode: "chromium",
      message: "Typed into the focused element with Chromium virtual keyboard."
    });
    expect(browserBridge.typeIntoAgentElement).toHaveBeenCalledWith("page-1", {
      text: "hello focused editor",
      clear: false,
      targetMode: "live"
    });

    await expect(
      registered.get("lyraLumen.submit")?.({})
    ).resolves.toMatchObject({
      kind: "lyraLumenActionResult",
      submitted: true,
      nextRecommendedAction: "lyra_lumen.wait"
    });
    expect(browserBridge.pressAgentKey).toHaveBeenCalledWith("page-1", {
      key: "Enter",
      targetMode: "live"
    });

    await expect(
      registered.get("lyraLumen.read")?.({})
    ).resolves.toMatchObject({
      kind: "lyraLumenRead",
      strategy: "focus",
      content: "recent page tail"
    });
    expect(browserBridge.readAgentPage).toHaveBeenCalledWith("page-1", {
      strategy: "focus",
      targetMode: "live"
    });

    browserBridge.readAgentPage.mockClear();
    await expect(
      registered.get("lyraLumen.read")?.({ timeoutMs: 750, maxChars: 2048 })
    ).resolves.toMatchObject({
      kind: "lyraLumenRead",
      strategy: "focus",
      content: "recent page tail"
    });
    expect(browserBridge.readAgentPage).toHaveBeenCalledWith("page-1", {
      strategy: "focus",
      targetMode: "live",
      maxChars: 2048,
      timeoutMs: 750
    });

    await expect(
      registered.get("lyraLumen.see")?.({})
    ).resolves.toMatchObject({
      kind: "lyraLumenSee",
      width: 320,
      height: 180,
      imageArtifact: expect.objectContaining({
        kind: "image",
        mediaType: "image/png",
        width: 320,
        height: 180
      }),
      evidenceRefs: [expect.stringMatching(/^lumen-see-/u)]
    });
    await expect(
      registered.get("lyraLumen.see")?.({})
    ).resolves.not.toHaveProperty("imageBase64");

    browserBridge.captureAgentPage.mockRejectedValueOnce(new Error("background_visual_capture_unsupported"));
    browserBridge.readAgentPage.mockClear();
    await expect(
      registered.get("lyraLumen.see")?.({ targetMode: "live" })
    ).resolves.toMatchObject({
      ok: true,
      kind: "lyraLumenSeeFallback",
      targetMode: "live",
      content: "recent page tail",
      visualCapture: {
        ok: false,
        reason: "background_visual_capture_unsupported"
      },
      nextRecommendedAction: "lyra_lumen.map"
    });
    expect(browserBridge.readAgentPage).toHaveBeenCalledWith("page-1", {
      strategy: "focus",
      targetMode: "live",
      timeoutMs: 4000
    });

    browserBridge.readAgentPage.mockClear();
    browserBridge.readAgentPage.mockResolvedValueOnce({
      tabId: "page-1",
      targetMode: "live",
      scope: "main",
      text: "Doubao reply complete",
      content: "Doubao reply complete",
      truncated: false,
      startChar: 0,
      endChar: 21,
      totalChars: 21,
      hasMore: false,
      extractionMethod: "lumen:recent-text-tail"
    });
    await expect(
      registered.get("lyraLumen.wait")?.({
        until: "textContains",
        text: "reply",
        timeoutMs: 250,
        idleMs: 20
      })
    ).resolves.toMatchObject({
      kind: "lyraLumenWait",
      tabId: "page-1",
      targetMode: "live",
      until: "textContains",
      matched: true,
      content: "Doubao reply complete",
      nextRecommendedAction: "lyra_lumen.map"
    });
    expect(browserBridge.readAgentPage).toHaveBeenCalledWith("page-1", {
      strategy: "focus",
      targetMode: "live",
      timeoutMs: expect.any(Number)
    });
    expect(browserBridge.showAgentActivity).toHaveBeenCalledWith("page-1", {
      action: "wait",
      targetMode: "live",
      durationMs: 900
    });

    await expect(
      registered.get("lyraLumen.focusScan")?.({
        direction: "scan",
        steps: 3,
        restoreFocus: true
      })
    ).resolves.toMatchObject({
      kind: "lyraLumenFocusResult",
      inputMode: "chromium",
      direction: "scan",
      steps: 3
    });
    expect(browserBridge.focusAgentPage).toHaveBeenCalledWith("page-1", {
      direction: "scan",
      targetMode: "live",
      steps: 3,
      restoreFocus: true
    });

    await expect(
      registered.get("lyraLumen.navigate")?.({
        url: "https://example.com/docs",
        newTab: true
      })
    ).resolves.toMatchObject({
      kind: "lyraLumenNavigate",
      url: "https://example.com/docs"
    });
    expect(browserBridge.navigate).toHaveBeenCalledWith({
      address: "https://example.com/docs",
      newTab: true
    });

    await expect(
      registered.get("lyraLumen.navigate")?.({
        url: "https://example.com/docs",
        newTab: true,
        target: "live"
      })
    ).resolves.toMatchObject({
      kind: "lyraLumenNavigate",
      targetMode: "live",
      url: "https://example.com/docs"
    });
    expect(browserBridge.navigate).toHaveBeenCalledWith({
      address: "https://example.com/docs",
      newTab: true
    });

    await expect(
      registered.get("lyraLumen.followAudit")?.({ maxActions: 10, includeFrames: true })
    ).resolves.toMatchObject({
      kind: "lyraLumenFollowAudit",
      sessionId: "follow-1"
    });
    expect(browserBridge.readAgentFollowAudit).toHaveBeenCalledWith("page-1", {
      targetMode: "live",
      maxActions: 10,
      includeFrames: true
    });

    await expect(
      registered.get("lyraLumen.explainTarget")?.({ targetRef: "lumen:stable-target" })
    ).resolves.toMatchObject({
      kind: "lyraLumenTargetExplanation",
      targetRef: "lumen:stable-target",
      available: true
    });
    expect(browserBridge.explainAgentTargetRef).toHaveBeenCalledWith("page-1", {
      targetMode: "live",
      targetRef: "lumen:stable-target"
    });

    await expect(
      registered.get("lyraLumen.audit")?.({})
    ).resolves.toMatchObject({
      kind: "lyraLumenPageDiagnostics",
      summary: {
        errors: 0
      }
    });
    expect(browserBridge.auditAgentPageDiagnostics).toHaveBeenCalledWith("page-1", {
      targetMode: "live"
    });

    await expect(
      registered.get("lyraLumen.elevate")?.({ reason: "captcha" })
    ).resolves.toMatchObject({
      kind: "lyraLumenElevation",
      userActionRequired: true
    });
    expect(browserBridge.elevateAgentPage).toHaveBeenCalledWith("page-1", {
      targetMode: "isolated",
      reason: "captcha"
    });

    bridge.dispose();
  });

  test("lyraLumen explicit isolated actions use a hidden standalone page when the active tab is not a browser page", async () => {
    const registered = new Map<string, (payload: unknown) => unknown>();
    const tabs = {
      activeTabId: "terminal-1",
      visibleTabIds: ["terminal-1"],
      tabs: [
        {
          tabId: "terminal-1",
          title: "Terminal",
          pageKind: "terminal",
          active: true,
          visible: true,
          focusedPane: true,
          observable: true,
          observationKind: "terminal"
        }
      ]
    };
    const observationService = {
      dispose: vi.fn(),
      listTabs: vi.fn(async () => tabs),
      readWorkspace: vi.fn(),
      extractTabText: vi.fn(),
      readTab: vi.fn(async () => ({
        tab: tabs.tabs[0],
        observation: {
          kind: "terminal",
          title: "Terminal",
          text: "ready"
        }
      })),
      captureVisual: vi.fn()
    } as unknown as WorkbenchObservationService;
    const browserBridge = {
      readActiveTabId: vi.fn(() => "page-1"),
      readPageState: vi.fn(),
      observeAgentPage: vi.fn(async () => ({
        ok: true,
        kind: "lyraLumenMap",
        tabId: WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID,
        targetMode: "isolated",
        observationId: "obs-standalone",
        strategy: "picker",
        url: "about:blank",
        title: "Lyra Lumen",
        elements: [] as Array<Record<string, unknown>>,
        activeElementId: null,
        focusOrder: [] as number[]
      }))
    };

    const bridge = createAgentIpcBridge({
      runtimeClient: {
        request: vi.fn(),
        subscribe: vi.fn(() => vi.fn()),
        registerRequestHandler: vi.fn((method, handler) => {
          registered.set(method, handler);
        }),
        unregisterRequestHandler: vi.fn()
      } as unknown as LyraRuntimeClient,
      storageRoot: "/tmp/lyra-agent-test",
      getWindow: () => null,
      getBrowserBridge: () => browserBridge as never,
      getWorkbenchObservationService: () => observationService
    });

    await expect(registered.get("lyraLumen.map")?.({ targetMode: "isolated" })).resolves.toMatchObject({
      ok: true,
      kind: "lyraLumenMap",
      tabId: WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID,
      targetMode: "isolated"
    });
    expect(browserBridge.observeAgentPage).toHaveBeenCalledWith(
      WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID,
      {
        strategy: "picker",
        targetMode: "isolated"
      }
    );

    bridge.dispose();
  });

  test("lyraLumen live actions return structured notApplicable for active non-page tabs", async () => {
    const registered = new Map<string, (payload: unknown) => unknown>();
    const tabs = {
      activeTabId: "terminal-1",
      visibleTabIds: ["terminal-1"],
      tabs: [
        {
          tabId: "terminal-1",
          title: "Terminal",
          pageKind: "terminal",
          active: true,
          visible: true,
          focusedPane: true,
          observable: true,
          observationKind: "terminal"
        }
      ]
    };
    const observationService = {
      dispose: vi.fn(),
      listTabs: vi.fn(async () => tabs),
      readWorkspace: vi.fn(),
      extractTabText: vi.fn(),
      readTab: vi.fn(async () => ({
        tab: tabs.tabs[0],
        observation: {
          kind: "terminal",
          title: "Terminal",
          text: "ready"
        }
      })),
      captureVisual: vi.fn()
    } as unknown as WorkbenchObservationService;
    const browserBridge = {
      readActiveTabId: vi.fn(() => "page-1"),
      readPageState: vi.fn(),
      observeAgentPage: vi.fn()
    };

    const bridge = createAgentIpcBridge({
      runtimeClient: {
        request: vi.fn(),
        subscribe: vi.fn(() => vi.fn()),
        registerRequestHandler: vi.fn((method, handler) => {
          registered.set(method, handler);
        }),
        unregisterRequestHandler: vi.fn()
      } as unknown as LyraRuntimeClient,
      storageRoot: "/tmp/lyra-agent-test",
      getWindow: () => null,
      getBrowserBridge: () => browserBridge as never,
      getWorkbenchObservationService: () => observationService
    });

    await expect(registered.get("lyraLumen.map")?.({ target: "live" })).resolves.toMatchObject({
      ok: false,
      kind: "lyraLumenResult",
      notApplicable: true,
      requestedMethod: "lyraLumen.map",
      recommendedTool: "workbench_read_tab",
      tab: {
        tabId: "terminal-1",
        observationKind: "terminal"
      },
      observation: {
        observation: {
          kind: "terminal",
          text: "ready"
        }
      }
    });
    expect(observationService.readTab).toHaveBeenCalledWith({
      tabId: "terminal-1",
      detail: "full"
    });
    expect(browserBridge.observeAgentPage).not.toHaveBeenCalled();

    bridge.dispose();
  });

  test("software host handlers query the renderer capability bridge", async () => {
    const registered = new Map<string, (payload: unknown) => Promise<unknown>>();
    const send = vi.fn();
    const bridge = createAgentIpcBridge({
      runtimeClient: {
        request: vi.fn(),
        subscribe: vi.fn(() => vi.fn()),
        registerRequestHandler: vi.fn((method, handler) => {
          registered.set(method, handler as (payload: unknown) => Promise<unknown>);
        }),
        unregisterRequestHandler: vi.fn()
      } as unknown as LyraRuntimeClient,
      storageRoot: "/tmp/lyra-agent-test",
      getWindow: () => ({
        isDestroyed: () => false,
        webContents: {
          isDestroyed: () => false,
          send
        }
      }) as never,
      getBrowserBridge: () => null,
      getWorkbenchObservationService: () => null
    });

    const pending = registered.get("software.listCapabilities")?.({ includeSchemas: true });
    expect(send).toHaveBeenCalledWith(
      LYRA_CHANNELS.softwareCapabilitiesQuery,
      expect.objectContaining({
        method: "software.listCapabilities",
        payload: { includeSchemas: true }
      })
    );
    const query = send.mock.calls[0]?.[1] as { readonly requestId: string };
    await electronMock.handlers.get(LYRA_CHANNELS.softwareCapabilitiesQueryResult)?.({}, {
      requestId: query.requestId,
      ok: true,
      result: { software: [] }
    });

    await expect(pending).resolves.toEqual({ software: [] });
    bridge.dispose();
  });
});
