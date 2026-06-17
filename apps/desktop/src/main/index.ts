import {
  app,
  BrowserWindow,
  Menu,
  nativeTheme,
  session,
  type WebContents,
  type MenuItemConstructorOptions,
  ipcMain,
  powerSaveBlocker,
  protocol,
  shell
} from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { hostname, userInfo } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LYRA_APP_NAME,
  LYRA_APP_USER_MODEL_ID,
  resolveLyraAppIcon,
  resolveLyraAppIconPath,
  type LyraAppIconVariant
} from "./app-identity";
import { configureBrowserIdentityCompatibility } from "./browser-identity-compat";
import { loadAccessibilityNativeBindings } from "./accessibility";
import { loadDocsNativeBindings } from "./documents/native-loader";
import { createAgentIpcBridge } from "./agent";
import { createReapplyLayoutScheduler } from "./schedule-reapply-layout";
import { createFilesIpcBridge } from "./files";
import { createDownloadManagerIpcBridge } from "./download-manager";
import { createImageViewerIpcBridge } from "./image-viewer";
import { createLoginManagerIpcBridge } from "./login-manager";
import { createLocationIpcBridge } from "./location";
import { createLspIpcBridge } from "./lsp";
import { createLinuxCompatBridge } from "./linux-compat";
import {
  createLyraPerformanceResourceScheduler,
  createLyraWorkspaceSurfacePerformanceSync
} from "./performance";
import { resolveCurrentDesktopTarget } from "./platform-target";
import { createLyraRuntimeClient } from "./runtime-client";
import { createSearchIpcBridge } from "./search";
import { createSensitiveValuesIpcBridge } from "./sensitive-values";
import { createScreenshotPreviewIpcBridge } from "./screenshot-preview/service";
import { createSystemNotificationsIpcBridge } from "./system-notifications/service";
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
  LYRA_UIUX_PACK_SCHEME,
  createUiuxPacksIpcBridge
} from "./uiux-packs";
import {
  applyLyraWindowMaterial,
  resolveLyraWindowMaterial,
  type LyraWindowMaterialMode
} from "./window-material";
import { createWorkbenchObservationRendererClient } from "./workbench-observation/local-tabs";
import { createWorkbenchObservationService } from "./workbench-observation/service";
import type { WorkbenchObservationService } from "./workbench-observation/types";
import { createWorkbenchDocumentsService } from "./workbench-documents/service";
import { createWorkbenchStateIpcBridge } from "./workbench-state";
import {
  LYRA_CHANNELS,
  type AppMetaPayload,
  type LinuxCompatReadConfigResponse,
  type LinuxCompatRestartRequest,
  type LinuxCompatRestartResponse,
  type LinuxCompatUpdateConfigRequest,
  type LinuxCompatUpdateConfigResponse,
  type WindowStatePayload
} from "../shared/desktop-bridge";

