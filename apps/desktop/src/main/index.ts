import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  type WebContents,
  type MenuItemConstructorOptions,
  ipcMain,
  protocol,
  shell
} from "electron";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createAgentCoreIpcBridge } from "./agent-core";
import { createCapabilitiesIpcBridge } from "./capabilities";
import { createCodeIntelHostToolsBridge } from "./code-intel";
import {
  createBrowserUseHostToolsBridge,
  createBrowserUseRuntimeCoordinator,
  createBrowserUseService
} from "./browser-use";
import { loadDocsNativeBindings } from "./documents/native-loader";
import { createFilesIpcBridge } from "./files";
import { createLspIpcBridge } from "./lsp";
import { createLinuxCompatBridge } from "./linux-compat";
import { createMcpIpcBridge } from "./mcp";
import { createLyraRuntimeClient } from "./runtime-client";
import { createRuntimeHostRpcService } from "./runtime-host-rpc/service";
import { createSearchIpcBridge } from "./search";
import { createSkillsIpcBridge } from "./skills";
import {
  applyElectronStoragePaths,
  ensureLyraStorageRoots,
  resolveLyraStorageRoots
} from "./storage";
import { createTerminalIpcBridge } from "./terminal";
import {
  createWorkbenchBrowserIpcBridge,
  type WorkbenchBrowserIpcBridge
} from "./workbench-browser/service";
import {
  createWorkbenchWebAutomationHostToolsBridge,
  createWorkbenchWebAutomationService
} from "./workbench-web-automation";
import { createWorkbenchObservationRendererClient } from "./workbench-observation/local-tabs";
import { createWorkbenchObservationHostToolsBridge } from "./workbench-observation/host-tools";
import { createWorkbenchObservationService } from "./workbench-observation/service";
import { createWorkbenchDocumentsService } from "./workbench-documents/service";
import { createWorkbenchStateIpcBridge } from "./workbench-state";
import {
  LYRA_CHANNELS,
  type AppMetaPayload,
  type BrowserUseRuntimeStatus,
  type LinuxCompatExportResponse,
  type WindowStatePayload
} from "../shared/desktop-bridge";

const currentDir = dirname(fileURLToPath(import.meta.url));
const LYRA_FILE_SCHEME = "lyra-file";
const LYRA_APP_ICON_CANDIDATES = [
  join(currentDir, "../renderer/assets/logo.png"),
  join(currentDir, "../../src/renderer/assets/logo.png"),
  join(process.cwd(), "apps/desktop/src/renderer/assets/logo.png")
];

