import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  LoginManagerSnapshot,
  LyraDesktopApi,
  LyraSoftwareManifest,
  SoftwareCapabilitiesQueryRequest
} from "../../../../shared/desktop-bridge";
import { createLoginManagerPasswordRef } from "../../../../shared/sensitive-value";
import type { BrowserSettingsCategoryId } from "../../browser-tabs/settings-surface-types";
import { createTranslator } from "../../i18n";
import { useWorkbenchLabels } from "../../shell/use-workbench-labels";
import { useSoftwareCapabilitiesRegistry } from "../service";

const createLabels = () => {
  const { result } = renderHook(() => useWorkbenchLabels(createTranslator("en-US")));
  return result.current.softwareStore;
};

type RegistryOverrides = {
  readonly desktopApi?: LyraDesktopApi | null;
  readonly tabsModel?: Record<string, unknown>;
  readonly fileManagerModel?: Record<string, unknown>;
  readonly imageViewerModel?: Record<string, unknown>;
  readonly terminalModel?: Record<string, unknown>;
  readonly onOpenSettingsSection?: (categoryId: BrowserSettingsCategoryId) => void;
};

const createRegistry = (overrides: RegistryOverrides = {}) => {
  const labels = createLabels();
  const tabsModel = {
    activeTabId: "page-1",
    tabs: [
      {
        id: "page-1",
        title: "Example",
        pageKind: "page",
        displayAddress: "https://example.com"
      }
    ],
    openPageInNewTab: vi.fn(),
    navigateResolvedInput: vi.fn(() => "search-tab-1"),
    openAppTab: vi.fn(),
    ...overrides.tabsModel
  };
  const fileManagerModel = {
    createInstance: vi.fn(() => ({
      appId: "file-manager",
      appInstanceId: "file-manager-new",
      title: "Files"
    })),
    openHome: vi.fn(),
    openDirectory: vi.fn(),
    getState: vi.fn(() => null),
    selectEntry: vi.fn(),
    ...overrides.fileManagerModel
  };
  return renderHook(() =>
    useSoftwareCapabilitiesRegistry({
      desktopApi: overrides.desktopApi ?? null,
      labels,
      activeUiPackId: "external:acme.tools",
      tabsModel: tabsModel as never,
      fileManagerModel: fileManagerModel as never,
      imageViewerModel: overrides.imageViewerModel as never,
      terminalModel: overrides.terminalModel as never,
      onOpenSettingsSection: overrides.onOpenSettingsSection ?? vi.fn()
    })
  );
};

const query = async (
  registry: ReturnType<typeof createRegistry>["result"],
  request: SoftwareCapabilitiesQueryRequest
) => {
  let response: Awaited<ReturnType<typeof registry.current.handleBridgeQuery>> | undefined;
  await act(async () => {
    response = await registry.current.handleBridgeQuery(request);
  });
  return response!;
};

const createLoginManagerSnapshot = (): LoginManagerSnapshot => ({
  version: 1,
  generatedAt: "2026-05-31T00:00:00.000Z",
  storageRoot: "/Users/tester/.lyra/modules/login-manager",
  passwordsAvailable: true,
  sessions: [
    {
      id: "https://example.com",
      origin: "https://example.com",
      hostname: "example.com",
      title: "Example",
      address: "https://example.com/login",
      status: "observed",
      accountHint: "alice@example.com",
      authMethod: {
        kind: "password",
        label: "Password",
        source: "observed",
        confidence: 1
      },
      authMethodSource: "observed",
      signals: {
        cookieCount: 2,
        storageObserved: true,
        formSubmitted: true
      },
      credentialIds: ["credential-example"],
      firstSeenAt: "2026-05-31T00:00:00.000Z",
      lastSeenAt: "2026-05-31T00:01:00.000Z",
      updatedAt: "2026-05-31T00:01:00.000Z"
    }
  ],
  credentials: [
    {
      id: "credential-example",
      origin: "https://example.com",
      hostname: "example.com",
      username: "alice@example.com",
      authMethod: {
        kind: "password",
        label: "Password",
        source: "observed",
        confidence: 1
      },
      hasPassword: true,
      passwordAvailable: true,
      passwordRef: createLoginManagerPasswordRef({
        credentialId: "credential-example",
        origin: "https://example.com",
        hostname: "example.com",
        username: "alice@example.com"
      }),
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:01:00.000Z"
    }
  ]
});

