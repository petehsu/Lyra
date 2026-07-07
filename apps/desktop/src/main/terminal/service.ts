import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ipcMain,
  MessageChannelMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type MessagePortMain
} from "electron";
import {
  LYRA_CHANNELS,
  type TerminalCloseRequest,
  type TerminalCreateRequest,
  type TerminalDataAckRequest,
  type TerminalDataEvent,
  type TerminalEvent,
  type TerminalReadRequest,
  type TerminalReadResponse,
  type TerminalReloadPromptRequest,
  type TerminalReloadPromptResult,
  type TerminalRendererAttachRequest,
  type TerminalRendererAttachResponse,
  type TerminalRendererDetachRequest,
  type TerminalResizeRequest,
  type TerminalSessionSnapshot,
  type TerminalWriteRequest,
  type TerminalCommandSource,
  type TerminalPermissionEvaluateRequest,
  type TerminalPermissionEvaluateResponse,
  type TerminalPermissionRespondRequest,
  type TerminalPermissionRespondResponse,
  type TerminalProcessesReadRequest,
  type TerminalProcessesReadResponse,
  type TerminalProcessSignalRequest,
  type TerminalProcessSignalResponse
} from "../../shared/desktop-bridge";
import {
  normalizeTerminalThemeMode,
  type TerminalThemeMode
} from "../../shared/terminal-theme";
import type { LyraRuntimeClient } from "../runtime-client";
import { resolveNativeResourceCandidates } from "../native-resource-paths";
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
      : "lyra-dark";
  return {
    cols: sanitizeSize(request.cols, 80),
    rows: sanitizeSize(request.rows, 24),
    source: request.source ?? "user",
    terminalThemePreset: normalizedTerminalThemePreset,
    uiThemeId: normalizedUiThemeId,
    ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
    ...(request.title !== undefined ? { title: request.title } : {}),
    ...(request.cwd !== undefined ? { cwd: request.cwd } : {}),
    ...(request.sourceAgentSessionId !== undefined
      ? { sourceAgentSessionId: request.sourceAgentSessionId }
      : {}),
    ...(normalizedShell !== undefined ? { shell: normalizedShell } : {}),
    ...(Array.isArray(request.env) ? { env: request.env } : {}),
    ...(request.mode !== undefined ? { mode: request.mode } : {}),
    ...(request.command !== undefined ? { command: request.command } : {}),
    ...(typeof request.persist === "boolean" ? { persist: request.persist } : {}),
    ...(request.actor !== undefined ? { actor: request.actor } : {}),
    ...(request.correlation !== undefined ? { correlation: request.correlation } : {})
  };
};