protocol.registerSchemesAsPrivileged([
  {
    scheme: LYRA_FILE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

let mainWindow: BrowserWindow | null = null;
let disposeAgentCoreBridge: (() => void) | null = null;
let disposeCapabilitiesBridge: (() => void) | null = null;
let disposeTerminalBridge: (() => void) | null = null;
let disposeFilesBridge: (() => void) | null = null;
let disposeLspBridge: (() => void) | null = null;
let disposeMcpBridge: (() => Promise<void>) | null = null;
let disposeSkillsBridge: (() => Promise<void>) | null = null;
let disposeWorkbenchBrowserBridge: (() => void) | null = null;
let disposeWorkbenchStateBridge: (() => void) | null = null;
let disposeRuntimeClient: (() => void) | null = null;
let disposeRuntimeHostRpc: (() => void) | null = null;
let disposeSearchBridge: (() => void) | null = null;
let disposeWorkbenchObservationRendererClient: (() => void) | null = null;
let disposeWorkbenchObservationService: (() => void) | null = null;
let disposeWorkbenchDocumentsService: (() => void) | null = null;
let disposeWorkbenchObservationHostTools: (() => void) | null = null;
let disposeWorkbenchWebAutomationService: (() => void) | null = null;
let disposeWorkbenchWebAutomationHostTools: (() => void) | null = null;
let disposeCodeIntelHostTools: (() => void) | null = null;
let disposeBrowserUseService: (() => void) | null = null;
let disposeBrowserUseHostTools: (() => void) | null = null;
let disposeBrowserUseRuntimeCoordinator: (() => void) | null = null;
let workbenchBrowserBridge: WorkbenchBrowserIpcBridge | null = null;

const storageRoots = resolveLyraStorageRoots();
ensureLyraStorageRoots(storageRoots);
applyElectronStoragePaths(storageRoots);

const linuxCompatBridge = createLinuxCompatBridge({
  platform: process.platform,
  argv: process.argv,
  env: process.env
});

linuxCompatBridge.applyToProcessEnv();
linuxCompatBridge.applyToElectronApp(app);

if (linuxCompatBridge.status.enabled) {
  const status = linuxCompatBridge.status;
  console.info(
    `[lyra-linux] backend=${status.backend} gpu=${status.gpuMode} safeMode=${status.safeMode} backendSource=${status.backendSource} gpuSource=${status.gpuSource}`
  );
  for (const warning of status.warnings) {
    console.warn(`[lyra-linux] warning ${warning.code}: ${warning.message}`);
  }
}

const LYRA_APP_NAME = "Lyra";
const isDevelopmentMode = (): boolean =>
  typeof process.env.ELECTRON_RENDERER_URL === "string"
  && process.env.ELECTRON_RENDERER_URL.length > 0;

const resolveLyraAppIconPath = (): string | null => {
  for (const candidate of LYRA_APP_ICON_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

const resolveLyraAppIcon = (): Electron.NativeImage | null => {
  const iconPath = resolveLyraAppIconPath();
  if (iconPath === null) {
    return null;
  }
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? null : icon;
};

const createMacApplicationMenuTemplate = (): MenuItemConstructorOptions[] => [
  {
    label: LYRA_APP_NAME,
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" }
    ]
  },
  {
    role: "editMenu",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectAll" }
    ]
  },
  ...(isDevelopmentMode()
    ? [{
        role: "viewMenu" as const,
        submenu: [
          { role: "reload" as const },
          { role: "forceReload" as const },
          { role: "toggleDevTools" as const }
        ]
      }]
    : []),
  {
    role: "windowMenu"
  }
];

const configureApplicationMenu = (): void => {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate(createMacApplicationMenuTemplate()));
    return;
  }
  Menu.setApplicationMenu(null);
};

const toWindowState = (window: BrowserWindow): WindowStatePayload => ({
  isFocused: window.isFocused(),
  isMaximized: window.isMaximized()
});

const publishWindowState = (window: BrowserWindow): void => {
  window.webContents.send(LYRA_CHANNELS.windowStateChanged, toWindowState(window));
};

const isDevToolsToggleInput = (input: Electron.Input): boolean => {
  const key = input.key.toLowerCase();
  return (
    key === "f12"
    || (
      key === "i"
      && (
        (input.control && input.shift)
        || (input.meta && input.alt)
        || (input.meta && input.shift)
      )
    )
  );
};

const toggleDevToolsForContents = (contents: WebContents): void => {
  if (contents.isDevToolsOpened()) {
    contents.closeDevTools();
    return;
  }
  contents.openDevTools({ mode: "detach" });
};

const toggleDevToolsForPreferredTarget = (contents: WebContents): void => {
  if (mainWindow !== null && contents.id === mainWindow.webContents.id) {
    if (workbenchBrowserBridge?.toggleDevToolsForActivePage() === true) {
      return;
    }
  }
  toggleDevToolsForContents(contents);
};

const exitWindowFullscreen = (window: BrowserWindow): void => {
  if (process.platform === "darwin" && window.isSimpleFullScreen()) {
    window.setSimpleFullScreen(false);
  }
  if (window.isFullScreen()) {
    window.setFullScreen(false);
  }
};

const registerDevelopmentShortcuts = (): void => {
  app.on("web-contents-created", (_event, contents: WebContents) => {
    if (!isDevelopmentMode()) {
      return;
    }
    contents.on("before-input-event", (event, input) => {
      if (!isDevToolsToggleInput(input)) {
        return;
      }
      event.preventDefault();
      toggleDevToolsForPreferredTarget(contents);
    });
  });
};

const resolveLyraFilePath = (requestUrl: string): string | null => {
  try {
    const parsedUrl = new URL(requestUrl);
    const queryPath = parsedUrl.searchParams.get("path");

    if (typeof queryPath === "string" && queryPath.length > 0) {
      if (process.platform === "win32") {
        return queryPath.replace(/^\/([A-Za-z]:[\\/])/, "$1");
      }
      return queryPath;
    }

    const decodedPathname = decodeURIComponent(parsedUrl.pathname);
    const decodedHost = decodeURIComponent(parsedUrl.hostname);
    const joinedPath =
      decodedHost.length > 0
        ? `/${decodedHost}${decodedPathname}`
        : decodedPathname;

    if (joinedPath.length === 0) {
      return null;
    }

    if (process.platform === "win32") {
      return joinedPath.replace(/^\/([A-Za-z]:[\\/])/, "$1");
    }
    return joinedPath;
  } catch (_error) {
    return null;
  }
};

const resolvePreviewMimeType = (filePath: string): string => {
  const extension = extname(filePath).replace(/^\./, "").toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "bmp") return "image/bmp";
  if (extension === "ico") return "image/x-icon";
  if (extension === "avif") return "image/avif";
  return "application/octet-stream";
};

