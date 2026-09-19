import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";

import {
  LYRA_CHANNELS,
  type LspCompletionRequest,
  type LspDiagnostic,
  type LspDocumentRequest,
  type LspPositionRequest,
  type LspRuntimeEvent
} from "../../shared/desktop-bridge";
import {
  createBackpressuredEventSender,
  estimateSerializedBytes
} from "../events/backpressure";
import { sendToWindow } from "../web-contents-ipc";
import { resolveBundledRustAnalyzerCandidates } from "./runtime-paths";
import type { TypeScriptProjectFileDiagnostics } from "./tsconfig-option-diagnostics";
import type { LyraRuntimeClient } from "../runtime-client";

type LspServerEnvKey =
  | "LYRA_LSP_TYPESCRIPT_SERVER"
  | "LYRA_LSP_RUST_ANALYZER"
  | "LYRA_LSP_PYRIGHT";

const LSP_EVENT_THROTTLE_MS = 100;
const LSP_EVENT_MAX_QUEUE_SIZE = 128;

const candidateFileNames = (baseName: string): readonly string[] => {
  if (process.platform !== "win32") {
    return [baseName];
  }
  return [`${baseName}.cmd`, `${baseName}.exe`, `${baseName}.bat`, baseName];
};

const resolveSearchRoots = (): readonly string[] => {
  const roots = new Set<string>([process.cwd()]);
  if (typeof process.resourcesPath === "string" && process.resourcesPath.length > 0) {
    roots.add(process.resourcesPath);
  }
  if (typeof __dirname === "string" && __dirname.length > 0) {
    let cursor = path.resolve(__dirname);
    for (let i = 0; i < 6; i += 1) {
      roots.add(cursor);
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  }
  return Array.from(roots);
};

const pickFirstExisting = (candidates: readonly string[]): string | null => {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

const resolveLanguageServerPath = (
  binaryName: string,
  extraCandidates: readonly string[] = []
): string | null => {
  const roots = resolveSearchRoots();
  const names = candidateFileNames(binaryName);
  const candidates: string[] = [...extraCandidates];

  for (const root of roots) {
    for (const name of names) {
      candidates.push(path.resolve(root, "lsp", name));
      candidates.push(path.resolve(root, "resources", "lsp", name));
      candidates.push(path.resolve(root, "node_modules", ".bin", name));
      candidates.push(path.resolve(root, "apps", "desktop", "node_modules", ".bin", name));
    }
  }

  return pickFirstExisting(candidates);
};

const setTypescriptSixTsserverPath = (roots: readonly string[]): void => {
  const alreadySet = process.env.LYRA_TSSERVER_PATH;
  if (typeof alreadySet === "string" && alreadySet.trim().length > 0) {
    return;
  }
  const packageJsons = roots.flatMap((root) => [
    path.join(root, "web/docs/package.json"),
    path.join(root, "web/site/package.json")
  ]);
  for (const packageJson of packageJsons) {
    if (fs.existsSync(packageJson) === false) {
      continue;
    }
    try {
      const requireFromPackage = createRequire(packageJson);
      const typescriptPackageJson = requireFromPackage.resolve("typescript/package.json");
      const version = JSON.parse(fs.readFileSync(typescriptPackageJson, "utf8")) as {
        readonly version?: string;
      };
      if (typeof version.version !== "string" || version.version.startsWith("6.") === false) {
        continue;
      }
      const tsserver = path.join(path.dirname(typescriptPackageJson), "lib", "tsserver.js");
      if (fs.existsSync(tsserver)) {
        process.env.LYRA_TSSERVER_PATH = tsserver;
        console.info(`[lyra-lsp] LYRA_TSSERVER_PATH=${tsserver}`);
        return;
      }
    } catch {
      // try the next workspace package that may depend on TypeScript 6
    }
  }
  for (const root of roots) {
    const pnpm = path.join(root, "node_modules/.pnpm");
    if (fs.existsSync(pnpm) === false) {
      continue;
    }
    const match = fs.readdirSync(pnpm).find((name) => name.startsWith("typescript@6."));
    if (match === undefined) {
      continue;
    }
    const tsserver = path.join(pnpm, match, "node_modules/typescript/lib/tsserver.js");
    if (fs.existsSync(tsserver)) {
      process.env.LYRA_TSSERVER_PATH = tsserver;
      console.info(`[lyra-lsp] LYRA_TSSERVER_PATH=${tsserver}`);
      return;
    }
  }
};

const setEnvIfResolved = (
  envKey: LspServerEnvKey,
  binaryName: string,
  extraCandidates: readonly string[] = []
): void => {
  const alreadySet = process.env[envKey];
  if (typeof alreadySet === "string" && alreadySet.trim().length > 0) {
    return;
  }

  const resolved = resolveLanguageServerPath(binaryName, extraCandidates);
  if (resolved === null) {
    return;
  }

  process.env[envKey] = resolved;
  console.info(`[lyra-lsp] ${envKey}=${resolved}`);
};

export const configureLanguageServerEnvironment = ({
  allowRustAnalyzerFallback = true
}: {
  readonly allowRustAnalyzerFallback?: boolean;
} = {}): void => {
  const roots = resolveSearchRoots();
  const rustAnalyzerCandidates = allowRustAnalyzerFallback
    ? resolveBundledRustAnalyzerCandidates(
        roots,
        process.platform,
        process.arch
      )
    : [];

  setEnvIfResolved("LYRA_LSP_TYPESCRIPT_SERVER", "typescript-language-server");
  setTypescriptSixTsserverPath(roots);
  const configuredRustAnalyzer =
    typeof process.env.LYRA_LSP_RUST_ANALYZER === "string"
    && process.env.LYRA_LSP_RUST_ANALYZER.trim().length > 0;
  if (!allowRustAnalyzerFallback && !configuredRustAnalyzer) {
    throw new Error(
      "Packaged rust-analyzer requires an active signed resource component."
    );
  }
  if (allowRustAnalyzerFallback || configuredRustAnalyzer) {
    setEnvIfResolved(
      "LYRA_LSP_RUST_ANALYZER",
      "rust-analyzer",
      rustAnalyzerCandidates
    );
  }
  setEnvIfResolved("LYRA_LSP_PYRIGHT", "pyright-langserver");
};

const normalizePath = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("path is required");
  }
  return trimmed;
};

