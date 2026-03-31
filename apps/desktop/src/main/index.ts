import { app, BrowserWindow, ipcMain, protocol, shell } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createAiIpcBridge } from "./ai";
import { createFilesIpcBridge } from "./files";
import { createComputerIpcBridge } from "./computer";
import { createLspIpcBridge } from "./lsp";
import { createLinuxCompatBridge } from "./linux-compat";
import { createMcpIpcBridge } from "./mcp";
import { createSystemImageIpcBridge } from "./system-image";
import { aggregateSearch } from "./search";
import { createSkillsIpcBridge } from "./skills";
import {
  applyElectronStoragePaths,
  ensureLyraStorageRoots,
  resolveLyraStorageRoots
} from "./storage";
import { createTerminalIpcBridge } from "./terminal";
import { createWorkbenchStateIpcBridge } from "./workbench-state";
import {
  LYRA_CHANNELS,
  type AppMetaPayload,
  type LinuxCompatExportResponse,
  type SearchAggregateRequest,
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
  }
]);

let mainWindow: BrowserWindow | null = null;
let disposeAiBridge: (() => void) | null = null;
let disposeTerminalBridge: (() => void) | null = null;
let disposeFilesBridge: (() => void) | null = null;
let disposeComputerBridge: (() => void) | null = null;
let disposeSystemImageBridge: (() => void) | null = null;
let disposeLspBridge: (() => void) | null = null;
let disposeMcpBridge: (() => Promise<void>) | null = null;
let disposeSkillsBridge: (() => Promise<void>) | null = null;
let disposeWorkbenchStateBridge: (() => void) | null = null;

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

const toWindowState = (window: BrowserWindow): WindowStatePayload => ({
  isFocused: window.isFocused(),
  isMaximized: window.isMaximized()
});

const publishWindowState = (window: BrowserWindow): void => {
  window.webContents.send(LYRA_CHANNELS.windowStateChanged, toWindowState(window));
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
  if (typeof process.env.ELECTRON_RENDERER_URL !== "string" || process.env.ELECTRON_RENDERER_URL.length === 0) {
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

const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    title: "Lyra",
    width: 1460,
    height: 920,
    minWidth: 1160,
    minHeight: 720,
    frame: false,
    backgroundColor: "#dcdcdd",
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hidden" : "default",
    webPreferences: {
      preload: join(currentDir, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true
    }
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (typeof rendererUrl === "string" && rendererUrl.length > 0) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(currentDir, "../renderer/index.html"));
  }

  attachDevelopmentDiagnostics(window);

  window.on("focus", () => publishWindowState(window));
  window.on("blur", () => publishWindowState(window));
  window.on("maximize", () => publishWindowState(window));
  window.on("unmaximize", () => publishWindowState(window));

  return window;
};

const registerIpcHandlers = (): void => {
  const aiBridge = createAiIpcBridge(storageRoots.modules.ai, () => mainWindow);
  console.info(`[lyra-ai] native bridge ready`);
  disposeAiBridge = aiBridge.dispose;

  const filesBridge = createFilesIpcBridge(storageRoots.modules.fileManager);
  console.info(`[lyra-files] native loaded: ${filesBridge.loadResult.loadedFrom}`);
  disposeFilesBridge = filesBridge.dispose;

  const computerBridge = createComputerIpcBridge(storageRoots.modules.computer, () => mainWindow);
  console.info(`[lyra-computer] native loaded: ${computerBridge.loadResult.loadedFrom}`);
  disposeComputerBridge = computerBridge.dispose;

  const systemImageBridge = createSystemImageIpcBridge(storageRoots.modules.systemImages, () => mainWindow);
  console.info(`[lyra-system-image] native loaded: ${systemImageBridge.loadResult.loadedFrom}`);
  disposeSystemImageBridge = systemImageBridge.dispose;

  const terminalBridge = createTerminalIpcBridge(storageRoots.modules.terminal, () => mainWindow);
  console.info(`[lyra-terminal] native loaded: ${terminalBridge.loadResult.loadedFrom}`);
  disposeTerminalBridge = terminalBridge.dispose;

  const lspBridge = createLspIpcBridge(() => mainWindow);
  console.info(`[lyra-lsp] native loaded: ${lspBridge.loadResult.loadedFrom}`);
  disposeLspBridge = lspBridge.dispose;

  const mcpBridge = createMcpIpcBridge(
    storageRoots.modules.mcp,
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

  const workbenchStateBridge = createWorkbenchStateIpcBridge(
    storageRoots.modules.workbenchState
  );
  disposeWorkbenchStateBridge = workbenchStateBridge.dispose;

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

  ipcMain.handle(
    LYRA_CHANNELS.aggregateSearch,
    async (_event, request: SearchAggregateRequest) => aggregateSearch(request)
  );
};

app.whenReady().then(() => {
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
  if (disposeAiBridge !== null) {
    disposeAiBridge();
    disposeAiBridge = null;
  }
  if (disposeFilesBridge !== null) {
    disposeFilesBridge();
    disposeFilesBridge = null;
  }
  if (disposeComputerBridge !== null) {
    disposeComputerBridge();
    disposeComputerBridge = null;
  }
  if (disposeSystemImageBridge !== null) {
    disposeSystemImageBridge();
    disposeSystemImageBridge = null;
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
  if (disposeWorkbenchStateBridge !== null) {
    disposeWorkbenchStateBridge();
    disposeWorkbenchStateBridge = null;
  }
});