const registerLyraFileProtocol = (): void => {
  protocol.handle(LYRA_FILE_SCHEME, async (request) => {
    const filePath = resolveLyraFilePath(request.url);
    if (filePath === null) {
      return new Response(new Uint8Array(), {
        status: 400
      });
    }
    try {
      const fileBuffer = await readFile(filePath);
      return new Response(fileBuffer, {
        status: 200,
        headers: {
          "content-type": resolvePreviewMimeType(filePath),
          "cache-control": "private, max-age=30"
        }
      });
    } catch (_error) {
      return new Response(new Uint8Array(), {
        status: 404
      });
    }
  });
};

const attachDevelopmentDiagnostics = (window: BrowserWindow): void => {
  if (!isDevelopmentMode()) {
    return;
  }

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(
      `[lyra-debug] did-fail-load code=${errorCode} url=${validatedUrl} description=${errorDescription}`
    );
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      `[lyra-debug] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`
    );
  });

  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (sourceId.startsWith("devtools://")) {
      return;
    }
    console.info(
      `[lyra-renderer:${level}] ${sourceId}:${line} ${message}`
    );
  });

  window.webContents.once("did-finish-load", () => {
    window.setTitle("Lyra");

    setTimeout(() => {
      void window.webContents
        .executeJavaScript(
          `(() => {
            const pick = (selector) => {
              const node = document.querySelector(selector);
              if (!(node instanceof HTMLElement)) {
                return null;
              }
              const rect = node.getBoundingClientRect();
              return {
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                childCount: node.childElementCount
              };
            };

            const activeTab = document.querySelector(".lyra-browser-tab-item-active");
            const readStyles = (selector) => {
              const node = document.querySelector(selector);
              if (!(node instanceof HTMLElement)) {
                return null;
              }
              const styles = window.getComputedStyle(node);
              const rect = node.getBoundingClientRect();
              return {
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                display: styles.display,
                visibility: styles.visibility,
                opacity: styles.opacity,
                transform: styles.transform,
                position: styles.position,
                zIndex: styles.zIndex,
                color: styles.color,
                backgroundColor: styles.backgroundColor,
                borderColor: styles.borderColor
              };
            };

            const centerNode = document.elementFromPoint(
              Math.round(window.innerWidth / 2),
              Math.round(window.innerHeight / 2)
            );
            const centerElement = centerNode instanceof HTMLElement ? centerNode : null;

            return {
              readyState: document.readyState,
              title: document.title,
              root: pick(".lyra-root"),
              main: pick(".lyra-main"),
              centerStack: pick(".lyra-center-stack"),
              workspace: pick(".lyra-workspace"),
              searchShell: pick(".lyra-workspace-browser-shell"),
              searchPill: readStyles(".lyra-workspace-browser-shell .lyra-browser-pill"),
              searchInput: readStyles(".lyra-workspace-browser-shell .lyra-browser-pill input"),
              resultsShell: pick(".lyra-results-shell"),
              pageShell: pick(".lyra-page-shell"),
              fileManagerSurface: pick(".lyra-file-manager-surface"),
              browserTabs: pick(".lyra-browser-tabs"),
              workspaceStyles: readStyles(".lyra-workspace"),
              centerElementClass:
                centerElement === null
                  ? null
                  : centerElement.className,
              activeTabText: activeTab instanceof HTMLElement ? activeTab.innerText.trim() : null,
              bodyTextLength: document.body.innerText.length,
              bodyTextSample: document.body.innerText.slice(0, 120)
            };
          })()`,
          true
        )
        .then((snapshot) => {
          console.info(`[lyra-debug] renderer snapshot ${JSON.stringify(snapshot)}`);
        })
        .catch((error: unknown) => {
          console.error(`[lyra-debug] snapshot failed ${String(error)}`);
        });

      void window.webContents
        .capturePage()
        .then((image) => {
          const outputDir = join(process.cwd(), ".tmp");
          mkdirSync(outputDir, { recursive: true });
          const outputPath = join(outputDir, "lyra-electron-startup.png");
          const png = image.toPNG();
          writeFileSync(outputPath, png);
          const size = image.getSize();
          console.info(
            `[lyra-debug] startup screenshot saved to ${outputPath} bytes=${png.byteLength} size=${size.width}x${size.height}`
          );
        })
        .catch((error: unknown) => {
          console.error(`[lyra-debug] capturePage failed ${String(error)}`);
        });
    }, 1200);
  });
};

