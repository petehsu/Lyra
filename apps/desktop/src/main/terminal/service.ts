import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
  LYRA_CHANNELS,
  type TerminalCloseRequest,
  type TerminalCreateRequest,
  type TerminalReloadPromptRequest,
  type TerminalReloadPromptResult,
  type TerminalResizeRequest,
  type TerminalRestoreRequest,
  type TerminalSessionSnapshot,
  type TerminalWriteRequest
} from "../../shared/desktop-bridge";
import {
  isTerminalThemePresetId,
  type TerminalThemePresetId
} from "../../shared/terminal-theme";
import { loadTerminalNativeBindings } from "./native-loader";
import {
  buildStarshipPromptInjection,
  createStarshipRuntime,
  describeStarshipRuntime
} from "./starship";
import type { TerminalNativeBindings, TerminalNativeLoadResult } from "./types";
const DEFAULT_TERMINAL_THEME_PRESET: TerminalThemePresetId = "glacier-blocks";
type SessionMeta = {
  readonly shell: string;
  readonly presetId: TerminalThemePresetId;
  readonly uiThemeId: string;
};
const sanitizeSize = (value: number, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < 1) return 1;
  if (rounded > 300) return 300;
  return rounded;
};
const normalizeTerminalPreset = (value: unknown): TerminalThemePresetId =>
  isTerminalThemePresetId(value) ? value : DEFAULT_TERMINAL_THEME_PRESET;
