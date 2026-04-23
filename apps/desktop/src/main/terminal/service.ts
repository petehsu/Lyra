import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
  normalizeTerminalThemeMode,
  type TerminalThemeMode
} from "../../shared/terminal-theme";
import type { LyraRuntimeClient } from "../runtime-client";
import {
  createPromptReloadCommand,
  resolvePromptShellFamily,
  type PromptShellFamily
} from "./fallback-prompt";
import {
  createPromptStreamState,
  filterPromptRuntimeData,
  notePromptUserInput,
  queuePromptEchoSuppression,
  type PromptStreamState
} from "./prompt-stream";
import type {
  TerminalCapabilitySessionCloseRequest,
  TerminalCapabilitySessionReadRequest,
  TerminalCapabilitySessionStartRequest,
  TerminalCapabilitySessionWriteRequest,
  TerminalExecRequest,
  TerminalExecResult,
  TerminalIpcBridge
} from "./types";

const sanitizeSize = (value: number, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < 1) return 1;
  if (rounded > 300) return 300;
  return rounded;
};

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
  const normalizedTerminalThemePreset = normalizeTerminalThemeMode(
    request.terminalThemePreset
  );
  const normalizedUiThemeId =
    typeof request.uiThemeId === "string" && request.uiThemeId.trim().length > 0
      ? request.uiThemeId.trim()
      : "one-dark";
  return {
    cols: sanitizeSize(request.cols, 80),
    rows: sanitizeSize(request.rows, 24),
    source: request.source ?? "user",
    terminalThemePreset: normalizedTerminalThemePreset,
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
  terminalThemePreset: normalizeTerminalThemeMode(request.terminalThemePreset),
  uiThemeId:
    typeof request.uiThemeId === "string" && request.uiThemeId.trim().length > 0
      ? request.uiThemeId.trim()
      : "one-dark",
  source: request.source ?? "user"
});

const createDeferredResult = (reason: string): TerminalReloadPromptResult => ({
  applied: false,
  deferred: true,
  reason
});

const createAppliedResult = (): TerminalReloadPromptResult => ({
  applied: true,
  deferred: false
});

const CAPABILITY_EXIT_PREFIX = "__LYRA_CAPABILITY_EXIT__";
const TERMINAL_PROMPT_SCRIPT_DIR = "prompt-scripts";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const quotePosixShellLiteral = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

const createPromptSourceCommand = (scriptPath: string): string =>
  `. ${quotePosixShellLiteral(scriptPath)} 2>/dev/null || true`;