type BrowserAutomationEngine = "lyra_direct" | "browser_use" | "smart";
type LyraDirectMicroExecutorBudget = "1-2" | "3-5" | "6-8";

const normalizeBrowserAutomationEngine = (value: unknown): BrowserAutomationEngine =>
  value === "browser_use" || value === "smart" ? value : "lyra_direct";

const readBrowserAutomationEnginePreference = (
  rawPreferencesJson: string | null,
): BrowserAutomationEngine => {
  if (typeof rawPreferencesJson !== "string" || rawPreferencesJson.trim().length === 0) {
    return "lyra_direct";
  }
  try {
    const parsed = JSON.parse(rawPreferencesJson) as { readonly browserAutomationEngine?: unknown };
    return normalizeBrowserAutomationEngine(parsed.browserAutomationEngine);
  } catch {
    return "lyra_direct";
  }
};

const normalizeLyraDirectMicroExecutorBudget = (value: unknown): LyraDirectMicroExecutorBudget =>
  value === "1-2" || value === "6-8" ? value : "3-5";

const readLyraDirectMicroExecutorBudgetPreference = (
  rawPreferencesJson: string | null,
): LyraDirectMicroExecutorBudget => {
  if (typeof rawPreferencesJson !== "string" || rawPreferencesJson.trim().length === 0) {
    return "3-5";
  }
  try {
    const parsed = JSON.parse(rawPreferencesJson) as { readonly lyraDirectMicroExecutorBudget?: unknown };
    return normalizeLyraDirectMicroExecutorBudget(parsed.lyraDirectMicroExecutorBudget);
  } catch {
    return "3-5";
  }
};

