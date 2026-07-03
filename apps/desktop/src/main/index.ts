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
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { hostname, userInfo, platform, homedir, tmpdir } from "node:os";
import { execFile, execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  LYRA_APP_NAME,
  LYRA_APP_USER_MODEL_ID,
  resolveLyraAppIcon,
  resolveLyraAppIconPath,
  type LyraAppIconVariant
} from "./app-identity";
import { configureBrowserIdentityCompatibility } from "./browser-identity-compat";
import { loadAccessibilityNativeBindings } from "./accessibility";
import { createAutoUpdateService } from "./auto-update/service";
import { loadDocsNativeBindings } from "./documents/native-loader";
import { createAgentIpcBridge } from "./agent";
import { createReapplyLayoutScheduler } from "./schedule-reapply-layout";
import { createFilesIpcBridge } from "./files";
import { createDownloadManagerIpcBridge } from "./download-manager";
import { createImageViewerIpcBridge } from "./image-viewer";
import { createIdentityIpcBridge } from "./identity";
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
import {
  createLyraFileAccessController,
  isSafeExternalUrl
} from "./security";
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
  type ThirdPartyNoticesDocument,
  type LinuxCompatUpdateConfigRequest,
  type LinuxCompatUpdateConfigResponse,
  type WindowStatePayload,
  type DetectedEditor,
  type OpenInEditorRequest
} from "../shared/desktop-bridge";

const currentDir = dirname(fileURLToPath(import.meta.url));
const LYRA_FILE_SCHEME = "lyra-file";
const execFileAsync = promisify(execFile);

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
let disposeIdentityBridge: (() => void) | null = null;
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
let disposeAutoUpdateService: (() => void) | null = null;
let workbenchBrowserBridge: WorkbenchBrowserIpcBridge | null = null;
let workbenchObservationService: WorkbenchObservationService | null = null;
const windowMaterialDecision = resolveLyraWindowMaterial({
  platform: process.platform,
  env: process.env
});
let activeWindowMaterialMode: LyraWindowMaterialMode = windowMaterialDecision.mode;

const LYRA_MAC_WINDOW_BUTTON_POSITION = { x: 10, y: 9 } as const;
/** Matches `--lyra-shell-titlebar-h` (34px) in renderer tokens. */
const LYRA_MAC_TITLEBAR_OVERLAY_HEIGHT = 34;

const storageRoots = resolveLyraStorageRoots();
ensureLyraStorageRoots(storageRoots);
applyElectronStoragePaths(storageRoots);
const lyraFileAccess = createLyraFileAccessController([
  join(storageRoots.modules.identity, "identity-icons"),
  join(storageRoots.modules.loginManager, "favicons"),
  storageRoots.modules.imageViewer,
  join(tmpdir(), "lyra-screenshot-preview")
]);

const focusExistingMainWindow = (): void => {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
};

const singleInstanceLockAcquired = app.requestSingleInstanceLock();
if (!singleInstanceLockAcquired) {
  console.warn("[lyra-electron] another Lyra instance is already using this profile; exiting");
  app.exit(0);
  process.exit(0);
}

app.on("second-instance", () => {
  focusExistingMainWindow();
});

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

const readMacWindowFullScreenState = (window: BrowserWindow): boolean => {
  if (pendingMacFullScreenTarget !== null) {
    return pendingMacFullScreenTarget;
  }
  return window.isFullScreen();
};

