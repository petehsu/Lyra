import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
  LYRA_CHANNELS,
  type TerminalCloseRequest,
  type TerminalCreateRequest,
  type TerminalEvent,
  type TerminalReadRequest,
  type TerminalReadResponse,
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
import type { LyraRuntimeClient } from "../runtime-client";
import {
  buildStarshipPromptInjection,
  createStarshipRuntime,
  describeStarshipRuntime
} from "./starship";
import type {
  TerminalCapabilitySessionCloseRequest,
  TerminalCapabilitySessionReadRequest,
  TerminalCapabilitySessionStartRequest,
  TerminalCapabilitySessionWriteRequest,
  TerminalExecRequest,
  TerminalExecResult,
  TerminalIpcBridge
} from "./types";
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
  const envShell = process.env.SHELL?.trim();
  if (envShell !== undefined && envShell.length > 0) {
    return envShell;
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
    ...(normalizedShell !== undefined ? { shell: normalizedShell } : {}),
    ...(request.mode !== undefined ? { mode: request.mode } : {}),
    ...(request.command !== undefined ? { command: request.command } : {}),
    ...(typeof request.persist === "boolean" ? { persist: request.persist } : {})
  };
};
const normalizeRestoreRequest = (request: TerminalRestoreRequest): TerminalRestoreRequest => ({
  sessions: request.sessions.map((session) => normalizeCreateRequest(session))
});
const normalizeWriteRequest = (request: TerminalWriteRequest): TerminalWriteRequest => ({
  source: request.source ?? "user",
  sessionId: request.sessionId,
  ...(typeof request.data === "string" ? { data: request.data } : {}),
  ...(typeof request.text === "string" ? { text: request.text } : {}),
  ...(Array.isArray(request.keys) ? { keys: request.keys } : {}),
  ...(typeof request.appendNewline === "boolean" ? { appendNewline: request.appendNewline } : {})
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

const CAPABILITY_EXIT_PREFIX = "__LYRA_CAPABILITY_EXIT__";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripCommandMarker = (
  output: string,
  marker: string,
  fallbackExitCode: number
): { readonly output: string; readonly exitCode: number } => {
  const pattern = new RegExp(`${escapeRegExp(marker)}(\\d+)`);
  const match = output.match(pattern);
  const parsedExitCode = match === null ? fallbackExitCode : Number.parseInt(match[1] ?? "", 10);
  return {
    output: output.replace(pattern, "").trimEnd(),
    exitCode: Number.isFinite(parsedExitCode) ? parsedExitCode : fallbackExitCode
  };
};

export const createTerminalIpcBridge = (
  storageRoot: string,
  runtimeClient: LyraRuntimeClient,
  getWindow: () => BrowserWindow | null
): TerminalIpcBridge => {
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
  const requestRuntime = async <T>(method: string, payload: unknown): Promise<T> =>
    await runtimeClient.request<T>(method, payload);
  const publishEvent = (event: TerminalEvent): void => {
    const meta = parseEventMeta(event);
    if (meta?.kind === "exit") {
      sessionMetaById.delete(meta.sessionId);
    }
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.terminalEvent, event);
  };
  const unsubscribeRuntimeEvents = runtimeClient.subscribe((eventName, payload) => {
    if (eventName !== "terminal.runtime") {
      return;
    }
    const event = payload as TerminalEvent;
    publishEvent(event);
  });
  const applyPromptInjection = (
    sessionId: string,
    shell: string,
    presetId: TerminalThemePresetId,
    uiThemeId: string
  ): Promise<TerminalReloadPromptResult> => (async () => {
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
      await requestRuntime<void>("terminal.sessions.write", {
        sessionId,
        data: injection.command,
        source: "user"
      });
      return {
        applied: true,
        deferred: false
      };
    } catch (error) {
      if (error instanceof Error && /session not found/i.test(error.message)) {
        return createDeferredResult("session not found");
      }
      return createDeferredResult(
        error instanceof Error ? error.message : String(error)
      );
    }
  })();
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
  const createTrackedSession = async (request: TerminalCreateRequest): Promise<TerminalSessionSnapshot> => {
    const snapshot = await requestRuntime<TerminalSessionSnapshot>(
      "terminal.sessions.create",
      request
    );
    const meta = rememberSessionMeta(snapshot, request);
    if (request.source === "user") {
      const promptResult = await applyPromptInjection(
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
    }
    return snapshot;
  };
  const handlers: Array<
    readonly [string, (event: IpcMainInvokeEvent, payload: unknown) => unknown]
  > = [
    [
      LYRA_CHANNELS.terminalCreateSession,
      async (_event, payload) => {
        const normalized = normalizeCreateRequest(payload as TerminalCreateRequest);
        const snapshot = await createTrackedSession(normalized);
        console.info(
          `[lyra-terminal] session ready id=${snapshot.sessionId} shell=${snapshot.shell} cols=${snapshot.cols} rows=${snapshot.rows}`
        );
        return snapshot;
      }
    ],
    [
      LYRA_CHANNELS.terminalRestoreSessions,
      async (_event, payload) => {
        const normalized = normalizeRestoreRequest(payload as TerminalRestoreRequest);
        const snapshots = await requestRuntime<readonly TerminalSessionSnapshot[]>(
          "terminal.sessions.restore",
          normalized
        );
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
          const promptResult = await applyPromptInjection(
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
      async (_event, payload) => {
        const normalized = normalizeReloadPromptRequest(
          payload as TerminalReloadPromptRequest
        );
        const knownMeta = sessionMetaById.get(normalized.sessionId);
        if (knownMeta === undefined) {
          return createDeferredResult("session metadata unavailable");
        }
        const presetId = normalizeTerminalPreset(normalized.terminalThemePreset);
        const result = await applyPromptInjection(
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
        (async () => {
          const normalized = normalizeWriteRequest(payload as TerminalWriteRequest);
          try {
            await requestRuntime<void>("terminal.sessions.write", normalized);
          } catch (error) {
            if (error instanceof Error && /session not found/i.test(error.message)) {
              return;
            }
            throw error;
          }
        })()
    ],
    [
      LYRA_CHANNELS.terminalReadSession,
      (_event, payload) =>
        requestRuntime<TerminalReadResponse>(
          "terminal.sessions.read",
          payload as TerminalReadRequest
        )
    ],
    [
      LYRA_CHANNELS.terminalResizeSession,
      (_event, payload) =>
        (async () => {
          try {
            await requestRuntime<void>(
              "terminal.sessions.resize",
              normalizeResizeRequest(payload as TerminalResizeRequest)
            );
          } catch (error) {
            if (error instanceof Error && /session not found/i.test(error.message)) {
              return;
            }
            throw error;
          }
        })()
    ],
    [
      LYRA_CHANNELS.terminalCloseSession,
      (_event, payload) =>
        (async () => {
          const request = payload as TerminalCloseRequest;
          sessionMetaById.delete(request.sessionId);
          try {
            await requestRuntime<void>("terminal.sessions.close", request);
          } catch (error) {
            if (error instanceof Error && /session not found/i.test(error.message)) {
              return;
            }
            throw error;
          }
        })()
    ]
  ];
  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, async (event, payload) => handler(event, payload));
  }
  const executeCommand = async (
    request: TerminalExecRequest
  ): Promise<TerminalExecResult> => {
    const trimmedCommand = request.command.trim();
    if (trimmedCommand.length === 0) {
      throw new Error("command is required");
    }
    return await requestRuntime<TerminalExecResult>("terminal.exec", {
      command: trimmedCommand,
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      timeoutMs: request.timeoutMs
    });
  };
  const startCapabilitySession = (
    request: TerminalCapabilitySessionStartRequest
  ): Promise<TerminalSessionSnapshot> =>
    createTrackedSession(
      normalizeCreateRequest({
        title: request.title ?? "Capability Terminal Session",
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        cols: request.cols ?? 120,
        rows: request.rows ?? 40,
        ...(request.shell === undefined ? {} : { shell: request.shell }),
        ...(request.mode === undefined ? {} : { mode: request.mode }),
        ...(request.command === undefined ? {} : { command: request.command }),
        ...(typeof request.persist === "boolean" ? { persist: request.persist } : {}),
        source: "capability"
      })
    );
  const readCapabilitySession = (
    request: TerminalCapabilitySessionReadRequest
  ): Promise<TerminalReadResponse> =>
    requestRuntime<TerminalReadResponse>("terminal.sessions.read", request);
  const writeCapabilitySession = (
    request: TerminalCapabilitySessionWriteRequest
  ): Promise<void> =>
    (async () => {
      await requestRuntime<void>("terminal.sessions.write", {
        sessionId: request.sessionId,
        ...(typeof request.data === "string" ? { data: request.data } : {}),
        ...(typeof request.text === "string" ? { text: request.text } : {}),
        ...(Array.isArray(request.keys) ? { keys: request.keys } : {}),
        ...(typeof request.appendNewline === "boolean"
          ? { appendNewline: request.appendNewline }
          : {}),
        source: "capability"
      });
    })();
  const closeCapabilitySession = (
    request: TerminalCapabilitySessionCloseRequest
  ): Promise<void> =>
    (async () => {
      sessionMetaById.delete(request.sessionId);
      await requestRuntime<void>("terminal.sessions.close", request);
    })();
  return {
    loadResult: {
      loadedFrom: "lyrad"
    },
    executeCommand,
    startCapabilitySession,
    readCapabilitySession,
    writeCapabilitySession,
    closeCapabilitySession,
    dispose: () => {
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
      unsubscribeRuntimeEvents();
      sessionMetaById.clear();
    }
  };
};