const createMainWindow = (): BrowserWindow => {
  const isMac = process.platform === "darwin";
  const iconPath = resolveLyraAppIconPath();
  const window = new BrowserWindow({
    title: "Lyra",
    width: 1460,
    height: 920,
    minWidth: 1160,
    minHeight: 720,
    fullscreenable: false,
    frame: isMac,
    backgroundColor: "#dcdcdd",
    autoHideMenuBar: true,
    titleBarStyle: isMac ? "hiddenInset" : "default",
    ...(iconPath === null ? {} : { icon: iconPath }),
    webPreferences: {
      preload: join(currentDir, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      disableHtmlFullscreenWindowResize: true
    }
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (typeof rendererUrl === "string" && rendererUrl.length > 0) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(currentDir, "../renderer/index.html"));
  }

  attachDevelopmentDiagnostics(window);

  window.on("focus", () => {
    publishWindowState(window);
    workbenchBrowserBridge?.reapplyLayout();
  });
  window.on("blur", () => publishWindowState(window));
  window.on("maximize", () => {
    publishWindowState(window);
    workbenchBrowserBridge?.reapplyLayout();
  });
  window.on("unmaximize", () => {
    publishWindowState(window);
    workbenchBrowserBridge?.reapplyLayout();
  });
  window.on("resize", () => {
    workbenchBrowserBridge?.reapplyLayout();
  });
  window.on("enter-full-screen", () => {
    setImmediate(() => {
      exitWindowFullscreen(window);
    });
  });

  return window;
};

const registerIpcHandlers = (): void => {
  const filesBridge = createFilesIpcBridge(storageRoots.modules.fileManager);
  console.info(`[lyra-files] native loaded: ${filesBridge.loadResult.loadedFrom}`);
  disposeFilesBridge = filesBridge.dispose;

  const runtimeClient = createLyraRuntimeClient({
    storageRoot: storageRoots.modules.ai
  });
  disposeRuntimeClient = runtimeClient.dispose;
  const runtimeHostRpc = createRuntimeHostRpcService({ runtimeClient });
  disposeRuntimeHostRpc = runtimeHostRpc.dispose;

  const terminalBridge = createTerminalIpcBridge(
    storageRoots.modules.terminal,
    runtimeClient,
    () => mainWindow
  );
  console.info(`[lyra-terminal] runtime attached: ${terminalBridge.loadResult.loadedFrom}`);
  disposeTerminalBridge = terminalBridge.dispose;

  const searchBridge = createSearchIpcBridge({
    runtimeClient,
    storageRoot: storageRoots.modules.search
  });
  disposeSearchBridge = searchBridge.dispose;

  const lspBridge = createLspIpcBridge(runtimeClient, () => mainWindow);
  console.info(`[lyra-lsp] runtime attached: ${lspBridge.loadResult.loadedFrom}`);
  disposeLspBridge = lspBridge.dispose;

  const mcpBridge = createMcpIpcBridge(
    storageRoots.modules.mcp,
    runtimeClient,
    () => mainWindow,
    filesBridge.nativeBindings
  );
  disposeMcpBridge = mcpBridge.dispose;

  const skillsBridge = createSkillsIpcBridge({
    storageRoot: storageRoots.modules.skills,
    getWindow: () => mainWindow,
    filesNativeBindings: filesBridge.nativeBindings
  });
  disposeSkillsBridge = skillsBridge.dispose;

  workbenchBrowserBridge = createWorkbenchBrowserIpcBridge({
    getWindow: () => mainWindow
  });
  disposeWorkbenchBrowserBridge = workbenchBrowserBridge.dispose;
  const workbenchStateBridge = createWorkbenchStateIpcBridge(
    storageRoots.modules.workbenchState
  );
  disposeWorkbenchStateBridge = workbenchStateBridge.dispose;
  const workbenchWebAutomationService = createWorkbenchWebAutomationService({
    browserBridge: workbenchBrowserBridge,
    storageRoot: storageRoots.modules.webAutomation,
    readLyraDirectMicroExecutorBudget: () =>
      readLyraDirectMicroExecutorBudgetPreference(
        workbenchStateBridge.readState("preferences")
      )
  });
  disposeWorkbenchWebAutomationService = workbenchWebAutomationService.dispose;
  const browserUseService = createBrowserUseService({
    browserBridge: workbenchBrowserBridge,
    storageRoot: storageRoots.modules.browserUse
  });
  disposeBrowserUseService = () => {
    void browserUseService.dispose();
  };
  const docsNativeLoadResult = loadDocsNativeBindings();
  if (docsNativeLoadResult.ok === false) {
    throw new Error(
      `docs native unavailable: ${docsNativeLoadResult.errorMessage}\ntried paths:\n${docsNativeLoadResult.triedPaths.join("\n")}`
    );
  }
  console.info(`[lyra-docs] native loaded from ${docsNativeLoadResult.loadedFrom}`);
  const workbenchDocumentsService = createWorkbenchDocumentsService({
    browserBridge: workbenchBrowserBridge,
    docsNativeBindings: docsNativeLoadResult.bindings
  });
  disposeWorkbenchDocumentsService = workbenchDocumentsService.dispose;
  const workbenchObservationRendererClient = createWorkbenchObservationRendererClient({
    getWindow: () => mainWindow
  });
  disposeWorkbenchObservationRendererClient = workbenchObservationRendererClient.dispose;
  const workbenchObservationService = createWorkbenchObservationService({
    browserBridge: workbenchBrowserBridge,
    documentsService: workbenchDocumentsService,
    rendererClient: workbenchObservationRendererClient,
    terminalBridge
  });
  disposeWorkbenchObservationService = workbenchObservationService.dispose;

  const capabilitiesBridge = createCapabilitiesIpcBridge({
    filesNativeBindings: filesBridge.nativeBindings,
    filesStorageRoot: storageRoots.modules.fileManager,
    codeIntelStorageRoot: storageRoots.modules.search,
    runtimeClient,
    terminalBridge,
    mcpBridge,
    workbenchBrowserBridge,
    workbenchObservationService,
    workbenchDocumentsService,
    workbenchWebAutomationService,
    browserUseService,
    getWindow: () => mainWindow
  });
  disposeCapabilitiesBridge = capabilitiesBridge.dispose;
  const codeIntelHostTools = createCodeIntelHostToolsBridge({
    capabilitiesBridge,
    runtimeClient,
    runtimeHostRpc
  });
  disposeCodeIntelHostTools = codeIntelHostTools.dispose;
  void codeIntelHostTools.sync().catch((error: unknown) => {
    console.warn(`[lyra-code-intel] host tool sync failed ${String(error)}`);
  });
  const workbenchObservationHostTools = createWorkbenchObservationHostToolsBridge({
    capabilitiesBridge,
    runtimeClient,
    runtimeHostRpc
  });
  disposeWorkbenchObservationHostTools = workbenchObservationHostTools.dispose;
  void workbenchObservationHostTools.sync().catch((error: unknown) => {
    console.warn(`[lyra-workbench-observation] host tool sync failed ${String(error)}`);
  });
  const workbenchWebAutomationHostTools = createWorkbenchWebAutomationHostToolsBridge({
    capabilitiesBridge,
    runtimeClient,
    runtimeHostRpc
  });
  disposeWorkbenchWebAutomationHostTools = workbenchWebAutomationHostTools.dispose;
  void workbenchWebAutomationHostTools.sync().catch((error: unknown) => {
    console.warn(`[lyra-workbench-automation] host tool sync failed ${String(error)}`);
  });
  const browserUseHostTools = createBrowserUseHostToolsBridge({
    capabilitiesBridge,
    runtimeClient,
    runtimeHostRpc
  });
  disposeBrowserUseHostTools = browserUseHostTools.dispose;

  let browserUseRuntimeStatus: BrowserUseRuntimeStatus = {
    state: "checking",
    checkedAt: Date.now()
  };
  const browserUseRuntimeCoordinator = createBrowserUseRuntimeCoordinator({
    runtime: browserUseService.runtime,
    hostTools: browserUseHostTools,
    readPreferredEngine: () =>
      readBrowserAutomationEnginePreference(
        workbenchStateBridge.readState("preferences")
      )
  });
  disposeBrowserUseRuntimeCoordinator = () => {
    void browserUseRuntimeCoordinator.dispose();
  };
  const publishBrowserUseRuntimeStatus = (status: BrowserUseRuntimeStatus): void => {
    browserUseRuntimeStatus = status;
    if (mainWindow === null || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send(LYRA_CHANNELS.browserUseRuntimeStatusEvent, status);
  };
  const unsubscribeBrowserUseRuntimeStatus = browserUseRuntimeCoordinator.subscribe((status) => {
    publishBrowserUseRuntimeStatus(status);
  });
  const unsubscribeWorkbenchPreferenceState = workbenchStateBridge.subscribe((event) => {
    if (event.key !== "preferences") {
      return;
    }
    void browserUseRuntimeCoordinator.applyEnginePreference(
      readBrowserAutomationEnginePreference(event.json)
    ).catch((error: unknown) => {
      console.warn(`[lyra-browser-use] failed to apply browser engine preference ${String(error)}`);
    });
  });
  disposeBrowserUseRuntimeCoordinator = () => {
    unsubscribeBrowserUseRuntimeStatus();
    unsubscribeWorkbenchPreferenceState();
    void browserUseRuntimeCoordinator.dispose();
  };
  void browserUseRuntimeCoordinator.applyEnginePreference(
    readBrowserAutomationEnginePreference(workbenchStateBridge.readState("preferences"))
  ).catch((error: unknown) => {
    console.warn(`[lyra-browser-use] initial engine preference apply failed ${String(error)}`);
  });
  browserUseRuntimeCoordinator.start();

  const agentCoreBridge = createAgentCoreIpcBridge(runtimeClient);
  console.info(`[lyra-agent-core] runtime bridge ready`);
  disposeAgentCoreBridge = agentCoreBridge.dispose;

  ipcMain.handle(LYRA_CHANNELS.minimizeWindow, () => {
    mainWindow?.minimize();
  });

  ipcMain.handle(LYRA_CHANNELS.toggleWindowMaximize, () => {
    if (mainWindow === null) {
      return;
    }
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return;
    }
    mainWindow.maximize();
  });

  ipcMain.handle(LYRA_CHANNELS.closeWindow, () => {
    mainWindow?.close();
  });

  ipcMain.handle(LYRA_CHANNELS.readAppMeta, (): AppMetaPayload => ({
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged
  }));

  ipcMain.handle(
    LYRA_CHANNELS.browserUseReadRuntimeStatus,
    (): BrowserUseRuntimeStatus => browserUseRuntimeStatus
  );

  ipcMain.on(LYRA_CHANNELS.readAppMetaSync, (event) => {
    event.returnValue = {
      version: app.getVersion(),
      platform: process.platform,
      isPackaged: app.isPackaged
    } satisfies AppMetaPayload;
  });

  ipcMain.handle(LYRA_CHANNELS.openExternal, async (_event, url: string): Promise<boolean> => {
    if (typeof url !== "string" || url.length === 0) {
      return false;
    }
    try {
      await shell.openExternal(url);
      return true;
    } catch (_error) {
      return false;
    }
  });

  ipcMain.handle(
    LYRA_CHANNELS.linuxCompatReadStatus,
    () => linuxCompatBridge.status
  );

  ipcMain.handle(
    LYRA_CHANNELS.linuxCompatExportDiagnostics,
    (): LinuxCompatExportResponse =>
      linuxCompatBridge.exportDiagnosticsSnapshot(storageRoots.modules.linuxCompat)
  );

};

app.setName(LYRA_APP_NAME);
process.title = LYRA_APP_NAME;

app.whenReady().then(() => {
  configureApplicationMenu();
  registerDevelopmentShortcuts();
  const appIconPath = resolveLyraAppIconPath();
  app.setAboutPanelOptions({
    applicationName: LYRA_APP_NAME,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    ...(appIconPath === null ? {} : { iconPath: appIconPath })
  });
  if (process.platform === "darwin") {
    const appIcon = resolveLyraAppIcon();
    if (appIcon !== null && app.dock !== undefined) {
      app.dock.setIcon(appIcon);
    }
  }
  registerLyraFileProtocol();
  linuxCompatBridge.persistStatusSnapshot(storageRoots.modules.linuxCompat);
  registerIpcHandlers();
  mainWindow = createMainWindow();
  publishWindowState(mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) {
      return;
    }
    mainWindow = createMainWindow();
    publishWindowState(mainWindow);
  });
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") {
    return;
  }
  app.quit();
});