const toWindowState = (window: BrowserWindow): WindowStatePayload => ({
  isFocused: window.isFocused(),
  isMaximized: window.isMaximized(),
  isFullScreen:
    process.platform === "darwin"
      ? readMacWindowFullScreenState(window)
      : window.isFullScreen()
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

type ThirdPartyNoticesCache = {
  readonly path: string;
  readonly mtimeMs: number;
  readonly document: ThirdPartyNoticesDocument;
};

let thirdPartyNoticesCache: ThirdPartyNoticesCache | null = null;

const isThirdPartyNoticesDocument = (value: unknown): value is ThirdPartyNoticesDocument => {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<ThirdPartyNoticesDocument>;
  return record.schemaVersion === 1
    && typeof record.generatedAt === "string"
    && typeof record.packageCount === "number"
    && record.ecosystems !== null
    && typeof record.ecosystems === "object"
    && Array.isArray(record.items)
    && typeof record.markdown === "string";
};

const resolveThirdPartyNoticesPath = async (): Promise<{ readonly path: string; readonly mtimeMs: number }> => {
  const candidates = [
    join(process.resourcesPath, "legal", "third-party-notices.json"),
    join(process.cwd(), "legal", "generated", "third-party-notices.json"),
    resolve(process.cwd(), "../../legal/generated/third-party-notices.json"),
    resolve(currentDir, "../../../../legal/generated/third-party-notices.json")
  ];

  for (const candidate of candidates) {
    try {
      const stats = await stat(candidate);
      if (stats.isFile()) {
        return { path: candidate, mtimeMs: stats.mtimeMs };
      }
    } catch (_error) {
      // try next dev/packaged candidate
    }
  }

  throw new Error("Third-party notices have not been generated.");
};

const readThirdPartyNoticesDocument = async (): Promise<ThirdPartyNoticesDocument> => {
  const resolvedNotices = await resolveThirdPartyNoticesPath();
  if (
    thirdPartyNoticesCache !== null
    && thirdPartyNoticesCache.path === resolvedNotices.path
    && thirdPartyNoticesCache.mtimeMs === resolvedNotices.mtimeMs
  ) {
    return thirdPartyNoticesCache.document;
  }

  const parsed = JSON.parse(await readFile(resolvedNotices.path, "utf8")) as unknown;
  if (!isThirdPartyNoticesDocument(parsed)) {
    throw new Error("Third-party notices JSON is invalid.");
  }
  thirdPartyNoticesCache = {
    path: resolvedNotices.path,
    mtimeMs: resolvedNotices.mtimeMs,
    document: parsed
  };
  return parsed;
};

const publishWindowState = (window: BrowserWindow): void => {
  window.webContents.send(LYRA_CHANNELS.windowStateChanged, toWindowState(window));
};

const applyMacWindowButtonPosition = (window: BrowserWindow): void => {
  if (process.platform !== "darwin" || window.isDestroyed()) {
    return;
  }
  window.setWindowButtonVisibility(true);
  window.setWindowButtonPosition(LYRA_MAC_WINDOW_BUTTON_POSITION);
};

const isWindowFullScreen = (window: BrowserWindow): boolean =>
  process.platform === "darwin"
    ? readMacWindowFullScreenState(window)
    : window.isFullScreen();

const FULLSCREEN_LAYOUT_SETTLE_MS = 650;
const FULLSCREEN_LAYOUT_MAX_WAIT_MS = 1500;

let fullscreenLayoutTransitionActive = false;
let fullscreenLayoutSettleTimer: ReturnType<typeof setTimeout> | null = null;
let fullscreenLayoutTransitionStartedAt = 0;
let lastKnownWindowFullScreenState = false;
let pendingMacFullScreenTarget: boolean | null = null;
const fullscreenLayoutFlushes = new Set<() => void>();

const clearFullscreenLayoutSettleTimer = (): void => {
  if (fullscreenLayoutSettleTimer !== null) {
    clearTimeout(fullscreenLayoutSettleTimer);
    fullscreenLayoutSettleTimer = null;
  }
};

const completeFullscreenLayoutTransition = (window: BrowserWindow): void => {
  fullscreenLayoutTransitionActive = false;
  fullscreenLayoutTransitionStartedAt = 0;
  pendingMacFullScreenTarget = null;
  if (window.isDestroyed()) {
    fullscreenLayoutFlushes.clear();
    return;
  }
  lastKnownWindowFullScreenState = isWindowFullScreen(window);
  publishWindowState(window);
  const flushes = Array.from(fullscreenLayoutFlushes);
  fullscreenLayoutFlushes.clear();
  if (flushes.length > 0) {
    for (const flush of flushes) {
      flush();
    }
    return;
  }
  workbenchBrowserBridge?.reapplyLayout();
  if (process.platform === "darwin") {
    applyMacWindowButtonPosition(window);
    setTimeout(() => applyMacWindowButtonPosition(window), 120);
  }
};

const settleFullscreenLayout = (window: BrowserWindow): void => {
  clearFullscreenLayoutSettleTimer();
  if (fullscreenLayoutTransitionStartedAt === 0) {
    fullscreenLayoutTransitionStartedAt = Date.now();
  }
  const elapsed = Date.now() - fullscreenLayoutTransitionStartedAt;
  const delay = Math.max(
    0,
    Math.min(FULLSCREEN_LAYOUT_SETTLE_MS, FULLSCREEN_LAYOUT_MAX_WAIT_MS - elapsed)
  );
  if (delay === 0) {
    completeFullscreenLayoutTransition(window);
    return;
  }
  fullscreenLayoutSettleTimer = setTimeout(() => {
    fullscreenLayoutSettleTimer = null;
    completeFullscreenLayoutTransition(window);
  }, delay);
};

const beginFullscreenLayoutTransition = (window: BrowserWindow): void => {
  fullscreenLayoutTransitionActive = true;
  if (fullscreenLayoutTransitionStartedAt === 0) {
    fullscreenLayoutTransitionStartedAt = Date.now();
  }
  publishWindowState(window);
  settleFullscreenLayout(window);
};

const syncFullscreenStateFromWindow = (window: BrowserWindow): boolean => {
  if (pendingMacFullScreenTarget !== null) {
    return false;
  }
  const actualFullScreenState = isWindowFullScreen(window);
  if (actualFullScreenState === lastKnownWindowFullScreenState) {
    return false;
  }
  lastKnownWindowFullScreenState = actualFullScreenState;
  beginFullscreenLayoutTransition(window);
  return true;
};

const setMacWindowFullScreen = (window: BrowserWindow, nextFullScreenState: boolean): void => {
  if (process.platform !== "darwin") {
    window.setFullScreen(nextFullScreenState);
    return;
  }
  // Cherry Studio / VS Code (nativeFullScreen default) / Zed all use native
  // setFullScreen on macOS so the Dock and menu bar are hidden. Avoid
  // setSimpleFullScreen with titleBarStyle: 'hidden' (VS Code #63291).
  pendingMacFullScreenTarget = nextFullScreenState;
  beginFullscreenLayoutTransition(window);
  if (nextFullScreenState && window.isMaximized()) {
    window.unmaximize();
  }
  window.setFullScreen(nextFullScreenState);
  window.webContents.focus();
  applyMacWindowButtonPosition(window);
  setTimeout(() => applyMacWindowButtonPosition(window), 120);
  setTimeout(() => applyMacWindowButtonPosition(window), 400);
};

const requestWorkbenchLayoutReapply = (window: BrowserWindow): void => {
  if (process.platform === "darwin") {
    if (syncFullscreenStateFromWindow(window)) {
      return;
    }
    if (fullscreenLayoutTransitionActive) {
      settleFullscreenLayout(window);
      return;
    }
  }
  workbenchBrowserBridge?.reapplyLayout();
};

const deferWorkbenchBrowserLayoutSync = (flush: () => void): boolean => {
  if (process.platform !== "darwin") {
    return false;
  }
  const window = mainWindow;
  if (window === null || window.isDestroyed()) {
    return false;
  }
  syncFullscreenStateFromWindow(window);
  if (!fullscreenLayoutTransitionActive) {
    return false;
  }
  fullscreenLayoutFlushes.add(flush);
  settleFullscreenLayout(window);
  return true;
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

const registerLyraFileProtocol = (): void => {
  protocol.handle(LYRA_FILE_SCHEME, async (request) => {
    const resolved = await lyraFileAccess.resolveRequest(request.url);
    if (resolved === null) {
      return new Response(new Uint8Array(), {
        status: 403
      });
    }
    try {
      const fileBuffer = await readFile(resolved.path);
      return new Response(fileBuffer, {
        status: 200,
        headers: {
          "content-type": resolved.contentType,
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

const loadRendererInDevelopment = (window: BrowserWindow, rendererUrl: string): void => {
  const maxAttempts = 60;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRetry = (): void => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const onFailLoad = (
    _event: Electron.Event,
    errorCode: number,
    _errorDescription: string,
    validatedUrl: string
  ): void => {
    if (validatedUrl !== rendererUrl || errorCode !== -102 || attempt >= maxAttempts) {
      return;
    }
    clearRetry();
    retryTimer = setTimeout(tryLoad, 500);
  };

  const cleanup = (): void => {
    clearRetry();
    window.webContents.off("did-fail-load", onFailLoad);
  };

  const tryLoad = (): void => {
    attempt += 1;
    void window.loadURL(rendererUrl);
  };

  window.webContents.on("did-fail-load", onFailLoad);
  window.webContents.once("did-finish-load", cleanup);
  window.once("closed", cleanup);
  window.webContents.once("destroyed", cleanup);
  tryLoad();
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
    fullscreenable: true,
    frame: isMac,
    ...(isMac
      ? {
          acceptFirstMouse: true,
          trafficLightPosition: LYRA_MAC_WINDOW_BUTTON_POSITION,
          titleBarOverlay: {
            height: LYRA_MAC_TITLEBAR_OVERLAY_HEIGHT
          }
        }
      : {}),
    ...windowMaterialDecision.options,
    autoHideMenuBar: true,
    titleBarStyle: isMac ? "hidden" : "default",
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
  applyMacWindowButtonPosition(window);

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (typeof rendererUrl === "string" && rendererUrl.length > 0) {
    if (isDevelopmentMode()) {
      loadRendererInDevelopment(window, rendererUrl);
    } else {
      void window.loadURL(rendererUrl);
    }
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
    applyMacWindowButtonPosition(window);
    publishWindowState(window);
    requestWorkbenchLayoutReapply(window);
  });
  window.on("blur", () => publishWindowState(window));
  window.on("maximize", () => {
    publishWindowState(window);
    requestWorkbenchLayoutReapply(window);
  });
  window.on("unmaximize", () => {
    publishWindowState(window);
    requestWorkbenchLayoutReapply(window);
  });
  window.on("enter-full-screen", () => {
    lastKnownWindowFullScreenState = true;
    if (pendingMacFullScreenTarget === null) {
      beginFullscreenLayoutTransition(window);
    }
    applyMacWindowButtonPosition(window);
    publishWindowState(window);
    settleFullscreenLayout(window);
    setTimeout(() => applyMacWindowButtonPosition(window), 400);
  });
  window.on("leave-full-screen", () => {
    lastKnownWindowFullScreenState = false;
    pendingMacFullScreenTarget = null;
    if (fullscreenLayoutTransitionActive === false) {
      beginFullscreenLayoutTransition(window);
    }
    applyMacWindowButtonPosition(window);
    publishWindowState(window);
    settleFullscreenLayout(window);
    setTimeout(() => applyMacWindowButtonPosition(window), 400);
  });
  window.on("enter-html-full-screen", () => {
    publishWindowState(window);
    requestWorkbenchLayoutReapply(window);
  });
  window.on("leave-html-full-screen", () => {
    publishWindowState(window);
    requestWorkbenchLayoutReapply(window);
  });
  window.on("resize", createReapplyLayoutScheduler(window, () => {
    requestWorkbenchLayoutReapply(window);
  }));
  window.on("closed", () => {
    clearFullscreenLayoutSettleTimer();
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
  const filesBridge = createFilesIpcBridge(storageRoots.modules.fileManager, {
    createPreviewUrl: lyraFileAccess.createPreviewUrl
  });
  console.info(`[lyra-files] native loaded: ${filesBridge.loadResult.loadedFrom}`);
  disposeFilesBridge = filesBridge.dispose;
  const imageViewerBridge = createImageViewerIpcBridge(storageRoots.modules.imageViewer, {
    createPreviewUrl: lyraFileAccess.createPreviewUrl
  });
  console.info(`[lyra-image-viewer] native loaded: ${imageViewerBridge.loadResult.loadedFrom}`);
  disposeImageViewerBridge = imageViewerBridge.dispose;
  const identityBridge = createIdentityIpcBridge(storageRoots.modules.identity, {
    createPreviewUrl: lyraFileAccess.createPreviewUrl,
    addAllowedRoot: lyraFileAccess.addAllowedRoot
  });
  disposeIdentityBridge = identityBridge.dispose;
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

  const searchBridge = createSearchIpcBridge();
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
    workbenchState: workbenchStateBridge,
    addAllowedPreviewRoot: lyraFileAccess.addAllowedRoot,
    resolveSensitiveValueForFill: sensitiveValuesBridge.resolveForAgentFill
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
    performanceScheduler,
    deferLayoutSync: deferWorkbenchBrowserLayoutSync
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
    const window = mainWindow;
    if (window === null || window.isDestroyed()) {
      return;
    }
    if (process.platform === "darwin" && isWindowFullScreen(window)) {
      setMacWindowFullScreen(window, false);
      setTimeout(() => {
        if (!window.isDestroyed()) {
          window.minimize();
        }
      }, 120);
      return;
    }
    window.minimize();
  });

  ipcMain.handle(LYRA_CHANNELS.toggleWindowMaximize, () => {
    if (mainWindow === null) {
      return;
    }
    if (process.platform === "darwin") {
      const nextFullScreenState = !isWindowFullScreen(mainWindow);
      setMacWindowFullScreen(mainWindow, nextFullScreenState);
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

  ipcMain.handle(
    LYRA_CHANNELS.legalReadThirdPartyNotices,
    readThirdPartyNoticesDocument
  );

  ipcMain.handle(LYRA_CHANNELS.openExternal, async (_event, url: string): Promise<boolean> => {
    if (typeof url !== "string" || url.length === 0 || isSafeExternalUrl(url) === false) {
      return false;
    }
    try {
      await shell.openExternal(url);
      return true;
    } catch (_error) {
      return false;
    }
  });

  const KNOWN_EDITORS: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly bundle?: string;
    readonly cmd?: string;
  }> = [
    { id: "vscode", label: "VS Code", bundle: "Visual Studio Code.app", cmd: "code" },
    { id: "vscode-insiders", label: "VS Code Insiders", bundle: "VS Code - Insiders.app", cmd: "code-insiders" },
    { id: "cursor", label: "Cursor", bundle: "Cursor.app", cmd: "cursor" },
    { id: "windsurf", label: "Windsurf", bundle: "Windsurf.app", cmd: "windsurf" },
    { id: "zed", label: "Zed", bundle: "Zed.app", cmd: "zed" },
    { id: "sublime", label: "Sublime Text", bundle: "Sublime Text.app", cmd: "subl" },
    { id: "xcode", label: "Xcode", bundle: "Xcode.app" },
    { id: "nova", label: "Nova", bundle: "Nova.app" },
    { id: "webstorm", label: "WebStorm", bundle: "WebStorm.app", cmd: "webstorm" },
    { id: "intellij", label: "IntelliJ IDEA", bundle: "IntelliJ IDEA.app", cmd: "idea" },
    { id: "goland", label: "GoLand", bundle: "GoLand.app", cmd: "goland" },
    { id: "pycharm", label: "PyCharm", bundle: "PyCharm.app", cmd: "pycharm" },
    { id: "phpstorm", label: "PhpStorm", bundle: "PhpStorm.app", cmd: "phpstorm" },
    { id: "android-studio", label: "Android Studio", bundle: "Android Studio.app", cmd: "studio" },
    { id: "coderunner", label: "CodeRunner", bundle: "CodeRunner.app" },
  ];

  ipcMain.handle(LYRA_CHANNELS.detectEditors, async (): Promise<DetectedEditor[]> => {
    const plat = platform();
    const found = new Map<string, DetectedEditor>();
    const macAppDirs = plat === "darwin" ? ["/Applications", join(homedir(), "Applications")] : [];

    for (const ed of KNOWN_EDITORS) {
      if (found.has(ed.id)) continue;
      let detected = false;

      if (plat === "darwin" && ed.bundle) {
        for (const dir of macAppDirs) {
          const appPath = join(dir, ed.bundle);
          if (existsSync(appPath)) {
            let icon: string | undefined;
            try {
              const img = await app.getFileIcon(appPath, { size: "small" });
              icon = img.toDataURL();
            } catch { /* icon unavailable */ }
            found.set(ed.id, icon !== undefined ? { id: ed.id, label: ed.label, icon } : { id: ed.id, label: ed.label });
            detected = true;
            break;
          }
        }
      }
      if (detected) continue;

      if (ed.cmd) {
        try {
          execSync(plat === "win32" ? `where ${ed.cmd}` : `which ${ed.cmd}`, { stdio: "ignore" });
          found.set(ed.id, { id: ed.id, label: ed.label });
        } catch { /* not found */ }
      }
    }

    return [...found.values()];
  });

  ipcMain.handle(LYRA_CHANNELS.openInEditor, async (_event, request: OpenInEditorRequest): Promise<boolean> => {
    if (!request || typeof request.editorId !== "string" || typeof request.path !== "string") {
      return false;
    }
    const targetPath = request.path.trim();
    if (targetPath.length === 0) {
      return false;
    }
    const ed = KNOWN_EDITORS.find((e) => e.id === request.editorId);
    if (ed === undefined) return false;
    const plat = platform();
    try {
      await stat(targetPath);
      if (plat === "darwin" && ed.bundle) {
        await execFileAsync("open", ["-a", ed.bundle.replace(/\.app$/u, ""), targetPath]);
      } else if (ed.cmd) {
        await execFileAsync(ed.cmd, [targetPath]);
      } else {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle(LYRA_CHANNELS.revealInFolder, async (_event, path: string): Promise<boolean> => {
    const targetPath = typeof path === "string" ? path.trim() : "";
    if (targetPath.length === 0) {
      return false;
    }
    try {
      await stat(targetPath);
      shell.showItemInFolder(targetPath);
      return true;
    } catch {
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
  disposeAutoUpdateService = createAutoUpdateService(app);
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
  if (disposeIdentityBridge !== null) {
    disposeIdentityBridge();
    disposeIdentityBridge = null;
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
  if (disposeAutoUpdateService !== null) {
    disposeAutoUpdateService();
    disposeAutoUpdateService = null;
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