describe("software capability registry", () => {
  test("rejects external handlers for undeclared actions", () => {
    const { result } = createRegistry();
    const software: readonly LyraSoftwareManifest[] = [
      {
        id: "external:acme.tools:mail",
        title: "Mail",
        description: "Mail tools",
        source: "uiux",
        sourceId: "external:acme.tools",
        actions: [
          {
            id: "external:acme.tools:mail.open",
            title: "Open",
            description: "Open mailbox",
            risk: "navigate"
          }
        ]
      }
    ];
    const capabilities = result.current.createUiPackCapabilities(
      "external:acme.tools",
      software
    );

    expect(() => {
      capabilities.registerActionHandler("external:acme.tools:mail.delete", vi.fn());
    }).toThrow("Action is not declared");

    let dispose: (() => void) | undefined;
    act(() => {
      dispose = capabilities.registerActionHandler(
        "external:acme.tools:mail.open",
        vi.fn()
      );
    });
    act(() => {
      dispose?.();
    });
  });

  test("keeps list lightweight and uses inspect/read/invoke for full capability details", async () => {
    const openPageInNewTab = vi.fn();
    const { result } = createRegistry({
      tabsModel: {
        openPageInNewTab,
        navigateResolvedInput: vi.fn(() => "search-tab-1")
      }
    });

    const listed = await query(result, {
      requestId: "list",
      method: "software.listCapabilities",
      payload: {}
    });
    expect(listed).toMatchObject({ ok: true, requestId: "list" });
    if (listed.ok !== true) throw new Error("list failed");
    const listedResult = listed.result as { readonly software: readonly LyraSoftwareManifest[] };
    const browser = listedResult.software.find((item) => item.id === "browser-search");
    const openUrlSummary = browser?.actions.find((action) => action.id === "browser-search.openUrl");
    expect(openUrlSummary).toMatchObject({
      id: "browser-search.openUrl",
      risk: "navigate"
    });
    expect(openUrlSummary).not.toHaveProperty("inputSchema");

    const inspected = await query(result, {
      requestId: "inspect",
      method: "software.inspectCapability",
      payload: {
        softwareId: "browser-search",
        actionId: "browser-search.openUrl"
      }
    });
    expect(inspected).toMatchObject({ ok: true, requestId: "inspect" });
    if (inspected.ok !== true || !("action" in inspected.result)) {
      throw new Error("inspect failed");
    }
    expect(inspected.result.action).toMatchObject({
      id: "browser-search.openUrl",
      inputSchema: {
        required: ["url"]
      }
    });
    expect(inspected.result.readableState).toMatchObject({
      pages: [
        expect.objectContaining({
          tabId: "page-1",
          address: "https://example.com"
        })
      ]
    });

    const state = await query(result, {
      requestId: "state",
      method: "software.readState",
      payload: {
        softwareId: "browser-search"
      }
    });
    expect(state).toMatchObject({
      ok: true,
      result: {
        softwareId: "browser-search",
        state: {
          pages: [
            expect.objectContaining({
              tabId: "page-1"
            })
          ]
        }
      }
    });

    const rejected = await query(result, {
      requestId: "bad-invoke",
      method: "software.invokeCapability",
      payload: {
        softwareId: "browser-search",
        actionId: "browser-search.openUrl",
        input: {}
      }
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: {
        message: expect.stringContaining("url is required")
      }
    });

    const invoked = await query(result, {
      requestId: "invoke",
      method: "software.invokeCapability",
      payload: {
        softwareId: "browser-search",
        actionId: "browser-search.openUrl",
        input: {
          url: "https://example.com/docs"
        }
      }
    });
    expect(invoked).toMatchObject({
      ok: true,
      result: {
        softwareId: "browser-search",
        actionId: "browser-search.openUrl",
        output: {
          opened: true,
          url: "https://example.com/docs"
        }
      }
    });
    expect(openPageInNewTab).toHaveBeenCalledWith("https://example.com/docs", undefined);
  });

  test("reads terminal output through the bridge and requires risk policy for terminal input", async () => {
    const read = vi.fn(async () => ({
      sessionId: "session-1",
      cursor: "42",
      output: "ready\n$ ",
      running: true,
      exitCode: null,
      truncated: false,
      source: "user",
      mode: "shell"
    }));
    const write = vi.fn(async () => undefined);
    const { result } = createRegistry({
      desktopApi: {
        terminal: {
          read,
          write
        }
      } as unknown as LyraDesktopApi,
      tabsModel: {
        activeTabId: "terminal-tab-1",
        tabs: []
      },
      terminalModel: {
        activeDockTab: {
          id: "terminal-tab-1",
          activePaneId: "pane-1"
        },
        dockTabs: [],
        workspaceTabs: [],
        getTabPanes: vi.fn(() => [
          {
            id: "pane-1",
            sessionId: "session-1",
            title: "Terminal",
            cwd: "/tmp",
            shell: "zsh"
          }
        ])
      }
    });

    const buffer = await query(result, {
      requestId: "terminal-buffer",
      method: "software.invokeCapability",
      payload: {
        softwareId: "terminal",
        actionId: "terminal.readVisibleBuffer",
        input: {
          maxBytes: 2048,
          waitMs: 0
        }
      }
    });
    expect(buffer).toMatchObject({
      ok: true,
      result: {
        actionId: "terminal.readVisibleBuffer",
        output: {
          activeSessionId: "session-1",
          activeOutput: "ready\n$ ",
          visibleBufferUnavailable: false,
          cursor: "42"
        }
      }
    });
    expect(read).toHaveBeenCalledWith({
      sessionId: "session-1",
      cursor: "0",
      maxBytes: 2048,
      waitMs: 0
    });

    const rejected = await query(result, {
      requestId: "terminal-input-rejected",
      method: "software.invokeCapability",
      payload: {
        softwareId: "terminal",
        actionId: "terminal.sendControlledInput",
        input: {
          sessionId: "session-1",
          text: "pwd\n",
          riskPolicyAccepted: false
        }
      }
    });
    expect(rejected).toMatchObject({
      ok: false,
      error: {
        message: expect.stringContaining("riskPolicyAccepted must be true")
      }
    });

    const sent = await query(result, {
      requestId: "terminal-input",
      method: "software.invokeCapability",
      payload: {
        softwareId: "terminal",
        actionId: "terminal.sendControlledInput",
        input: {
          sessionId: "session-1",
          text: "pwd\n",
          riskPolicyAccepted: true
        }
      }
    });
    expect(sent).toMatchObject({
      ok: true,
      result: {
        actionId: "terminal.sendControlledInput",
        output: {
          sent: true,
          sessionId: "session-1",
          textLength: 4
        }
      }
    });
    expect(write).toHaveBeenCalledWith({
      sessionId: "session-1",
      text: "pwd\n",
      source: "user"
    });
  });

  test("searches current browser page and reads download awareness through typed bridges", async () => {
    const searchInPage = vi.fn(async () => ({
      tabId: "page-1",
      address: "https://example.com",
      title: "Example",
      query: "needle",
      totalMatches: 1,
      matches: [{
        index: 1,
        startChar: 10,
        endChar: 16,
        snippet: "one needle match"
      }],
      truncated: false
    }));
    const downloadsList = vi.fn(async () => ({
      tasks: [{
        id: "download-1",
        url: "https://example.com/file.zip",
        fileName: "file.zip",
        savePath: "/Users/tester/Downloads/file.zip",
        directory: "/Users/tester/Downloads",
        source: "browser",
        sourceTabId: "page-1",
        state: "completed",
        receivedBytes: 10,
        totalBytes: 10,
        speedBytesPerSecond: 0,
        createdAt: "2026-05-30T00:00:00Z",
        updatedAt: "2026-05-30T00:00:01Z"
      }]
    }));
    const { result } = createRegistry({
      desktopApi: {
        workbenchBrowser: {
          searchInPage,
          readPageState: vi.fn(async () => ({
            tabId: "page-1",
            address: "https://example.com",
            title: "Example",
            isActive: true,
            isVisible: true,
            isLoading: false,
            canGoBack: false,
            canGoForward: false,
            isHtmlFullscreen: false,
            updatedAt: 1
          }))
        },
        downloads: {
          list: downloadsList
        }
      } as unknown as LyraDesktopApi
    });

    const searchResult = await query(result, {
      requestId: "search-page",
      method: "software.invokeCapability",
      payload: {
        softwareId: "browser-search",
        actionId: "browser-search.searchInPage",
        input: {
          query: "needle",
          maxMatches: 5
        }
      }
    });
    expect(searchResult).toMatchObject({
      ok: true,
      result: {
        actionId: "browser-search.searchInPage",
        output: {
          totalMatches: 1,
          matches: [expect.objectContaining({ snippet: "one needle match" })]
        }
      }
    });
    expect(searchInPage).toHaveBeenCalledWith({
      query: "needle",
      maxMatches: 5
    });

    const downloads = await query(result, {
      requestId: "downloads",
      method: "software.invokeCapability",
      payload: {
        softwareId: "browser-search",
        actionId: "browser-search.readDownloads"
      }
    });
    expect(downloads).toMatchObject({
      ok: true,
      result: {
        output: {
          available: true,
          tasks: [
            expect.objectContaining({
              id: "download-1",
              openTarget: {
                kind: "file",
                path: "/Users/tester/Downloads/file.zip"
              }
            })
          ]
        }
      }
    });
  });

  test("prepares image viewer vision fallback with source open target", async () => {
    const { result } = createRegistry({
      tabsModel: {
        activeTabId: "image-tab-1",
        tabs: [{
          id: "image-tab-1",
          pageKind: "app",
          appId: "image-viewer",
          appInstanceId: "image-viewer-1",
          title: "diagram.png"
        }]
      },
      imageViewerModel: {
        getState: vi.fn(() => ({
          instanceId: "image-viewer-1",
          filePath: "/Users/tester/Pictures/diagram.png",
          status: "ready",
          openResult: {
            path: "/Users/tester/Pictures/diagram.png",
            mimeType: "image/png",
            format: "png",
            width: 640,
            height: 480
          },
          view: {
            zoom: 1.5,
            offsetX: 12,
            offsetY: -8,
            rotation: 0,
            background: "checkerboard"
          },
          siblingIndex: 0,
          siblingPaths: ["/Users/tester/Pictures/diagram.png"]
        })),
        setViewport: vi.fn()
      }
    });

    const fallback = await query(result, {
      requestId: "vision",
      method: "software.invokeCapability",
      payload: {
        softwareId: "image-viewer",
        actionId: "image-viewer.prepareVisionFallback"
      }
    });

    expect(fallback).toMatchObject({
      ok: true,
      result: {
        output: {
          available: true,
          ocrAvailable: false,
          fallback: "model-vision",
          imageArtifact: {
            path: "/Users/tester/Pictures/diagram.png",
            openTarget: {
              kind: "file",
              path: "/Users/tester/Pictures/diagram.png"
            }
          },
          nextRecommendedAction: "attach_image_to_model_vision_input"
        }
      }
    });
  });

  test("opens software details and gates install/uninstall on runtime permission", async () => {
    const installFromGit = vi.fn(async () => ({
      id: "external:acme.ui",
      manifest: {
        id: "external:acme.ui",
        name: "Acme UI",
        version: "1.0.0",
        description: "Acme",
        entry: "dist/index.js",
        workbenchUiApi: "1",
        permissions: [],
        software: []
      },
      source: {
        kind: "git",
        url: "https://example.com/acme.git"
      },
      packagePath: "/packs/acme",
      entryPath: "/packs/acme/dist/index.js",
      sourceFingerprint: "fingerprint",
      trustState: "untrusted",
      installedAt: "2026-05-30T00:00:00Z",
      updatedAt: "2026-05-30T00:00:00Z"
    }));
    const uninstall = vi.fn(async () => ({
      packId: "external:acme.ui",
      removed: true
    }));
    const openAppTab = vi.fn();
    const onOpenSettingsSection = vi.fn();
    const { result } = createRegistry({
      desktopApi: {
        uiux: {
          listPacks: vi.fn(async () => ({ builtin: [], installed: [] })),
          installFromLocal: vi.fn(),
          installFromGit,
          installFromNpm: vi.fn(),
          setTrustState: vi.fn(),
          uninstall,
          requestActivation: vi.fn(),
          resolveRuntime: vi.fn()
        }
      } as unknown as LyraDesktopApi,
      tabsModel: {
        openAppTab
      },
      onOpenSettingsSection
    });

    const detail = await query(result, {
      requestId: "detail",
      method: "software.invokeCapability",
      payload: {
        softwareId: "software-store",
        actionId: "software-store.openDetail",
        input: {
          softwareId: "browser-search"
        }
      }
    });
    expect(detail).toMatchObject({
      ok: true,
      result: {
        output: {
          opened: true,
          selected: {
            kind: "software",
            id: "browser-search"
          }
        }
      }
    });
    expect(openAppTab).not.toHaveBeenCalled();
    expect(onOpenSettingsSection).toHaveBeenCalledWith("softwareStore");

    const deniedInstall = await query(result, {
      requestId: "install-denied",
      method: "software.invokeCapability",
      payload: {
        softwareId: "software-store",
        actionId: "software-store.install",
        input: {
          sourceKind: "git",
          url: "https://example.com/acme.git"
        }
      }
    });
    expect(deniedInstall).toMatchObject({
      ok: false,
      error: {
        message: expect.stringContaining("requires runtime permission")
      }
    });

    const installed = await query(result, {
      requestId: "install",
      method: "software.invokeCapability",
      payload: {
        softwareId: "software-store",
        actionId: "software-store.install",
        permissionGranted: true,
        input: {
          sourceKind: "git",
          url: "https://example.com/acme.git"
        }
      } as never
    });
    expect(installed).toMatchObject({
      ok: true,
      result: {
        output: {
          installed: true,
          packId: "external:acme.ui"
        }
      }
    });
    expect(installFromGit).toHaveBeenCalledWith({
      url: "https://example.com/acme.git"
    });
    expect(onOpenSettingsSection).toHaveBeenCalledWith("softwareStore");

    const uninstalled = await query(result, {
      requestId: "uninstall",
      method: "software.invokeCapability",
      payload: {
        softwareId: "software-store",
        actionId: "software-store.uninstall",
        permissionGranted: true,
        input: {
          packId: "external:acme.ui"
        }
      } as never
    });
    expect(uninstalled).toMatchObject({
      ok: true,
      result: {
        output: {
          uninstalled: true,
          packId: "external:acme.ui"
        }
      }
    });
    expect(uninstall).toHaveBeenCalledWith({ packId: "external:acme.ui" });
  });

  test("exposes Login Manager capabilities without returning password text to Agent", async () => {
    const snapshot = createLoginManagerSnapshot();
    const baseSession = snapshot.sessions[0];
    if (baseSession === undefined) {
      throw new Error("test snapshot session missing");
    }
    const updatedSnapshot: LoginManagerSnapshot = {
      ...snapshot,
      sessions: [
        {
          ...baseSession,
          authMethod: {
            kind: "oauth",
            label: "GitHub",
            source: "manual",
            confidence: 1,
            providerDomain: "github.com"
          },
          authMethodSource: "manual",
          notes: "uses GitHub"
        }
      ]
    };
    const list = vi.fn(async () => snapshot);
    const updateSession = vi.fn(async () => updatedSnapshot);
    const clearSite = vi.fn(async () => ({
      cleared: true,
      origin: "https://example.com",
      hostname: "example.com",
      cookiesRemoved: 2,
      storageCleared: true
    }));
    const fillCredential = vi.fn(async () => ({
      filled: true,
      tabId: "page-1",
      origin: "https://example.com",
      username: "alice@example.com"
    }));
	    const revealCredential = vi.fn();
	    const openAppTab = vi.fn();
	    const onOpenSettingsSection = vi.fn();
	    const { result } = createRegistry({
      desktopApi: {
        loginManager: {
          list,
          updateSession,
          deleteCredential: vi.fn(),
          revealCredential,
          fillCredential,
          clearSite,
          onEvent: vi.fn(() => vi.fn())
        }
      } as unknown as LyraDesktopApi,
	      tabsModel: {
	        openAppTab
	      },
	      onOpenSettingsSection
	    });

    const listed = await query(result, {
      requestId: "list-login-manager",
      method: "software.listCapabilities",
      payload: {
        includeSchemas: true
      }
    });
    expect(listed).toMatchObject({ ok: true });
    if (listed.ok !== true) throw new Error("list failed");
    const listedResult = listed.result as { readonly software: readonly LyraSoftwareManifest[] };
    const loginManager = listedResult.software.find((item) => item.id === "login-manager");
    expect(loginManager?.actions.map((action) => action.id)).toEqual([
      "login-manager.readState",
      "login-manager.open",
      "login-manager.logoutSite",
      "login-manager.updateAuthMethod",
      "login-manager.fillCredential"
    ]);

    const opened = await query(result, {
      requestId: "open-login-manager",
      method: "software.invokeCapability",
      payload: {
        softwareId: "login-manager",
        actionId: "login-manager.open"
      }
    });
    expect(opened).toMatchObject({
      ok: true,
      result: {
        output: {
          opened: true,
          openTarget: {
            kind: "software",
            id: "login-manager"
          }
        }
      }
    });
    expect(openAppTab).not.toHaveBeenCalledWith(expect.objectContaining({
      appId: "login-manager"
    }));
    expect(onOpenSettingsSection).toHaveBeenCalledWith("loginManager");

    const state = await query(result, {
      requestId: "read-login-manager",
      method: "software.invokeCapability",
      payload: {
        softwareId: "login-manager",
        actionId: "login-manager.readState"
      }
    });
    expect(state).toMatchObject({
      ok: true,
      result: {
        output: {
          available: true,
          sessions: [expect.objectContaining({ hostname: "example.com" })],
          credentials: [
            expect.objectContaining({
              username: "alice@example.com",
              hasPassword: true,
              passwordAvailable: true,
              passwordRef: expect.objectContaining({
                kind: "lyra-sensitive-value-ref",
                owner: "login-manager",
                valueKind: "password",
                ownership: "user_owned",
                modelVisibility: "metadata_only"
              })
            })
          ]
        }
      }
    });
    expect(JSON.stringify(state)).not.toContain("storageRoot");
    expect(JSON.stringify(state)).not.toContain("super-secret-password");

    const deniedLogout = await query(result, {
      requestId: "logout-denied",
      method: "software.invokeCapability",
      payload: {
        softwareId: "login-manager",
        actionId: "login-manager.logoutSite",
        input: {
          sessionId: "https://example.com"
        }
      }
    });
    expect(deniedLogout).toMatchObject({
      ok: false,
      error: {
        message: expect.stringContaining("requires runtime permission")
      }
    });

    const logout = await query(result, {
      requestId: "logout",
      method: "software.invokeCapability",
      payload: {
        softwareId: "login-manager",
        actionId: "login-manager.logoutSite",
        permissionGranted: true,
        input: {
          sessionId: "https://example.com"
        }
      } as never
    });
    expect(logout).toMatchObject({
      ok: true,
      result: {
        output: {
          cleared: true,
          cookiesRemoved: 2
        }
      }
    });
    expect(clearSite).toHaveBeenCalledWith({
      sessionId: "https://example.com"
    });

    const updated = await query(result, {
      requestId: "update-login-manager",
      method: "software.invokeCapability",
      payload: {
        softwareId: "login-manager",
        actionId: "login-manager.updateAuthMethod",
        input: {
          sessionId: "https://example.com",
          methodKind: "oauth",
          methodLabel: "GitHub",
          providerDomain: "github.com",
          notes: "uses GitHub"
        }
      }
    });
    expect(updated).toMatchObject({
      ok: true,
      result: {
        output: {
          sessions: [
            expect.objectContaining({
              authMethodSource: "manual",
              notes: "uses GitHub"
            })
          ]
        }
      }
    });
    expect(updateSession).toHaveBeenCalledWith({
      sessionId: "https://example.com",
      notes: "uses GitHub",
      authMethod: {
        kind: "oauth",
        label: "GitHub",
        source: "manual",
        confidence: 1,
        providerDomain: "github.com"
      }
    });

    const deniedFill = await query(result, {
      requestId: "fill-denied",
      method: "software.invokeCapability",
      payload: {
        softwareId: "login-manager",
        actionId: "login-manager.fillCredential",
        input: {
          credentialId: "credential-example"
        }
      }
    });
    expect(deniedFill).toMatchObject({
      ok: false,
      error: {
        message: expect.stringContaining("requires runtime permission")
      }
    });

    const filled = await query(result, {
      requestId: "fill-login",
      method: "software.invokeCapability",
      payload: {
        softwareId: "login-manager",
        actionId: "login-manager.fillCredential",
        permissionGranted: true,
        input: {
          credentialId: "credential-example"
        }
      } as never
    });
    expect(filled).toMatchObject({
      ok: true,
      result: {
        output: {
          filled: true,
          username: "alice@example.com"
        }
      }
    });
    expect(JSON.stringify(filled)).not.toContain("password");
    expect(revealCredential).not.toHaveBeenCalled();
    expect(fillCredential).toHaveBeenCalledWith({
      credentialId: "credential-example",
      reason: "agent-request"
    });

    fillCredential.mockClear();
    const filledViaSensitiveRef = await query(result, {
      requestId: "fill-login-sensitive-ref",
      method: "software.invokeCapability",
      payload: {
        softwareId: "login-manager",
        actionId: "login-manager.fillCredential",
        permissionGranted: true,
        input: {
          sensitiveValueRef: snapshot.credentials[0]!.passwordRef
        }
      } as never
    });
    expect(filledViaSensitiveRef).toMatchObject({
      ok: true,
      result: {
        output: {
          filled: true,
          username: "alice@example.com"
        }
      }
    });
    expect(JSON.stringify(filledViaSensitiveRef)).not.toContain("password");
    expect(revealCredential).not.toHaveBeenCalled();
    expect(fillCredential).toHaveBeenCalledWith({
      credentialId: "credential-example",
      reason: "agent-request"
    });
  });
});