const normalizeRequestedShell = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (process.platform === "win32") {
    return undefined;
  }
  return "bash";
};
const normalizeCreateRequest = (request: TerminalCreateRequest): TerminalCreateRequest => {
  const normalizedShell = normalizeRequestedShell(request.shell);
  const normalizedUiThemeId =
    typeof request.uiThemeId === "string" && request.uiThemeId.trim().length > 0
      ? request.uiThemeId.trim()
      : "one-dark";
  return {
    cols: sanitizeSize(request.cols, 80),
    rows: sanitizeSize(request.rows, 24),
    source: request.source ?? "user",
    terminalThemePreset: normalizeTerminalPreset(request.terminalThemePreset),
    uiThemeId: normalizedUiThemeId,
    ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
    ...(request.title !== undefined ? { title: request.title } : {}),
    ...(request.cwd !== undefined ? { cwd: request.cwd } : {}),
    ...(normalizedShell !== undefined ? { shell: normalizedShell } : {})
  };
};
const normalizeRestoreRequest = (request: TerminalRestoreRequest): TerminalRestoreRequest => ({
  sessions: request.sessions.map((session) => normalizeCreateRequest(session))
});
const normalizeWriteRequest = (request: TerminalWriteRequest): TerminalWriteRequest => ({
  ...request,
  source: request.source ?? "user"
});
const normalizeResizeRequest = (request: TerminalResizeRequest): TerminalResizeRequest => ({
  ...request,
  cols: sanitizeSize(request.cols, 80),
  rows: sanitizeSize(request.rows, 24)
});
const normalizeReloadPromptRequest = (
  request: TerminalReloadPromptRequest
): TerminalReloadPromptRequest => ({
  ...request,
  uiThemeId:
    typeof request.uiThemeId === "string" && request.uiThemeId.trim().length > 0
      ? request.uiThemeId.trim()
      : "one-dark",
  terminalThemePreset: normalizeTerminalPreset(request.terminalThemePreset),
  source: request.source ?? "user"
});
const isSessionMissingError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /session not found/i.test(message);
};
const invokeIgnoreMissingSession = (
  bindings: TerminalNativeBindings,
  run: (native: TerminalNativeBindings) => void
): void => {
  try {
    run(bindings);
  } catch (error) {
    if (isSessionMissingError(error)) {
      return;
    }
    throw error;
  }
};
const isAiSource = (source: string | undefined): boolean => source === "ai";
const parseEventMeta = (value: unknown): { readonly kind: string; readonly sessionId: string } | null => {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.kind !== "string" || typeof candidate.sessionId !== "string") {
    return null;
  }
  return {
    kind: candidate.kind,
    sessionId: candidate.sessionId
  };
};
const createDeferredResult = (reason: string): TerminalReloadPromptResult => ({
  applied: false,
  deferred: true,
  reason
});
const createFallbackCreateRequest = (
  snapshot: TerminalSessionSnapshot
): TerminalCreateRequest => ({
  sessionId: snapshot.sessionId,
  title: snapshot.title,
  ...(snapshot.cwd !== undefined ? { cwd: snapshot.cwd } : {}),
  shell: snapshot.shell,
  uiThemeId: "one-dark",
  terminalThemePreset: DEFAULT_TERMINAL_THEME_PRESET,
  cols: snapshot.cols,
  rows: snapshot.rows,
  source: "user"
});
export type TerminalIpcBridge = {
  readonly dispose: () => void;
  readonly loadResult: Extract<TerminalNativeLoadResult, { readonly ok: true }>;
};
export const createTerminalIpcBridge = (
  storageRoot: string,
  getWindow: () => BrowserWindow | null
): TerminalIpcBridge => {
  const loadResult = loadTerminalNativeBindings();
  if (loadResult.ok === false) {
    throw new Error(
      `terminal native unavailable: ${loadResult.errorMessage}\ntried paths:\n${loadResult.triedPaths.join("\n")}`
    );
  }
  const bindings = loadResult.bindings;
  const runtime = createStarshipRuntime(storageRoot);
  const runtimeStatus = describeStarshipRuntime(runtime);
  const sessionMetaById = new Map<string, SessionMeta>();
  if (runtimeStatus.available) {
    console.info(
      `[lyra-terminal] starship runtime ${runtimeStatus.source}: ${runtimeStatus.binaryPath}`
    );
  } else {
    console.warn(
      `[lyra-terminal] starship runtime unavailable: ${runtimeStatus.reason ?? "unknown reason"}`
    );
  }
  const applyPromptInjection = (
    native: TerminalNativeBindings,
    sessionId: string,
    shell: string,
    presetId: TerminalThemePresetId,
    uiThemeId: string
  ): TerminalReloadPromptResult => {
    const injection = buildStarshipPromptInjection(runtime, {
      shell,
      presetId,
      uiThemeId
    });
    if (!injection.applied || injection.command === undefined) {
      return createDeferredResult(
        injection.reason ?? "prompt reload skipped for this shell/runtime"
      );
    }
    try {
      native.writeSession({
        sessionId,
        data: injection.command,
        source: "user"
      });
      return {
        applied: true,
        deferred: false
      };
    } catch (error) {
      if (isSessionMissingError(error)) {
        return createDeferredResult("session not found");
      }
      return createDeferredResult(
        error instanceof Error ? error.message : String(error)
      );
    }
  };
  const rememberSessionMeta = (
    snapshot: TerminalSessionSnapshot,
    request: TerminalCreateRequest
  ): SessionMeta => {
    const meta: SessionMeta = {
      shell: snapshot.shell,
      presetId: normalizeTerminalPreset(request.terminalThemePreset),
      uiThemeId: request.uiThemeId ?? "one-dark"
    };
    sessionMetaById.set(snapshot.sessionId, meta);
    return meta;
  };
  bindings.registerEventCallback((firstArg, secondArg) => {
    const eventCandidate = secondArg === undefined ? firstArg : secondArg;
    const meta = parseEventMeta(eventCandidate);
    if (meta?.kind === "exit") {
      sessionMetaById.delete(meta.sessionId);
    }
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.terminalEvent, eventCandidate);
  });
  const handlers: Array<
    readonly [string, (event: IpcMainInvokeEvent, payload: unknown) => unknown]
  > = [
    [
      LYRA_CHANNELS.terminalCreateSession,
      (_event, payload) => {
        const normalized = normalizeCreateRequest(payload as TerminalCreateRequest);
        if (isAiSource(normalized.source)) {
          throw new Error("ai terminal execution is disabled in v1");
        }
        const snapshot = bindings.createSession(normalized);
        const meta = rememberSessionMeta(snapshot, normalized);
        const promptResult = applyPromptInjection(
          bindings,
          snapshot.sessionId,
          meta.shell,
          meta.presetId,
          meta.uiThemeId
        );
        if (!promptResult.applied && promptResult.reason !== undefined) {
          console.info(
            `[lyra-terminal] prompt injection deferred id=${snapshot.sessionId} reason=${promptResult.reason}`
          );
        }
        console.info(
          `[lyra-terminal] session ready id=${snapshot.sessionId} shell=${snapshot.shell} cols=${snapshot.cols} rows=${snapshot.rows}`
        );
        return snapshot;
      }
    ],
    [
      LYRA_CHANNELS.terminalRestoreSessions,
      (_event, payload) => {
        const normalized = normalizeRestoreRequest(payload as TerminalRestoreRequest);
        const snapshots = bindings.restoreSessions(normalized);
        const requestBySessionId = new Map(
          normalized.sessions
            .filter((session) => typeof session.sessionId === "string")
            .map((session) => [session.sessionId as string, session])
        );
        for (const snapshot of snapshots) {
          const sourceRequest =
            requestBySessionId.get(snapshot.sessionId) ??
            normalized.sessions[0] ??
            createFallbackCreateRequest(snapshot);
          const meta = rememberSessionMeta(snapshot, sourceRequest);
          const promptResult = applyPromptInjection(
            bindings,
            snapshot.sessionId,
            meta.shell,
            meta.presetId,
            meta.uiThemeId
          );
          if (!promptResult.applied && promptResult.reason !== undefined) {
            console.info(
              `[lyra-terminal] prompt restore deferred id=${snapshot.sessionId} reason=${promptResult.reason}`
            );
          }
        }
        return snapshots;
      }
    ],
    [
      LYRA_CHANNELS.terminalReloadPrompt,
      (_event, payload) => {
        const normalized = normalizeReloadPromptRequest(
          payload as TerminalReloadPromptRequest
        );
        if (isAiSource(normalized.source)) {
          throw new Error("ai terminal execution is disabled in v1");
        }
        const knownMeta = sessionMetaById.get(normalized.sessionId);
        if (knownMeta === undefined) {
          return createDeferredResult("session metadata unavailable");
        }
        const presetId = normalizeTerminalPreset(normalized.terminalThemePreset);
        const result = applyPromptInjection(
          bindings,
          normalized.sessionId,
          knownMeta.shell,
          presetId,
          normalized.uiThemeId ?? knownMeta.uiThemeId
        );
        if (result.applied) {
          sessionMetaById.set(normalized.sessionId, {
            ...knownMeta,
            presetId,
            uiThemeId: normalized.uiThemeId ?? knownMeta.uiThemeId
          });
        }
        return result;
      }
    ],
    [
      LYRA_CHANNELS.terminalWriteSession,
      (_event, payload) =>
        invokeIgnoreMissingSession(bindings, (native) => {
          const normalized = normalizeWriteRequest(payload as TerminalWriteRequest);
          if (isAiSource(normalized.source)) {
            throw new Error("ai terminal execution is disabled in v1");
          }
          native.writeSession(normalized);
        })
    ],
    [
      LYRA_CHANNELS.terminalResizeSession,
      (_event, payload) =>
        invokeIgnoreMissingSession(bindings, (native) => {
          native.resizeSession(normalizeResizeRequest(payload as TerminalResizeRequest));
        })
    ],
    [
      LYRA_CHANNELS.terminalCloseSession,
      (_event, payload) =>
        invokeIgnoreMissingSession(bindings, (native) => {
          const request = payload as TerminalCloseRequest;
          sessionMetaById.delete(request.sessionId);
          native.closeSession(request);
        })
    ]
  ];
  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, async (event, payload) => handler(event, payload));
  }
  return {
    loadResult,
    dispose: () => {
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
      sessionMetaById.clear();
      try {
        bindings.shutdown();
      } catch (_error) {
        // ignore teardown errors
      }
    }
  };
};