const createPromptScriptHash = (shellFamily: PromptShellFamily, script: string): string =>
  createHash("sha256")
    .update(shellFamily)
    .update("\u0000")
    .update(script)
    .digest("hex")
    .slice(0, 24);

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
  const requestRuntime = async <T>(method: string, payload: unknown): Promise<T> =>
    await runtimeClient.request<T>(method, payload);

  const sessionShellById = new Map<string, string>();
  const sessionPromptModeById = new Map<string, TerminalThemeMode>();
  const sessionPromptStreamById = new Map<string, PromptStreamState>();
  const sessionPendingReloadById = new Map<
    string,
    {
      readonly terminalThemePreset: TerminalThemeMode;
      readonly uiThemeId: string;
      readonly source: "user" | "ai" | "capability";
    }
  >();
  const promptScriptRoot = join(storageRoot, TERMINAL_PROMPT_SCRIPT_DIR);

  const ensurePromptStreamState = (sessionId: string): PromptStreamState => {
    const existing = sessionPromptStreamById.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const created = createPromptStreamState();
    sessionPromptStreamById.set(sessionId, created);
    return created;
  };

  const ensurePromptScriptFile = async (
    shellFamily: PromptShellFamily,
    script: string
  ): Promise<string> => {
    const hash = createPromptScriptHash(shellFamily, script);
    const scriptPath = join(promptScriptRoot, `${shellFamily}-${hash}.sh`);
    await mkdir(promptScriptRoot, { recursive: true });
    try {
      await access(scriptPath);
      return scriptPath;
    } catch {
      await writeFile(scriptPath, `${script}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
      return scriptPath;
    }
  };

  const applyPromptToSession = async (input: {
    readonly sessionId: string;
    readonly shell: string;
    readonly terminalThemePreset: TerminalThemeMode;
    readonly uiThemeId: string;
    readonly source: "user" | "ai" | "capability";
    readonly resetInteractiveState?: boolean;
  }): Promise<TerminalReloadPromptResult> => {
    const shellFamily = resolvePromptShellFamily(input.shell);
    if (shellFamily === null) {
      return createDeferredResult(`shell does not support prompt reload: ${input.shell}`);
    }

    const command = createPromptReloadCommand(
      shellFamily,
      input.uiThemeId,
      input.terminalThemePreset
    );
    if (command === null) {
      return createDeferredResult(`shell does not support prompt reload: ${input.shell}`);
    }

    try {
      const scriptPath = await ensurePromptScriptFile(shellFamily, command);
      const sourceCommand = createPromptSourceCommand(scriptPath);
      queuePromptEchoSuppression(ensurePromptStreamState(input.sessionId), sourceCommand);
      await requestRuntime<void>("terminal.sessions.write", {
        sessionId: input.sessionId,
        data: `${input.resetInteractiveState === true ? "\u0003\r" : ""}${sourceCommand}\n`,
        source: input.source
      });
      sessionPromptModeById.set(input.sessionId, input.terminalThemePreset);
      return createAppliedResult();
    } catch (error) {
      if (error instanceof Error && /session not found/i.test(error.message)) {
        return createDeferredResult("session not found");
      }
      throw error;
    }
  };

  const publishEvent = (event: TerminalEvent): void => {
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
    if (event.kind === "data") {
      const streamState = ensurePromptStreamState(event.sessionId);
      const filteredData = filterPromptRuntimeData(streamState, event.data);
      if (streamState.atPrompt) {
        const pendingReload = sessionPendingReloadById.get(event.sessionId);
        if (pendingReload !== undefined) {
          sessionPendingReloadById.delete(event.sessionId);
          const shell = sessionShellById.get(event.sessionId);
          if (shell !== undefined) {
            void applyPromptToSession({
              sessionId: event.sessionId,
              shell,
              terminalThemePreset: pendingReload.terminalThemePreset,
              uiThemeId: pendingReload.uiThemeId,
              source: pendingReload.source
            }).catch((error) => {
              console.warn(
                `[lyra-terminal] deferred prompt apply failed for session ${event.sessionId}:`,
                error
              );
            });
          }
        }
      }
      if (filteredData.length === 0) {
        return;
      }
      publishEvent({
        ...event,
        data: filteredData
      });
      return;
    }
    publishEvent(event);
  });

  const handlers: Array<
    readonly [string, (event: IpcMainInvokeEvent, payload: unknown) => unknown]
  > = [
    [
      LYRA_CHANNELS.terminalCreateSession,
      async (_event, payload) => {
        const normalized = normalizeCreateRequest(payload as TerminalCreateRequest);
        const snapshot = await requestRuntime<TerminalSessionSnapshot>(
          "terminal.sessions.create",
          normalized
        );
        sessionShellById.set(snapshot.sessionId, snapshot.shell);
        sessionPromptModeById.set(snapshot.sessionId, "follow-app");
        sessionPromptStreamById.set(snapshot.sessionId, createPromptStreamState());
        if (snapshot.mode !== "command") {
          try {
            await applyPromptToSession({
              sessionId: snapshot.sessionId,
              shell: snapshot.shell,
              terminalThemePreset: normalizeTerminalThemeMode(normalized.terminalThemePreset),
              uiThemeId: normalized.uiThemeId ?? "one-dark",
              source: normalized.source
            });
          } catch (error) {
            console.warn(
              `[lyra-terminal] prompt apply failed for session ${snapshot.sessionId}:`,
              error
            );
          }
        }
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
        await Promise.all(
          snapshots.map(async (snapshot, index) => {
            sessionShellById.set(snapshot.sessionId, snapshot.shell);
            sessionPromptModeById.set(snapshot.sessionId, "follow-app");
            sessionPromptStreamById.set(snapshot.sessionId, createPromptStreamState());
            if (snapshot.mode === "command") {
              return;
            }
            const requestedSession = normalized.sessions[index];
            try {
              await applyPromptToSession({
                sessionId: snapshot.sessionId,
                shell: snapshot.shell,
                terminalThemePreset: normalizeTerminalThemeMode(
                  requestedSession?.terminalThemePreset
                ),
                uiThemeId: requestedSession?.uiThemeId ?? "one-dark",
                source: requestedSession?.source ?? "user"
              });
            } catch (error) {
              console.warn(
                `[lyra-terminal] prompt restore apply failed for session ${snapshot.sessionId}:`,
                error
              );
            }
          })
        );
        return snapshots;
      }
    ],
    [
      LYRA_CHANNELS.terminalReloadPrompt,
      async (_event, payload) => {
        const normalized = normalizeReloadPromptRequest(payload as TerminalReloadPromptRequest);
        const shell = sessionShellById.get(normalized.sessionId);
        if (shell === undefined) {
          return createDeferredResult("session shell metadata unavailable");
        }
        const streamState = ensurePromptStreamState(normalized.sessionId);
        if (!streamState.atPrompt) {
          sessionPendingReloadById.set(normalized.sessionId, {
            terminalThemePreset: normalizeTerminalThemeMode(normalized.terminalThemePreset),
            uiThemeId: normalized.uiThemeId ?? "one-dark",
            source: normalized.source
          });
          return createDeferredResult("session is busy; prompt reload deferred until next prompt");
        }
        return await applyPromptToSession({
          sessionId: normalized.sessionId,
          shell,
          terminalThemePreset: normalizeTerminalThemeMode(normalized.terminalThemePreset),
          uiThemeId: normalized.uiThemeId ?? "one-dark",
          source: normalized.source
        });
      }
    ],
    [
      LYRA_CHANNELS.terminalWriteSession,
      (_event, payload) =>
        (async () => {
          const normalized = normalizeWriteRequest(payload as TerminalWriteRequest);
          notePromptUserInput(ensurePromptStreamState(normalized.sessionId));
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
          try {
            await requestRuntime<void>("terminal.sessions.close", request);
          } catch (error) {
            if (error instanceof Error && /session not found/i.test(error.message)) {
              sessionShellById.delete(request.sessionId);
              sessionPromptModeById.delete(request.sessionId);
              sessionPromptStreamById.delete(request.sessionId);
              sessionPendingReloadById.delete(request.sessionId);
              return;
            }
            throw error;
          }
          sessionShellById.delete(request.sessionId);
          sessionPromptModeById.delete(request.sessionId);
          sessionPromptStreamById.delete(request.sessionId);
          sessionPendingReloadById.delete(request.sessionId);
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
    (async () => {
      const snapshot = await requestRuntime<TerminalSessionSnapshot>(
        "terminal.sessions.create",
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
      sessionShellById.set(snapshot.sessionId, snapshot.shell);
      sessionPromptModeById.set(snapshot.sessionId, "follow-app");
      sessionPromptStreamById.set(snapshot.sessionId, createPromptStreamState());
      return snapshot;
    })();

  const readCapabilitySession = (
    request: TerminalCapabilitySessionReadRequest
  ): Promise<TerminalReadResponse> =>
    requestRuntime<TerminalReadResponse>("terminal.sessions.read", request);

  const writeCapabilitySession = (
    request: TerminalCapabilitySessionWriteRequest
  ): Promise<void> =>
    (async () => {
      notePromptUserInput(ensurePromptStreamState(request.sessionId));
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
      try {
        await requestRuntime<void>("terminal.sessions.close", request);
      } finally {
        sessionShellById.delete(request.sessionId);
        sessionPromptModeById.delete(request.sessionId);
        sessionPromptStreamById.delete(request.sessionId);
        sessionPendingReloadById.delete(request.sessionId);
      }
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
    }
  };
};