const normalizeSessionId = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("sessionId is required");
  }
  return trimmed;
};

const normalizeProjectRoot = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeVersion = (value: number): number => {
  if (Number.isFinite(value) === false) {
    return 1;
  }
  const rounded = Math.trunc(value);
  return rounded > 0 ? rounded : 1;
};

const normalizeLanguage = (value: string): LspDocumentRequest["languageId"] => {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed === "plaintext" || trimmed === "markdown") {
    throw new Error(`unsupported language: ${value}`);
  }
  return trimmed;
};

const inferProjectRoot = (filePath: string): string | undefined => {
  let cursor = path.dirname(filePath);
  for (let depth = 0; depth < 24; depth += 1) {
    const markers = [
      ".git",
      "Cargo.toml",
      "package.json",
      "go.mod",
      "pyproject.toml",
      "requirements.txt"
    ];
    if (markers.some((marker) => fs.existsSync(path.join(cursor, marker)))) {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return undefined;
};

const withProjectRoot = <T extends { readonly projectRoot?: string; readonly filePath: string }>(
  request: T
): T => {
  if (typeof request.projectRoot === "string" && request.projectRoot.trim().length > 0) {
    return request;
  }
  const inferred = inferProjectRoot(request.filePath);
  if (inferred === undefined) {
    return request;
  }
  return {
    ...request,
    projectRoot: inferred
  };
};

const normalizeDocumentRequest = (
  payload: LspDocumentRequest
): LspDocumentRequest => {
  const projectRoot = normalizeProjectRoot(payload.projectRoot);
  const request: LspDocumentRequest = {
    sessionId: normalizeSessionId(payload.sessionId),
    filePath: normalizePath(payload.filePath),
    languageId: normalizeLanguage(payload.languageId),
    content:
      typeof payload.content === "string"
        ? payload.content
        : String(payload.content ?? ""),
    version: normalizeVersion(payload.version)
  };
  return withProjectRoot(
    projectRoot === undefined ? request : { ...request, projectRoot }
  );
};

const normalizeCompletionRequest = (
  payload: LspCompletionRequest
): LspCompletionRequest => {
  const projectRoot = normalizeProjectRoot(payload.projectRoot);
  const request: LspCompletionRequest = {
    sessionId: normalizeSessionId(payload.sessionId),
    filePath: normalizePath(payload.filePath),
    languageId: normalizeLanguage(payload.languageId),
    line: Math.max(0, Math.trunc(payload.line)),
    column: Math.max(0, Math.trunc(payload.column)),
    version: normalizeVersion(payload.version)
  };
  return withProjectRoot(
    projectRoot === undefined ? request : { ...request, projectRoot }
  );
};

const normalizePositionRequest = (payload: LspPositionRequest): LspPositionRequest => {
  const projectRoot = normalizeProjectRoot(payload.projectRoot);
  const request: LspPositionRequest = {
    filePath: normalizePath(payload.filePath),
    languageId: normalizeLanguage(payload.languageId),
    line: Math.max(0, Math.trunc(payload.line)),
    column: Math.max(0, Math.trunc(payload.column))
  };
  return withProjectRoot(
    projectRoot === undefined ? request : { ...request, projectRoot }
  );
};

const parseEvent = (payload: unknown): LspRuntimeEvent | null => {
  if (payload === null || typeof payload !== "object") {
    return null;
  }
  if ("kind" in payload === false) {
    return null;
  }
  const candidate = payload as LspRuntimeEvent;
  if (typeof candidate.kind !== "string") {
    return null;
  }
  return candidate;
};

const lspEventKey = (event: LspRuntimeEvent): string => {
  if (event.kind === "server-status") {
    return `server-status:${event.languageId ?? "*"}:${event.projectRoot ?? "*"}`;
  }
  if (event.kind === "diagnostics") {
    return `diagnostics:${event.filePath ?? "*"}`;
  }
  if (event.kind === "acquire") {
    return `acquire:${event.serverId ?? event.acquireId ?? "*"}:${event.status ?? "*"}`;
  }
  return [
    "error",
    event.sessionId ?? "*",
    event.filePath ?? "*",
    event.languageId ?? "*",
    event.projectRoot ?? "*",
    event.message
  ].join(":");
};

const enqueueProjectFileGroups = (
  groups: readonly TypeScriptProjectFileDiagnostics[],
  enqueue: (filePath: string, diagnostics: readonly LspDiagnostic[]) => void
): void => {
  for (const group of groups) {
    if (group.diagnostics.length === 0) {
      continue;
    }
    enqueue(group.filePath, group.diagnostics);
  }
};

let projectDiagnosticsWorker: Worker | null = null;
let optionDiagnosticsWorker: Worker | null = null;
let pendingOptionDiagnosticsJob: {
  readonly filePath: string;
  readonly content: string;
  readonly tsserverPath: string;
  readonly enqueue: (filePath: string, diagnostics: readonly LspDiagnostic[]) => void;
} | null = null;

const projectDiagnosticsWorkerPath = (): string =>
  path.join(__dirname, "tsconfig-project-diagnostics.cjs");

const stopProjectDiagnosticsWorker = (): void => {
  if (projectDiagnosticsWorker === null) {
    return;
  }
  void projectDiagnosticsWorker.terminate();
  projectDiagnosticsWorker = null;
};

const stopOptionDiagnosticsWorker = (): void => {
  pendingOptionDiagnosticsJob = null;
  if (optionDiagnosticsWorker === null) {
    return;
  }
  void optionDiagnosticsWorker.terminate();
  optionDiagnosticsWorker = null;
};

const startTypeScriptConfigOptionDiagnostics = (
  filePath: string,
  content: string,
  tsserverPath: string,
  enqueue: (filePath: string, diagnostics: readonly LspDiagnostic[]) => void
): boolean => {
  const workerPath = projectDiagnosticsWorkerPath();
  if (fs.existsSync(workerPath) === false) {
    console.warn("[lyra-lsp] skip tsconfig option diagnostics: worker missing");
    return false;
  }
  if (optionDiagnosticsWorker !== null) {
    pendingOptionDiagnosticsJob = { filePath, content, tsserverPath, enqueue };
    return true;
  }
  try {
    const worker = new Worker(workerPath, {
      workerData: {
        mode: "options",
        filePath,
        content,
        tsserverPath
      }
    });
    worker.on("message", (message: { readonly groups?: readonly TypeScriptProjectFileDiagnostics[] }) => {
      for (const group of message.groups ?? []) {
        enqueue(group.filePath, group.diagnostics);
      }
    });
    worker.on("error", () => {
      if (optionDiagnosticsWorker === worker) {
        optionDiagnosticsWorker = null;
      }
    });
    worker.on("exit", () => {
      if (optionDiagnosticsWorker === worker) {
        optionDiagnosticsWorker = null;
      }
      const pending = pendingOptionDiagnosticsJob;
      pendingOptionDiagnosticsJob = null;
      if (pending !== null) {
        startTypeScriptConfigOptionDiagnostics(
          pending.filePath,
          pending.content,
          pending.tsserverPath,
          pending.enqueue
        );
      }
    });
    optionDiagnosticsWorker = worker;
    return true;
  } catch (error) {
    console.warn(`[lyra-lsp] skip tsconfig option diagnostics: ${String(error)}`);
    return false;
  }
};

const startTypeScriptProjectFileDiagnostics = (
  rootPath: string,
  tsserverPath: string | undefined,
  enqueue: (filePath: string, diagnostics: readonly LspDiagnostic[]) => void
): void => {
  // ponytail: never createProgram on Electron main — that starves file-tree IPC.
  // Missing worker skips the scan rather than freezing the workbench.
  if (typeof tsserverPath !== "string" || rootPath.length === 0) {
    return;
  }
  const workerPath = projectDiagnosticsWorkerPath();
  if (fs.existsSync(workerPath) === false) {
    console.warn("[lyra-lsp] skip project diagnostics: worker missing");
    return;
  }
  stopProjectDiagnosticsWorker();
  try {
    const worker = new Worker(workerPath, {
      workerData: { rootPath, tsserverPath }
    });
    worker.on("message", (message: { readonly groups?: readonly TypeScriptProjectFileDiagnostics[] }) => {
      enqueueProjectFileGroups(message.groups ?? [], enqueue);
    });
    worker.on("error", () => {
      stopProjectDiagnosticsWorker();
    });
    worker.on("exit", () => {
      if (projectDiagnosticsWorker === worker) {
        projectDiagnosticsWorker = null;
      }
    });
    projectDiagnosticsWorker = worker;
  } catch (error) {
    console.warn(`[lyra-lsp] skip project diagnostics: ${String(error)}`);
  }
};

export type LspIpcBridge = {
  readonly dispose: () => void;
  readonly loadResult: { readonly loadedFrom: string };
};

export type RustAnalyzerResourceLeaseRunner = <T>(
  operation: () => Promise<T>
) => Promise<T>;

export const createLspIpcBridge = (
  runtimeClient: LyraRuntimeClient,
  getWindow: () => BrowserWindow | null,
  {
    allowRustAnalyzerFallback = true,
    withRustAnalyzerResource
  }: {
    readonly allowRustAnalyzerFallback?: boolean;
    readonly withRustAnalyzerResource?: RustAnalyzerResourceLeaseRunner;
  } = {}
): LspIpcBridge => {
  configureLanguageServerEnvironment({ allowRustAnalyzerFallback });
  const eventSender = createBackpressuredEventSender<LspRuntimeEvent>({
    name: "lsp.event",
    intervalMs: LSP_EVENT_THROTTLE_MS,
    maxQueueSize: LSP_EVENT_MAX_QUEUE_SIZE,
    keyFor: lspEventKey,
    merge: (_current, incoming) => incoming,
    estimateBytes: estimateSerializedBytes,
    send: (event) => {
      sendToWindow(getWindow(), LYRA_CHANNELS.lspEvent, event);
    },
    onError: (error) => {
      console.warn(`[lyra-lsp] failed to send throttled event: ${String(error)}`);
    }
  });
  const unsubscribeRuntimeEvents = runtimeClient.subscribe((eventName, payload) => {
    if (eventName !== "lsp.runtime") {
      return;
    }
    const event = parseEvent(payload);
    if (event === null) {
      return;
    }

    eventSender.enqueue(event);
  });
  const requestRuntime = async <T>(method: string, payload: unknown): Promise<T> =>
    await runtimeClient.request<T>(method, payload);
  const persistQueue: Array<{ readonly filePath: string; readonly diagnostics: readonly LspDiagnostic[] }> = [];
  let persistPumping = false;
  let persistUnsupported = false;
  const isPersistUnsupportedError = (error: unknown): boolean => {
    const code = error !== null && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
    const message = error instanceof Error ? error.message : String(error);
    return code === "METHOD_NOT_FOUND" || message.includes("unknown lsp runtime method: lsp.upsert");
  };
  const pumpPersistedDiagnostics = (): void => {
    if (persistUnsupported) {
      persistQueue.length = 0;
      persistPumping = false;
      return;
    }
    const batch = persistQueue.splice(0, 4);
    if (batch.length === 0) {
      persistPumping = false;
      return;
    }
    void Promise.all(
      batch.map((item) =>
        requestRuntime("lsp.upsert", item).catch((error) => {
          if (isPersistUnsupportedError(error)) {
            if (persistUnsupported === false) {
              persistUnsupported = true;
              console.warn("[lyra-lsp] skip persisting diagnostics: runtime does not support lsp.upsert");
            }
            persistQueue.length = 0;
            return;
          }
          console.warn(`[lyra-lsp] failed to persist diagnostics: ${String(error)}`);
        })
      )
    ).then(() => {
      setImmediate(pumpPersistedDiagnostics);
    });
  };
  const persistWorkspaceDiagnostics = (
    filePath: string,
    diagnostics: readonly LspDiagnostic[]
  ): void => {
    eventSender.enqueue({
      kind: "diagnostics",
      filePath,
      diagnostics
    });
    if (persistUnsupported) {
      return;
    }
    persistQueue.push({ filePath, diagnostics });
    if (persistPumping) {
      return;
    }
    persistPumping = true;
    setImmediate(pumpPersistedDiagnostics);
  };
  const requestLanguageRuntime = async <T>(
    method: string,
    payload: LspDocumentRequest | LspCompletionRequest | LspPositionRequest
  ): Promise<T> => {
    const request = () => requestRuntime<T>(method, payload);
    return payload.languageId === "rust" && withRustAnalyzerResource !== undefined
      ? await withRustAnalyzerResource(request)
      : await request();
  };
  const isUnsupportedLanguageError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("language not supported:");
  };
  const enqueueTypeScriptConfigDiagnostics = (filePath: string, content: string): void => {
    const tsserverPath = process.env.LYRA_TSSERVER_PATH;
    if (typeof tsserverPath !== "string") {
      persistWorkspaceDiagnostics(filePath, []);
      return;
    }
    const started = startTypeScriptConfigOptionDiagnostics(
      filePath,
      content,
      tsserverPath,
      persistWorkspaceDiagnostics
    );
    if (started === false) {
      persistWorkspaceDiagnostics(filePath, []);
    }
  };
  const syncDocument = async (
    method: string,
    payload: LspDocumentRequest
  ): Promise<void> => {
    try {
      await requestLanguageRuntime<void>(method, payload);
    } catch (error) {
      if (isUnsupportedLanguageError(error)) {
        return;
      }
      throw error;
    }
  };

  const handlers: Array<readonly [string, (_event: IpcMainInvokeEvent, payload: unknown) => unknown]> = [
    [
      LYRA_CHANNELS.lspOpenDocument,
      (_event, payload) => {
        const request = normalizeDocumentRequest(payload as LspDocumentRequest);
        return syncDocument("lsp.documents.open", request);
      }
    ],
    [
      LYRA_CHANNELS.lspChangeDocument,
      (_event, payload) => {
        const request = normalizeDocumentRequest(payload as LspDocumentRequest);
        return syncDocument("lsp.documents.change", request);
      }
    ],
    [
      LYRA_CHANNELS.lspSaveDocument,
      (_event, payload) => {
        const request = normalizeDocumentRequest(payload as LspDocumentRequest);
        return syncDocument("lsp.documents.save", request);
      }
    ],
    [
      LYRA_CHANNELS.lspCloseDocument,
      (_event, payload) => {
        const request = normalizeDocumentRequest(payload as LspDocumentRequest);
        return syncDocument("lsp.documents.close", request);
      }
    ],
    [
      LYRA_CHANNELS.lspCompletion,
      (_event, payload) => {
        const request = normalizeCompletionRequest(payload as LspCompletionRequest);
        return requestLanguageRuntime(
          "lsp.completion",
          request
        );
      }
    ],
    [
      LYRA_CHANNELS.lspHover,
      (_event, payload) => {
        const request = normalizePositionRequest(payload as LspPositionRequest);
        return requestLanguageRuntime("lsp.hover", request);
      }
    ],
    [
      LYRA_CHANNELS.lspGotoDefinition,
      (_event, payload) => {
        const request = normalizePositionRequest(payload as LspPositionRequest);
        return requestLanguageRuntime("lsp.goto_definition", request);
      }
    ],
    [
      LYRA_CHANNELS.lspFindReferences,
      (_event, payload) => {
        const request = normalizePositionRequest(payload as LspPositionRequest);
        return requestLanguageRuntime("lsp.find_references", request);
      }
    ],
    [
      LYRA_CHANNELS.lspInspectTypeScriptConfig,
      (_event, payload) => {
        const request = payload as { readonly filePath?: unknown; readonly content?: unknown };
        const filePath = typeof request.filePath === "string" ? normalizePath(request.filePath) : "";
        const content = typeof request.content === "string" ? request.content : "";
        if (filePath.length === 0) {
          return;
        }
        enqueueTypeScriptConfigDiagnostics(filePath, content);
      }
    ],
    [
      LYRA_CHANNELS.lspInspectProjectProblems,
      (_event, payload) => {
        const request = payload as { readonly rootPath?: unknown };
        const rootPath = typeof request.rootPath === "string" ? normalizePath(request.rootPath) : "";
        if (rootPath.length === 0) {
          return;
        }
        startTypeScriptProjectFileDiagnostics(
          rootPath,
          process.env.LYRA_TSSERVER_PATH,
          persistWorkspaceDiagnostics
        );
      }
    ]
  ];

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return {
    loadResult: {
      loadedFrom: "lyrad"
    },
    dispose: () => {
      stopOptionDiagnosticsWorker();
      stopProjectDiagnosticsWorker();
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
      unsubscribeRuntimeEvents();
      eventSender.dispose();
    }
  };
};