app.on("before-quit", () => {
  if (disposeAgentCoreBridge !== null) {
    disposeAgentCoreBridge();
    disposeAgentCoreBridge = null;
  }
  if (disposeCapabilitiesBridge !== null) {
    disposeCapabilitiesBridge();
    disposeCapabilitiesBridge = null;
  }
  if (disposeFilesBridge !== null) {
    disposeFilesBridge();
    disposeFilesBridge = null;
  }
  if (disposeTerminalBridge !== null) {
    disposeTerminalBridge();
    disposeTerminalBridge = null;
  }
  if (disposeLspBridge !== null) {
    disposeLspBridge();
    disposeLspBridge = null;
  }
  if (disposeMcpBridge !== null) {
    void disposeMcpBridge();
    disposeMcpBridge = null;
  }
  if (disposeSkillsBridge !== null) {
    void disposeSkillsBridge();
    disposeSkillsBridge = null;
  }
  if (disposeWorkbenchBrowserBridge !== null) {
    disposeWorkbenchBrowserBridge();
    disposeWorkbenchBrowserBridge = null;
  }
  if (disposeWorkbenchObservationRendererClient !== null) {
    disposeWorkbenchObservationRendererClient();
    disposeWorkbenchObservationRendererClient = null;
  }
  if (disposeWorkbenchObservationService !== null) {
    disposeWorkbenchObservationService();
    disposeWorkbenchObservationService = null;
  }
  if (disposeWorkbenchDocumentsService !== null) {
    disposeWorkbenchDocumentsService();
    disposeWorkbenchDocumentsService = null;
  }
  if (disposeWorkbenchObservationHostTools !== null) {
    disposeWorkbenchObservationHostTools();
    disposeWorkbenchObservationHostTools = null;
  }
  if (disposeWorkbenchWebAutomationHostTools !== null) {
    disposeWorkbenchWebAutomationHostTools();
    disposeWorkbenchWebAutomationHostTools = null;
  }
  if (disposeCodeIntelHostTools !== null) {
    disposeCodeIntelHostTools();
    disposeCodeIntelHostTools = null;
  }
  if (disposeWorkbenchWebAutomationService !== null) {
    disposeWorkbenchWebAutomationService();
    disposeWorkbenchWebAutomationService = null;
  }
  if (disposeBrowserUseRuntimeCoordinator !== null) {
    disposeBrowserUseRuntimeCoordinator();
    disposeBrowserUseRuntimeCoordinator = null;
  }
  if (disposeBrowserUseHostTools !== null) {
    disposeBrowserUseHostTools();
    disposeBrowserUseHostTools = null;
  }
  if (disposeBrowserUseService !== null) {
    disposeBrowserUseService();
    disposeBrowserUseService = null;
  }
  workbenchBrowserBridge = null;
  if (disposeWorkbenchStateBridge !== null) {
    disposeWorkbenchStateBridge();
    disposeWorkbenchStateBridge = null;
  }
  if (disposeSearchBridge !== null) {
    disposeSearchBridge();
    disposeSearchBridge = null;
  }
  if (disposeRuntimeClient !== null) {
    disposeRuntimeClient();
    disposeRuntimeClient = null;
  }
  if (disposeRuntimeHostRpc !== null) {
    disposeRuntimeHostRpc();
    disposeRuntimeHostRpc = null;
  }
});
