import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import fs from "node:fs";
import path from "node:path";

import {
  LYRA_CHANNELS,
  type LspCompletionRequest,
  type LspDocumentRequest,
  type LspRuntimeEvent
} from "../../shared/desktop-bridge";
import {
  createBackpressuredEventSender,
  estimateSerializedBytes
} from "../events/backpressure";
import { resolveBundledRustAnalyzerCandidates } from "./runtime-paths";
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

export const configureLanguageServerEnvironment = (): void => {
  const roots = resolveSearchRoots();
  const rustAnalyzerCandidates = resolveBundledRustAnalyzerCandidates(
    roots,
    process.platform,
    process.arch
  );

  setEnvIfResolved("LYRA_LSP_TYPESCRIPT_SERVER", "typescript-language-server");
  setEnvIfResolved(
    "LYRA_LSP_RUST_ANALYZER",
    "rust-analyzer",
    rustAnalyzerCandidates
  );
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
  if (
    value === "typescript" ||
    value === "javascript" ||
    value === "rust" ||
    value === "python"
  ) {
    return value;
  }
  throw new Error(`unsupported language: ${value}`);
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

  if (projectRoot !== undefined) {
    return {
      ...request,
      projectRoot
    };
  }

  return request;
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

  if (projectRoot !== undefined) {
    return {
      ...request,
      projectRoot
    };
  }

  return request;
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
  return [
    "error",
    event.sessionId ?? "*",
    event.filePath ?? "*",
    event.languageId ?? "*",
    event.projectRoot ?? "*",
    event.message
  ].join(":");
};

export type LspIpcBridge = {
  readonly dispose: () => void;
  readonly loadResult: { readonly loadedFrom: string };
};

export const createLspIpcBridge = (
  runtimeClient: LyraRuntimeClient,
  getWindow: () => BrowserWindow | null
): LspIpcBridge => {
  configureLanguageServerEnvironment();
  const eventSender = createBackpressuredEventSender<LspRuntimeEvent>({
    name: "lsp.event",
    intervalMs: LSP_EVENT_THROTTLE_MS,
    maxQueueSize: LSP_EVENT_MAX_QUEUE_SIZE,
    keyFor: lspEventKey,
    merge: (_current, incoming) => incoming,
    estimateBytes: estimateSerializedBytes,
    send: (event) => {
      const window = getWindow();
      if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) {
        return;
      }
      window.webContents.send(LYRA_CHANNELS.lspEvent, event);
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

  const handlers: Array<readonly [string, (_event: IpcMainInvokeEvent, payload: unknown) => unknown]> = [
    [
      LYRA_CHANNELS.lspOpenDocument,
      (_event, payload) =>
        requestRuntime<void>(
          "lsp.documents.open",
          normalizeDocumentRequest(payload as LspDocumentRequest)
        )
    ],
    [
      LYRA_CHANNELS.lspChangeDocument,
      (_event, payload) =>
        requestRuntime<void>(
          "lsp.documents.change",
          normalizeDocumentRequest(payload as LspDocumentRequest)
        )
    ],
    [
      LYRA_CHANNELS.lspSaveDocument,
      (_event, payload) =>
        requestRuntime<void>(
          "lsp.documents.save",
          normalizeDocumentRequest(payload as LspDocumentRequest)
        )
    ],
    [
      LYRA_CHANNELS.lspCloseDocument,
      (_event, payload) =>
        requestRuntime<void>(
          "lsp.documents.close",
          normalizeDocumentRequest(payload as LspDocumentRequest)
        )
    ],
    [
      LYRA_CHANNELS.lspCompletion,
      (_event, payload) =>
        requestRuntime(
          "lsp.completion",
          normalizeCompletionRequest(payload as LspCompletionRequest)
        )
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
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
      unsubscribeRuntimeEvents();
      eventSender.dispose();
    }
  };
};