const currentDir = dirname(fileURLToPath(import.meta.url));
const LYRA_FILE_SCHEME = "lyra-file";

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
  },
  {
    scheme: LYRA_UIUX_PACK_SCHEME,
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
let disposeTerminalBridge: (() => void) | null = null;
let disposeAgentBridge: (() => void) | null = null;
let disposeFilesBridge: (() => void) | null = null;
let disposeDownloadManagerBridge: (() => void) | null = null;
let disposeImageViewerBridge: (() => void) | null = null;
let disposeLoginManagerBridge: (() => void) | null = null;
let disposeLocationBridge: (() => void) | null = null;
let disposeLspBridge: (() => void) | null = null;
let disposeWorkbenchBrowserBridge: (() => void) | null = null;
let disposeWorkbenchStateBridge: (() => void) | null = null;
let disposeUiuxPacksBridge: (() => void) | null = null;
let disposeRuntimeClient: (() => void) | null = null;
let disposeSearchBridge: (() => void) | null = null;
let disposeSensitiveValuesBridge: (() => void) | null = null;
let disposeWorkbenchObservationRendererClient: (() => void) | null = null;
let disposeWorkbenchObservationService: (() => void) | null = null;
let disposeWorkbenchDocumentsService: (() => void) | null = null;
let disposePowerSaveBlocker: (() => void) | null = null;
let disposeLyraDockIconThemeSync: (() => void) | null = null;
let disposeSystemNotificationsBridge: (() => void) | null = null;
let disposeScreenshotPreviewBridge: (() => void) | null = null;
let disposeWorkspaceSurfacePerformanceSync: (() => void) | null = null;
let workbenchBrowserBridge: WorkbenchBrowserIpcBridge | null = null;
let workbenchObservationService: WorkbenchObservationService | null = null;
const windowMaterialDecision = resolveLyraWindowMaterial({
  platform: process.platform,
  env: process.env
});
let activeWindowMaterialMode: LyraWindowMaterialMode = windowMaterialDecision.mode;

const storageRoots = resolveLyraStorageRoots();
ensureLyraStorageRoots(storageRoots);
applyElectronStoragePaths(storageRoots);

const linuxCompatBridge = createLinuxCompatBridge({
  platform: process.platform,
  argv: process.argv,
  env: process.env,
  storageRoot: storageRoots.modules.linuxCompat
});

linuxCompatBridge.applyToProcessEnv();
linuxCompatBridge.applyToElectronApp(app);
configureBrowserIdentityCompatibility(app);

if (linuxCompatBridge.status.enabled) {
  const status = linuxCompatBridge.status;
  console.info(
    `[lyra-linux] profile=${status.profile} backend=${status.backend} gpu=${status.gpuMode} safeMode=${status.safeMode} profileSource=${status.profileSource} backendSource=${status.backendSource} gpuSource=${status.gpuSource}`
  );
  for (const warning of status.warnings) {
    console.warn(`[lyra-linux] warning ${warning.code}: ${warning.message}`);
  }
}

app.on("child-process-gone", (_event, details) => {
  linuxCompatBridge.recordChildProcessGone(details);
});

const isDevelopmentMode = (): boolean =>
  typeof process.env.ELECTRON_RENDERER_URL === "string"
  && process.env.ELECTRON_RENDERER_URL.length > 0;

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

const isLinuxRendererStartupFailure = (
  details: Electron.RenderProcessGoneDetails
): boolean =>
  details.reason === "crashed" ||
  details.reason === "oom" ||
  details.reason === "launch-failed" ||
  details.reason === "integrity-failure";

const readAppMetaPayload = (): AppMetaPayload => {
  let userName: string | undefined;
  try {
    userName = userInfo().username;
  } catch (_error) {
    userName = process.env.USER ?? process.env.USERNAME;
  }
  const desktopTarget = resolveCurrentDesktopTarget();
  return {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    windowMaterialMode: activeWindowMaterialMode,
    desktopTargetId: desktopTarget.id,
    desktopSupportTier: desktopTarget.supportTier,
    linuxLibc: desktopTarget.libc,
    isPackaged: app.isPackaged,
    ...(userName === undefined || userName.trim().length === 0
      ? {}
      : { userName: userName.trim() }),
    hostName: hostname(),
    locale: app.getLocale(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
};

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

const isReloadInput = (input: Electron.Input): boolean => {
  const key = input.key.toLowerCase();
  if (key === "f5") {
    return true;
  }
  if (key !== "r") {
    return false;
  }
  return (input.control || input.meta) && input.alt !== true;
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

const reloadActiveWorkbenchPage = (ignoreCache: boolean): boolean => {
  const tabId = workbenchBrowserBridge?.readActiveTabId() ?? null;
  if (tabId === null) {
    return false;
  }
  workbenchBrowserBridge?.reload(tabId, ignoreCache);
  return true;
};

const exitWindowFullscreen = (window: BrowserWindow): void => {
  if (process.platform === "darwin" && window.isSimpleFullScreen()) {
    window.setSimpleFullScreen(false);
  }
  if (window.isFullScreen()) {
    window.setFullScreen(false);
  }
};

const registerWorkbenchInputShortcuts = (): void => {
  app.on("web-contents-created", (_event, contents: WebContents) => {
    contents.on("before-input-event", (event, input) => {
      if (isReloadInput(input)) {
        event.preventDefault();
        reloadActiveWorkbenchPage(input.shift === true);
        return;
      }
      if (isDevelopmentMode() && isDevToolsToggleInput(input)) {
        event.preventDefault();
        toggleDevToolsForPreferredTarget(contents);
      }
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

const resolvePreviewMimeType = (filePath: string, contentType: string | null = null): string => {
  if (
    contentType !== null
    && /^image\/[a-z0-9.+-]+$/iu.test(contentType)
  ) {
    return contentType;
  }
  const extension = extname(filePath).replace(/^\./, "").toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "bmp") return "image/bmp";
  if (extension === "ico") return "image/x-icon";
  if (extension === "avif") return "image/avif";
  if (extension === "tiff" || extension === "tif") return "image/tiff";
  if (extension === "heic" || extension === "heif") return "image/heif";
  if (extension === "jxl") return "image/jxl";
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
      const contentType = new URL(request.url).searchParams.get("contentType");
      const fileBuffer = await readFile(filePath);
      return new Response(fileBuffer, {
        status: 200,
        headers: {
          "content-type": resolvePreviewMimeType(filePath, contentType),
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

const attachDevelopmentLogging = (window: BrowserWindow): void => {
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
    window.setTitle(LYRA_APP_NAME);

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
          const outputPath = join(outputDir, "lyra-desktop-startup.png");
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

const readPreventSleepEnabledPreference = (
  rawPreferencesJson: string | null,
): boolean => {
  if (typeof rawPreferencesJson !== "string" || rawPreferencesJson.trim().length === 0) {
    return true;
  }
  try {
    const parsed = JSON.parse(rawPreferencesJson) as { readonly preventSleepEnabled?: unknown };
    return typeof parsed.preventSleepEnabled === "boolean"
      ? parsed.preventSleepEnabled
      : true;
  } catch {
    return true;
  }
};

const readLocationConsentGranted = (rawLocationJson: string | null): boolean => {
  if (typeof rawLocationJson !== "string" || rawLocationJson.trim().length === 0) {
    return false;
  }
  try {
    const parsed = JSON.parse(rawLocationJson) as { readonly consent?: unknown };
    return parsed.consent === "granted";
  } catch {
    return false;
  }
};

const configureGeolocationPermissionHandler = (
  readLocationState: () => string | null
): (() => void) => {
  const allowIfGranted = (): boolean => readLocationConsentGranted(readLocationState());

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission !== "geolocation") {
      callback(false);
      return;
    }
    callback(allowIfGranted());
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    if (permission !== "geolocation") {
      return false;
    }
    return allowIfGranted();
  });

  return () => {
    session.defaultSession.setPermissionRequestHandler(null);
    session.defaultSession.setPermissionCheckHandler(null);
  };
};

const createPowerSaveBlockerController = (): {
  readonly setEnabled: (enabled: boolean) => void;
  readonly dispose: () => void;
} => {
  let blockerId: number | null = null;

  const stop = (): void => {
    if (blockerId === null) {
      return;
    }
    if (powerSaveBlocker.isStarted(blockerId)) {
      powerSaveBlocker.stop(blockerId);
    }
    blockerId = null;
  };

  return {
    setEnabled: (enabled) => {
      if (!enabled) {
        stop();
        return;
      }
      if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
        return;
      }
      blockerId = powerSaveBlocker.start("prevent-display-sleep");
    },
    dispose: stop
  };
};

const createMainWindow = (): BrowserWindow => {
  const isMac = process.platform === "darwin";
  const iconPath = resolveLyraAppIconPath();
  const window = new BrowserWindow({
    title: LYRA_APP_NAME,
    width: 1460,
    height: 920,
    minWidth: 1160,
    minHeight: 720,
    fullscreenable: false,
    frame: isMac,
    ...windowMaterialDecision.options,
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
  activeWindowMaterialMode = applyLyraWindowMaterial(window, windowMaterialDecision);

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (typeof rendererUrl === "string" && rendererUrl.length > 0) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(currentDir, "../renderer/index.html"));
  }

  let didFinishLoad = false;
  let recoveryRestartRequested = false;
  attachDevelopmentLogging(window);
  window.webContents.once("did-finish-load", () => {
    didFinishLoad = true;
    linuxCompatBridge.markWindowReady();
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    linuxCompatBridge.recordRendererGone(details);
    if (
      recoveryRestartRequested ||
      didFinishLoad ||
      isDevelopmentMode() ||
      linuxCompatBridge.status.enabled === false ||
      linuxCompatBridge.status.recovery.active ||
      isLinuxRendererStartupFailure(details) === false
    ) {
      return;
    }
    recoveryRestartRequested = true;
    linuxCompatBridge.requestRestart(app, {
      recovery: true,
      reason: `renderer-startup-${details.reason}-${details.exitCode}`
    });
  });

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
  window.on("resize", createReapplyLayoutScheduler(window, () => {
    workbenchBrowserBridge?.reapplyLayout();
  }));
  window.on("enter-full-screen", () => {
    setImmediate(() => {
      exitWindowFullscreen(window);
    });
  });

  return window;
};

const resolveSystemAppIconVariant = (): LyraAppIconVariant =>
  nativeTheme.shouldUseDarkColors ? "dark" : "light";

const installLyraDockIconThemeSync = (): (() => void) | null => {
  if (process.platform !== "darwin") {
    return null;
  }

  const syncDockIcon = (): void => {
    const appIcon = resolveLyraAppIcon(resolveSystemAppIconVariant());
    if (appIcon !== null && app.dock !== undefined) {
      app.dock.setIcon(appIcon);
    }
  };

  syncDockIcon();
  nativeTheme.on("updated", syncDockIcon);
  return () => {
    nativeTheme.off("updated", syncDockIcon);
  };
};

const registerIpcHandlers = async (): Promise<void> => {
  const filesBridge = createFilesIpcBridge(storageRoots.modules.fileManager);
  console.info(`[lyra-files] native loaded: ${filesBridge.loadResult.loadedFrom}`);
  disposeFilesBridge = filesBridge.dispose;
  const imageViewerBridge = createImageViewerIpcBridge(storageRoots.modules.imageViewer);
  console.info(`[lyra-image-viewer] native loaded: ${imageViewerBridge.loadResult.loadedFrom}`);
  disposeImageViewerBridge = imageViewerBridge.dispose;
  const runtimeClient = createLyraRuntimeClient({
    storageRoot: storageRoots.modules.runtime,
    agentStorageRoot: storageRoots.modules.agent
  });
  disposeRuntimeClient = runtimeClient.dispose;
  const performanceScheduler = createLyraPerformanceResourceScheduler(runtimeClient);
  const registerRuntimePerformanceResource = (
    resourceId: string,
    kind: "agentTask" | "downloadTask" | "lspTask" | "searchTask" | "terminalPane"
  ): void => {
    performanceScheduler.registerResource({
      resourceId,
      kind,
      coreKey: resourceId,
      stateKey: resourceId,
      lifecycle: "keptAlive",
      visible: false,
      active: false,
      sharedSignature: resourceId
    });
  };
  registerRuntimePerformanceResource("terminal:runtime", "terminalPane");
  registerRuntimePerformanceResource("download:runtime", "downloadTask");
  registerRuntimePerformanceResource("lsp:runtime", "lspTask");
  registerRuntimePerformanceResource("search:runtime", "searchTask");
  registerRuntimePerformanceResource("agent:runtime", "agentTask");
  const downloadManagerBridge = createDownloadManagerIpcBridge({
    storageRoot: storageRoots.modules.downloadManager,
    runtimeClient,
    getWindow: () => mainWindow
  });
  disposeDownloadManagerBridge = downloadManagerBridge.dispose;
  const loginManagerBridge = createLoginManagerIpcBridge({
    storageRoot: storageRoots.modules.loginManager,
    getWindow: () => mainWindow
  });
  disposeLoginManagerBridge = loginManagerBridge.dispose;
  const sensitiveValuesBridge = createSensitiveValuesIpcBridge({
    loginManager: loginManagerBridge
  });
  disposeSensitiveValuesBridge = sensitiveValuesBridge.dispose;

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

  const workbenchStateBridge = await createWorkbenchStateIpcBridge(
    storageRoots.modules.workbenchState
  );
  disposeWorkbenchStateBridge = workbenchStateBridge.dispose;

  const agentBridge = createAgentIpcBridge({
    runtimeClient,
    storageRoot: storageRoots.modules.agent,
    terminalBridge,
    getWindow: () => mainWindow,
    getBrowserBridge: () => workbenchBrowserBridge,
    getWorkbenchObservationService: () => workbenchObservationService,
    workbenchState: workbenchStateBridge
  });
  disposeAgentBridge = agentBridge.dispose;
  const disposeGeolocationPermissionHandler = configureGeolocationPermissionHandler(
    () => workbenchStateBridge.readState("location")
  );
  const locationBridge = createLocationIpcBridge({
    readLocationConsentGranted: () =>
      readLocationConsentGranted(workbenchStateBridge.readState("location")),
    getWebContents: () => {
      if (mainWindow !== null && mainWindow.isDestroyed() === false) {
        return mainWindow.webContents;
      }
      return null;
    }
  });
  disposeLocationBridge = () => {
    disposeGeolocationPermissionHandler();
    locationBridge.dispose();
  };
  const accessibilityNativeLoadResult = loadAccessibilityNativeBindings();
  if (accessibilityNativeLoadResult.ok) {
    console.info(`[lyra-accessibility] native loaded from ${accessibilityNativeLoadResult.loadedFrom}`);
  } else {
    console.warn(`[lyra-accessibility] native unavailable: ${accessibilityNativeLoadResult.errorMessage}`);
  }
  const workspaceSurfacePerformanceSync = createLyraWorkspaceSurfacePerformanceSync({
    workbenchState: workbenchStateBridge,
    performanceScheduler
  });
  disposeWorkspaceSurfacePerformanceSync = workspaceSurfacePerformanceSync.dispose;
  workbenchBrowserBridge = createWorkbenchBrowserIpcBridge({
    getWindow: () => mainWindow,
    downloadManager: downloadManagerBridge,
    loginManager: loginManagerBridge,
    accessibilityNative: accessibilityNativeLoadResult,
    workbenchState: workbenchStateBridge,
    performanceScheduler
  });
  disposeWorkbenchBrowserBridge = workbenchBrowserBridge.dispose;
  const uiuxPacksBridge = createUiuxPacksIpcBridge({
    storageRoot: storageRoots.modules.uiuxPacks,
    workbenchStateBridge
  });
  disposeUiuxPacksBridge = uiuxPacksBridge.dispose;
  const systemNotificationsBridge = createSystemNotificationsIpcBridge({
    getWindow: () => mainWindow,
    iconPath: resolveLyraAppIconPath(),
    appUserModelId: LYRA_APP_USER_MODEL_ID
  });
  disposeSystemNotificationsBridge = systemNotificationsBridge.dispose;
  const screenshotPreviewBridge = createScreenshotPreviewIpcBridge({
    getWindow: () => mainWindow
  });
  disposeScreenshotPreviewBridge = screenshotPreviewBridge.dispose;
  const powerSaveBlockerController = createPowerSaveBlockerController();
  powerSaveBlockerController.setEnabled(
    readPreventSleepEnabledPreference(workbenchStateBridge.readState("preferences"))
  );
  const unsubscribeWorkbenchPreferenceState = workbenchStateBridge.subscribe((event) => {
    if (event.key !== "preferences") {
      return;
    }
    powerSaveBlockerController.setEnabled(readPreventSleepEnabledPreference(event.json));
  });
  disposePowerSaveBlocker = () => {
    unsubscribeWorkbenchPreferenceState();
    powerSaveBlockerController.dispose();
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
  workbenchObservationService = createWorkbenchObservationService({
    browserBridge: workbenchBrowserBridge,
    documentsService: workbenchDocumentsService,
    rendererClient: workbenchObservationRendererClient,
    terminalBridge
  });
  disposeWorkbenchObservationService = () => {
    workbenchObservationService?.dispose();
    workbenchObservationService = null;
  };

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

  ipcMain.handle(LYRA_CHANNELS.readAppMeta, (): AppMetaPayload => readAppMetaPayload());

  ipcMain.on(LYRA_CHANNELS.readAppMetaSync, (event) => {
    event.returnValue = readAppMetaPayload();
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
    LYRA_CHANNELS.linuxCompatReadConfig,
    (): LinuxCompatReadConfigResponse => linuxCompatBridge.readConfig()
  );

  ipcMain.handle(
    LYRA_CHANNELS.linuxCompatUpdateConfig,
    (_event, request: LinuxCompatUpdateConfigRequest): LinuxCompatUpdateConfigResponse =>
      linuxCompatBridge.updateConfig(request)
  );

  ipcMain.handle(
    LYRA_CHANNELS.linuxCompatRestart,
    (_event, request?: LinuxCompatRestartRequest): LinuxCompatRestartResponse =>
      linuxCompatBridge.requestRestart(app, request)
  );

};

app.setName(LYRA_APP_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId(LYRA_APP_USER_MODEL_ID);
}
process.title = LYRA_APP_NAME;

app.whenReady().then(async () => {
  configureApplicationMenu();
  registerWorkbenchInputShortcuts();
  app.once("gpu-info-update", () => {
    void linuxCompatBridge.captureGpuSnapshot(app);
  });
  const appIconPath = resolveLyraAppIconPath();
  app.setAboutPanelOptions({
    applicationName: LYRA_APP_NAME,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    ...(appIconPath === null ? {} : { iconPath: appIconPath })
  });
  disposeLyraDockIconThemeSync = installLyraDockIconThemeSync();
  registerLyraFileProtocol();
  linuxCompatBridge.persistStatusSnapshot(storageRoots.modules.linuxCompat);
  await registerIpcHandlers();
  mainWindow = createMainWindow();
  publishWindowState(mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) {
      return;
    }
    mainWindow = createMainWindow();
    publishWindowState(mainWindow);
  });
}).catch((error: unknown) => {
  console.error(`[lyra-main] startup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") {
    return;
  }
  app.quit();
});

app.on("before-quit", () => {
  if (disposeFilesBridge !== null) {
    disposeFilesBridge();
    disposeFilesBridge = null;
  }
  if (disposeDownloadManagerBridge !== null) {
    disposeDownloadManagerBridge();
    disposeDownloadManagerBridge = null;
  }
  if (disposeImageViewerBridge !== null) {
    disposeImageViewerBridge();
    disposeImageViewerBridge = null;
  }
  if (disposeSensitiveValuesBridge !== null) {
    disposeSensitiveValuesBridge();
    disposeSensitiveValuesBridge = null;
  }
  if (disposeLoginManagerBridge !== null) {
    disposeLoginManagerBridge();
    disposeLoginManagerBridge = null;
  }
  if (disposeLocationBridge !== null) {
    disposeLocationBridge();
    disposeLocationBridge = null;
  }
  if (disposeTerminalBridge !== null) {
    disposeTerminalBridge();
    disposeTerminalBridge = null;
  }
  if (disposeAgentBridge !== null) {
    disposeAgentBridge();
    disposeAgentBridge = null;
  }
  if (disposeLspBridge !== null) {
    disposeLspBridge();
    disposeLspBridge = null;
  }
  if (disposeWorkbenchBrowserBridge !== null) {
    disposeWorkbenchBrowserBridge();
    disposeWorkbenchBrowserBridge = null;
  }
  if (disposeWorkspaceSurfacePerformanceSync !== null) {
    disposeWorkspaceSurfacePerformanceSync();
    disposeWorkspaceSurfacePerformanceSync = null;
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
  if (disposePowerSaveBlocker !== null) {
    disposePowerSaveBlocker();
    disposePowerSaveBlocker = null;
  }
  if (disposeLyraDockIconThemeSync !== null) {
    disposeLyraDockIconThemeSync();
    disposeLyraDockIconThemeSync = null;
  }
  if (disposeScreenshotPreviewBridge !== null) {
    disposeScreenshotPreviewBridge();
    disposeScreenshotPreviewBridge = null;
  }
  if (disposeSystemNotificationsBridge !== null) {
    disposeSystemNotificationsBridge();
    disposeSystemNotificationsBridge = null;
  }
  workbenchBrowserBridge = null;
  if (disposeUiuxPacksBridge !== null) {
    disposeUiuxPacksBridge();
    disposeUiuxPacksBridge = null;
  }
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
});