const normalizeWriteRequest = (request: TerminalWriteRequest): TerminalWriteRequest => ({
  source: request.source ?? "user",
  sessionId: request.sessionId,
  ...(typeof request.data === "string" ? { data: request.data } : {}),
  ...(typeof request.text === "string" ? { text: request.text } : {}),
  ...(Array.isArray(request.keys) ? { keys: request.keys } : {}),
  ...(typeof request.appendNewline === "boolean" ? { appendNewline: request.appendNewline } : {}),
  ...(request.actor !== undefined ? { actor: request.actor } : {}),
  ...(request.correlation !== undefined ? { correlation: request.correlation } : {})
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
      : "lyra-dark",
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

const TERMINAL_PROMPT_SCRIPT_DIR = "prompt-scripts";
const TERMINAL_RENDERER_HIGH_WATERMARK_BYTES = 512 * 1024;
const TERMINAL_RENDERER_LOW_WATERMARK_BYTES = 128 * 1024;
const TERMINAL_RENDERER_BATCH_FLUSH_MS = 8;
const TERMINAL_RENDERER_MAX_BATCH_BYTES = 128 * 1024;
const TERMINAL_RENDERER_INTERACTIVE_DIRECT_BYTES = 4 * 1024;
const TERMINAL_INPUT_BATCH_FLUSH_MS = 8;
const TERMINAL_INPUT_MAX_BATCH_BYTES = 16 * 1024;
const LYRA_AGENT_CLI_COMMAND = "__lyra_agent_cli__";

type TerminalDataFlowState = {
  rendererCount: number;
  nextSeq: number;
  unackedBytes: number;
  queue: TerminalDataEvent[];
  flushTimer: ReturnType<typeof setTimeout> | null;
};

type TerminalInputFlowState = {
  data: string;
  source: TerminalCommandSource;
  flushTimer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
};

type TerminalDataPortInputMessage = {
  readonly kind: "input";
  readonly request: TerminalWriteRequest;
};

const quotePosixShellLiteral = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

const quoteShellArg = (value: string): string => quotePosixShellLiteral(value);

const resolveLyraCliBinaryName = (): string =>
  process.platform === "win32" ? "lyra.exe" : "lyra";

const resolveLyraCliBinaryPath = (): string => {
  const candidates = resolveNativeResourceCandidates({
    cwd: process.cwd(),
    moduleDir: __dirname,
    envVar: "LYRA_CLI_BIN",
    fileNames: [resolveLyraCliBinaryName()]
  });
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "lyra";
};

const terminalEnvPairsToMap = (
  env: readonly { readonly key: string; readonly value: string }[] | undefined
): Map<string, string> => {
  const values = new Map<string, string>();
  for (const pair of env ?? []) {
    const key = pair.key.trim();
    if (key.length > 0) {
      values.set(key, pair.value);
    }
  }
  return values;
};

const envMapToPairs = (
  env: Map<string, string>
): readonly { readonly key: string; readonly value: string }[] =>
  [...env.entries()].map(([key, value]) => ({ key, value }));

const createLyraAgentCliLaunch = (
  storageRoot: string,
  request: TerminalCreateRequest
): {
  readonly command: string;
  readonly env: readonly { readonly key: string; readonly value: string }[];
} => {
  const modulesRoot = dirname(storageRoot);
  const runtimeRoot = join(modulesRoot, "runtime");
  const agentRoot = join(modulesRoot, "agent");
  const runtimeSocket = process.platform === "win32"
    ? `\\\\.\\pipe\\lyra-runtime-${runtimeRoot.replace(/[^a-zA-Z0-9]/g, "_")}`
    : join(runtimeRoot, "runtime", "lyrad.sock");
  const env = terminalEnvPairsToMap(request.env);
  if (request.sessionId !== undefined && request.sessionId.trim().length > 0) {
    env.set("LYRA_TERMINAL_SESSION_ID", request.sessionId.trim());
  }
  env.set("LYRA_RUNTIME_SOCKET", runtimeSocket);
  env.set("LYRA_AGENT_HOME", agentRoot);
  env.set("LYRA_AGENT_RUNTIME_DIR", join(agentRoot, "runtime"));
  env.set("JCODE_HOME", agentRoot);
  env.set("JCODE_RUNTIME_DIR", join(agentRoot, "runtime"));

  const args = ["agent", "chat", "--desktop"];
  const agentSessionId = env.get("LYRA_AGENT_SESSION_ID");
  const terminalSessionId = env.get("LYRA_TERMINAL_SESSION_ID");
  const terminalPaneId = env.get("LYRA_TERMINAL_PANE_ID");
  const terminalTabId = env.get("LYRA_TERMINAL_TAB_ID");
  if (agentSessionId !== undefined && agentSessionId.trim().length > 0) {
    args.push("--session-id", agentSessionId.trim());
  }
  if (request.cwd !== undefined && request.cwd.trim().length > 0) {
    args.push("--working-dir", request.cwd.trim());
  }
  if (terminalSessionId !== undefined && terminalSessionId.trim().length > 0) {
    args.push("--terminal-session-id", terminalSessionId.trim());
  }
  if (terminalPaneId !== undefined && terminalPaneId.trim().length > 0) {
    args.push("--terminal-pane-id", terminalPaneId.trim());
  }
  if (terminalTabId !== undefined && terminalTabId.trim().length > 0) {
    args.push("--terminal-tab-id", terminalTabId.trim());
  }

  return {
    command: [
      quoteShellArg(resolveLyraCliBinaryPath()),
      ...args.map(quoteShellArg)
    ].join(" "),
    env: envMapToPairs(env)
  };
};

const resolveLyraAgentCliRequest = (
  storageRoot: string,
  request: TerminalCreateRequest
): TerminalCreateRequest => {
  if (request.command?.trim() !== LYRA_AGENT_CLI_COMMAND) {
    return request;
  }
  const launch = createLyraAgentCliLaunch(storageRoot, request);
  return {
    ...request,
    mode: "command",
    command: launch.command,
    env: launch.env
  };
};

const createPromptSourceCommand = (scriptPath: string): string =>
  `. ${quotePosixShellLiteral(scriptPath)} 2>/dev/null || true`;

const createPromptScriptHash = (shellFamily: PromptShellFamily, script: string): string =>
  createHash("sha256")
    .update(shellFamily)
    .update("\u0000")
    .update(script)
    .digest("hex")
    .slice(0, 24);

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
      readonly source: TerminalCommandSource;
    }
  >();
  const terminalDataFlowBySession = new Map<string, TerminalDataFlowState>();
  const terminalInputFlowBySession = new Map<string, TerminalInputFlowState>();
  const promptScriptRoot = join(storageRoot, TERMINAL_PROMPT_SCRIPT_DIR);
  let terminalDataPort: MessagePortMain | null = null;
  const withStorageRoot = <T extends object>(payload: T): T & {
    readonly storageRoot: string;
  } => ({
    ...payload,
    storageRoot
  });

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
    readonly source: TerminalCommandSource;
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
        source: input.source,
        actor: { kind: "terminal_kernel" },
        correlation: { terminalToolName: "terminal.reloadPrompt" },
        storageRoot
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

  const closeTerminalDataPort = (): void => {
    if (terminalDataPort === null) {
      return;
    }
    try {
      terminalDataPort.close();
    } catch (_error) {
      // A renderer reload can close the port first.
    }
    terminalDataPort = null;
  };

  const isTerminalDataPortInputMessage = (
    value: unknown
  ): value is TerminalDataPortInputMessage => {
    if (value === null || typeof value !== "object") {
      return false;
    }
    const record = value as Record<string, unknown>;
    return record.kind === "input" && record.request !== null && typeof record.request === "object";
  };

  const flushQueuedTerminalInput = (sessionId: string): void => {
    const state = terminalInputFlowBySession.get(sessionId);
    if (state === undefined) {
      return;
    }
    if (state.flushTimer !== null) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    if (state.inFlight) {
      return;
    }
    const data = state.data;
    const source = state.source;
    state.data = "";
    if (data.length === 0) {
      terminalInputFlowBySession.delete(sessionId);
      return;
    }
    state.inFlight = true;
    void writeSession({
      sessionId,
      data,
      source
    })
      .catch((_error) => {
        // Input may race with terminal close; the renderer will recover through normal session state.
      })
      .finally(() => {
        const current = terminalInputFlowBySession.get(sessionId);
        if (current === undefined) {
          return;
        }
        current.inFlight = false;
        if (current.data.length === 0) {
          terminalInputFlowBySession.delete(sessionId);
          return;
        }
        flushQueuedTerminalInput(sessionId);
      });
  };

  const shouldFlushTerminalInputImmediately = (data: string): boolean =>
    data.length >= TERMINAL_INPUT_MAX_BATCH_BYTES ||
    data.includes("\r") ||
    data.includes("\n") ||
    data.includes("\u0003") ||
    data.startsWith("\u001b");

  const queueTerminalInput = (request: TerminalWriteRequest): void => {
    const normalized = normalizeWriteRequest(request);
    if (
      typeof normalized.data !== "string" ||
      normalized.text !== undefined ||
      normalized.keys !== undefined ||
      normalized.appendNewline === true ||
      normalized.actor !== undefined ||
      normalized.correlation !== undefined
    ) {
      void writeSession(normalized).catch((_error) => undefined);
      return;
    }
    const existing = terminalInputFlowBySession.get(normalized.sessionId);
    const state = existing ?? {
      data: "",
      source: normalized.source,
      flushTimer: null,
      inFlight: false
    };
    state.data += normalized.data;
    state.source = normalized.source;
    terminalInputFlowBySession.set(normalized.sessionId, state);
    if (shouldFlushTerminalInputImmediately(state.data)) {
      flushQueuedTerminalInput(normalized.sessionId);
      return;
    }
    if (state.flushTimer === null && !state.inFlight) {
      state.flushTimer = setTimeout(() => {
        flushQueuedTerminalInput(normalized.sessionId);
      }, TERMINAL_INPUT_BATCH_FLUSH_MS);
    }
  };

  const handleTerminalDataPortMessage = (payload: unknown): void => {
    if (!isTerminalDataPortInputMessage(payload)) {
      return;
    }
    queueTerminalInput(payload.request);
  };

  const connectTerminalDataPort = (): void => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }
    closeTerminalDataPort();
    const channel = new MessageChannelMain();
    terminalDataPort = channel.port1;
    terminalDataPort.on("close", () => {
      if (terminalDataPort === channel.port1) {
        terminalDataPort = null;
      }
    });
    terminalDataPort.on("message", (event) => {
      handleTerminalDataPortMessage((event as { data?: unknown }).data);
    });
    terminalDataPort.start();
    window.webContents.postMessage(
      LYRA_CHANNELS.terminalDataPort,
      { version: 1 },
      [channel.port2]
    );
  };

  const publishTerminalDataEvent = (event: TerminalDataEvent): void => {
    if (terminalDataPort === null) {
      publishEvent(event);
      return;
    }
    try {
      terminalDataPort.postMessage(event);
    } catch (_error) {
      terminalDataPort = null;
      publishEvent(event);
    }
  };

  const getDataFlowState = (sessionId: string): TerminalDataFlowState => {
    const existing = terminalDataFlowBySession.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const created: TerminalDataFlowState = {
      rendererCount: 0,
      nextSeq: 1,
      unackedBytes: 0,
      queue: [],
      flushTimer: null
    };
    terminalDataFlowBySession.set(sessionId, created);
    return created;
  };

  const clearDataFlushTimer = (state: TerminalDataFlowState): void => {
    if (state.flushTimer === null) {
      return;
    }
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  };

  const scheduleTerminalDataFlush = (sessionId: string): void => {
    const state = terminalDataFlowBySession.get(sessionId);
    if (state === undefined || state.flushTimer !== null) {
      return;
    }
    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      flushQueuedTerminalData(sessionId);
    }, TERMINAL_RENDERER_BATCH_FLUSH_MS);
  };

  const publishTerminalDataBatch = (
    sessionId: string,
    events: readonly TerminalDataEvent[]
  ): void => {
    if (events.length === 0) {
      return;
    }
    const first = events[0];
    if (first === undefined) {
      return;
    }
    if (events.length === 1) {
      publishTerminalDataEvent(first);
      return;
    }
    publishTerminalDataEvent({
      ...first,
      sessionId,
      data: events.map((event) => event.data).join(""),
      byteLength: events.reduce(
        (total, event) => total + (event.byteLength ?? Buffer.byteLength(event.data, "utf8")),
        0
      )
    });
  };

  const flushQueuedTerminalData = (sessionId: string): void => {
    const state = terminalDataFlowBySession.get(sessionId);
    if (state === undefined) {
      return;
    }
    if (state.rendererCount <= 0) {
      state.queue.length = 0;
      state.unackedBytes = 0;
      return;
    }
    if (state.unackedBytes >= TERMINAL_RENDERER_HIGH_WATERMARK_BYTES) {
      return;
    }
    while (
      state.queue.length > 0 &&
      state.unackedBytes < TERMINAL_RENDERER_HIGH_WATERMARK_BYTES
    ) {
      const batch: TerminalDataEvent[] = [];
      let batchBytes = 0;
      while (state.queue.length > 0 && batchBytes < TERMINAL_RENDERER_MAX_BATCH_BYTES) {
        const next = state.queue.shift();
        if (next === undefined) {
          break;
        }
        const nextBytes = next.byteLength ?? Buffer.byteLength(next.data, "utf8");
        if (
          batch.length > 0 &&
          batchBytes + nextBytes > TERMINAL_RENDERER_MAX_BATCH_BYTES
        ) {
          state.queue.unshift(next);
          break;
        }
        batch.push(next);
        batchBytes += nextBytes;
      }
      if (batch.length === 0) {
        break;
      }
      state.unackedBytes += batchBytes;
      publishTerminalDataBatch(sessionId, batch);
    }
    if (state.unackedBytes >= TERMINAL_RENDERER_HIGH_WATERMARK_BYTES) {
      return;
    }
    if (state.queue.length > 0 && state.unackedBytes < TERMINAL_RENDERER_HIGH_WATERMARK_BYTES) {
      scheduleTerminalDataFlush(sessionId);
    }
  };

  const publishTerminalData = (event: TerminalDataEvent): void => {
    const state = getDataFlowState(event.sessionId);
    const byteLength = Buffer.byteLength(event.data, "utf8");
    const eventWithFlow: TerminalDataEvent = {
      ...event,
      dataSeq: state.nextSeq,
      byteLength
    };
    state.nextSeq += 1;
    if (state.rendererCount <= 0) {
      publishTerminalDataEvent(eventWithFlow);
      return;
    }
    if (
      state.queue.length === 0 &&
      byteLength <= TERMINAL_RENDERER_INTERACTIVE_DIRECT_BYTES &&
      state.unackedBytes < TERMINAL_RENDERER_LOW_WATERMARK_BYTES
    ) {
      state.unackedBytes += byteLength;
      publishTerminalDataEvent(eventWithFlow);
      return;
    }
    state.queue.push(eventWithFlow);
    scheduleTerminalDataFlush(event.sessionId);
  };

  const attachRenderer = async (
    request: TerminalRendererAttachRequest
  ): Promise<TerminalRendererAttachResponse> => {
    const state = getDataFlowState(request.sessionId);
    state.rendererCount += 1;
    flushQueuedTerminalData(request.sessionId);
    return {
      sessionId: request.sessionId,
      attached: true
    };
  };

  const detachRenderer = async (request: TerminalRendererDetachRequest): Promise<void> => {
    const state = getDataFlowState(request.sessionId);
    state.rendererCount = Math.max(0, state.rendererCount - 1);
    if (state.rendererCount === 0) {
      state.unackedBytes = 0;
      state.queue.length = 0;
      clearDataFlushTimer(state);
    }
  };

  const ackData = async (request: TerminalDataAckRequest): Promise<void> => {
    const state = getDataFlowState(request.sessionId);
    state.unackedBytes = Math.max(0, state.unackedBytes - Math.max(0, request.byteLength));
    flushQueuedTerminalData(request.sessionId);
  };

  const unsubscribeRuntimeEvents = runtimeClient.subscribe((eventName, payload) => {
    if (eventName !== "terminal.runtime") {
      return;
    }
    const event = payload as TerminalEvent;
    if (event.kind === "data") {
      const streamState = ensurePromptStreamState(event.sessionId);
      const filteredData = filterPromptRuntimeData(streamState, event.data);
      if (filteredData.length === 0) {
        return;
      }
      publishTerminalData({
        ...event,
        data: filteredData
      });
      return;
    }
    publishEvent(event);
  });

  const createSession = async (
    request: TerminalCreateRequest
  ): Promise<TerminalSessionSnapshot> => {
    const normalized = resolveLyraAgentCliRequest(storageRoot, normalizeCreateRequest(request));
    const snapshot = await requestRuntime<TerminalSessionSnapshot>(
      "terminal.sessions.create",
      withStorageRoot(normalized)
    );
    sessionShellById.set(snapshot.sessionId, snapshot.shell);
    sessionPromptModeById.set(snapshot.sessionId, "follow-app");
    sessionPromptStreamById.set(snapshot.sessionId, createPromptStreamState());
    return snapshot;
  };

  const writeSession = async (request: TerminalWriteRequest): Promise<void> => {
    const normalized = normalizeWriteRequest(request);
    notePromptUserInput(ensurePromptStreamState(normalized.sessionId));
    await requestRuntime<void>("terminal.sessions.write", withStorageRoot(normalized));
  };

  const closeSession = async (request: TerminalCloseRequest): Promise<void> => {
    try {
      await requestRuntime<void>("terminal.sessions.close", withStorageRoot(request));
    } finally {
      sessionShellById.delete(request.sessionId);
      sessionPromptModeById.delete(request.sessionId);
      sessionPromptStreamById.delete(request.sessionId);
      sessionPendingReloadById.delete(request.sessionId);
      const flowState = terminalDataFlowBySession.get(request.sessionId);
      if (flowState !== undefined) {
        clearDataFlushTimer(flowState);
        terminalDataFlowBySession.delete(request.sessionId);
      }
      const inputFlowState = terminalInputFlowBySession.get(request.sessionId);
      if (inputFlowState !== undefined) {
        if (inputFlowState.flushTimer !== null) {
          clearTimeout(inputFlowState.flushTimer);
        }
        terminalInputFlowBySession.delete(request.sessionId);
      }
    }
  };

  const reloadPrompt = async (
    request: TerminalReloadPromptRequest
  ): Promise<TerminalReloadPromptResult> => {
    const normalized = normalizeReloadPromptRequest(request);
    const shell = sessionShellById.get(normalized.sessionId);
    if (shell === undefined) {
      return createDeferredResult("session shell metadata unavailable");
    }
    const streamState = ensurePromptStreamState(normalized.sessionId);
    if (!streamState.atPrompt) {
      sessionPendingReloadById.set(normalized.sessionId, {
        terminalThemePreset: normalizeTerminalThemeMode(normalized.terminalThemePreset),
        uiThemeId: normalized.uiThemeId ?? "lyra-dark",
        source: "system"
      });
      return createDeferredResult("session is busy; prompt reload deferred until next prompt");
    }
    return await applyPromptToSession({
      sessionId: normalized.sessionId,
      shell,
      terminalThemePreset: normalizeTerminalThemeMode(normalized.terminalThemePreset),
      uiThemeId: normalized.uiThemeId ?? "lyra-dark",
      source: "system"
    });
  };

  const readSessionObservation = async (
    request: TerminalReadRequest
  ): Promise<TerminalReadResponse> => {
    return await requestRuntime<TerminalReadResponse>(
      "terminal.sessions.read",
      withStorageRoot(request)
    );
  };

  const readProcesses = async (
    request: TerminalProcessesReadRequest
  ): Promise<TerminalProcessesReadResponse> => {
    return await requestRuntime<TerminalProcessesReadResponse>(
      "terminal.processes.read",
      withStorageRoot(request)
    );
  };

  const signalProcess = async (
    request: TerminalProcessSignalRequest
  ): Promise<TerminalProcessSignalResponse> => {
    return await requestRuntime<TerminalProcessSignalResponse>(
      "terminal.processes.signal",
      withStorageRoot(request)
    );
  };

  const handlers: Array<
    readonly [string, (event: IpcMainInvokeEvent, payload: unknown) => unknown]
  > = [
    [
      LYRA_CHANNELS.terminalConnectDataPort,
      () => connectTerminalDataPort()
    ],
    [
      LYRA_CHANNELS.terminalCreateSession,
      async (_event, payload) => {
        const normalized = normalizeCreateRequest(payload as TerminalCreateRequest);
        const snapshot = await createSession(normalized);
        console.info(
          `[lyra-terminal] session ready id=${snapshot.sessionId} shell=${snapshot.shell} cols=${snapshot.cols} rows=${snapshot.rows}`
        );
        return snapshot;
      }
    ],
    [
      LYRA_CHANNELS.terminalAttachRenderer,
      (_event, payload) => attachRenderer(payload as TerminalRendererAttachRequest)
    ],
    [
      LYRA_CHANNELS.terminalDetachRenderer,
      (_event, payload) => detachRenderer(payload as TerminalRendererDetachRequest)
    ],
    [
      LYRA_CHANNELS.terminalAckData,
      (_event, payload) => ackData(payload as TerminalDataAckRequest)
    ],
    [
      LYRA_CHANNELS.terminalReloadPrompt,
      (_event, payload) => reloadPrompt(payload as TerminalReloadPromptRequest)
    ],
    [
      LYRA_CHANNELS.terminalWriteSession,
      (_event, payload) =>
        (async () => {
          try {
            await writeSession(payload as TerminalWriteRequest);
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
      (_event, payload) => readSessionObservation(payload as TerminalReadRequest)
    ],
    [
      LYRA_CHANNELS.terminalPermissionsEvaluate,
      (_event, payload) =>
        requestRuntime<TerminalPermissionEvaluateResponse>(
          "terminal.permissions.evaluate",
          withStorageRoot(payload as TerminalPermissionEvaluateRequest)
        )
    ],
    [
      LYRA_CHANNELS.terminalPermissionsRespond,
      (_event, payload) =>
        requestRuntime<TerminalPermissionRespondResponse>(
          "terminal.permissions.respond",
          withStorageRoot(payload as TerminalPermissionRespondRequest)
        )
    ],
    [
      LYRA_CHANNELS.terminalProcessesRead,
      (_event, payload) => readProcesses(payload as TerminalProcessesReadRequest)
    ],
    [
      LYRA_CHANNELS.terminalProcessesSignal,
      (_event, payload) => signalProcess(payload as TerminalProcessSignalRequest)
    ],
    [
      LYRA_CHANNELS.terminalResizeSession,
      (_event, payload) =>
        (async () => {
          try {
            const normalized = normalizeResizeRequest(payload as TerminalResizeRequest);
            await requestRuntime<void>(
              "terminal.sessions.resize",
              withStorageRoot(normalized)
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
            await closeSession(request);
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
        })()
    ]
  ];

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, async (event, payload) => handler(event, payload));
  }

  const readObservation = (
    request: TerminalReadRequest
  ): Promise<TerminalReadResponse> => readSessionObservation(request);
  const evaluatePermission = (
    request: TerminalPermissionEvaluateRequest
  ): Promise<TerminalPermissionEvaluateResponse> =>
    requestRuntime<TerminalPermissionEvaluateResponse>(
      "terminal.permissions.evaluate",
      withStorageRoot(request)
    );
  const respondPermission = (
    request: TerminalPermissionRespondRequest
  ): Promise<TerminalPermissionRespondResponse> =>
    requestRuntime<TerminalPermissionRespondResponse>(
      "terminal.permissions.respond",
      withStorageRoot(request)
    );
  const resize = (request: TerminalResizeRequest): Promise<void> =>
    (async () => {
      const normalized = normalizeResizeRequest(request);
      await requestRuntime<void>(
        "terminal.sessions.resize",
        withStorageRoot(normalized)
      );
    })();

  return {
    loadResult: {
      loadedFrom: "lyrad"
    },
    createSession,
    attachRenderer,
    detachRenderer,
    ackData,
    reloadPrompt,
    write: writeSession,
    readObservation,
    evaluatePermission,
    respondPermission,
    readProcesses,
    signalProcess,
    resize,
    closeSession,
    dispose: () => {
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
      unsubscribeRuntimeEvents();
      closeTerminalDataPort();
      for (const state of terminalInputFlowBySession.values()) {
        if (state.flushTimer !== null) {
          clearTimeout(state.flushTimer);
        }
      }
      terminalInputFlowBySession.clear();
    }
  };
};
