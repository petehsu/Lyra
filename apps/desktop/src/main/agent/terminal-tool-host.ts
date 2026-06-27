import { randomUUID } from "node:crypto";

import type {
  TerminalCreateRequest,
  TerminalMemoryActor,
  TerminalMemoryCorrelation,
  TerminalReadResponse,
  TerminalScreenReadResponse,
  TerminalSessionSnapshot
} from "../../shared/desktop-bridge";
import type { WorkbenchTerminalPaneDescriptor } from "../../shared/workbench-observation";
import type { TerminalIpcBridge } from "../terminal/types";
import type { WorkbenchObservationService } from "../workbench-observation/types";
import {
  terminalAgentToolNameForAction,
  terminalSemanticInputActionForToolAction,
  terminalWaitTargetFromPayload
} from "./terminal-tools";
import type { AgentHostCapabilityHandlers } from "./host-payload";
import {
  normalizePayload,
  readClampedOptionalNumber,
  readOptionalNumberField,
  readOptionalStringArrayField,
  readOptionalStringField,
  readRuntimeSessionId,
  readRuntimeToolCallId,
  readRuntimeTurnId,
  readStringField
} from "./host-payload";

export const createTerminalToolHost = ({
  terminalBridge,
  getWorkbenchObservationService,
  getBrowserFollowMode
}: {
  readonly terminalBridge: TerminalIpcBridge;
  readonly getWorkbenchObservationService: () => WorkbenchObservationService | null;
  readonly getBrowserFollowMode: () => boolean;
}): {
  readonly handlers: AgentHostCapabilityHandlers;
  readonly closePrivateTerminalsForSession: (agentSessionId: string) => Promise<void>;
  readonly listPrivateTerminalsForSession: (agentSessionId: string) => readonly {
    readonly sessionId: string;
    readonly title: string;
    readonly cwd?: string;
    readonly mode: "shell" | "command";
    readonly command?: string;
    readonly createdAt: string;
  }[];
  readonly closePrivateTerminalSession: (agentSessionId: string, terminalSessionId: string) => Promise<void>;
  readonly dispose: () => void;
} => {
  type TerminalTargetPreference = "auto" | "private" | "ui";
  type TerminalToolTarget = {
    readonly type: "private" | "ui";
    readonly sessionId: string;
    readonly terminalTabId?: string;
    readonly paneId?: string;
    readonly title?: string;
    readonly cwd?: string;
    readonly placement?: "dock" | "workspace";
  };
  type PrivateTerminalEntry = {
    readonly type: "private";
    readonly agentSessionId: string;
    readonly sessionId: string;
    readonly title: string;
    readonly cwd?: string;
    readonly mode: "shell" | "command";
    readonly command?: string;
    readonly createdAt: string;
    lastUsedAt: string;
    cursor?: string;
  };
  const privateTerminalsByAgentSession = new Map<string, Map<string, PrivateTerminalEntry>>();
  const cursorByTerminalSessionId = new Map<string, string>();
  const screenCursorByTerminalSessionId = new Map<string, string>();


  const createAgentTerminalMemoryContext = (
    payload: Record<string, unknown>,
    agentSessionId: string,
    terminalToolName: string,
    options: {
      readonly target?: TerminalToolTarget;
      readonly cwd?: string;
      readonly commandId?: string;
      readonly inputId?: string;
    } = {}
  ): {
    readonly actor: TerminalMemoryActor;
    readonly correlation: TerminalMemoryCorrelation;
  } => {
    const runtimeTurnId = readRuntimeTurnId(payload);
    const toolCallId = readRuntimeToolCallId(payload);
    const cwd = options.cwd ?? options.target?.cwd;
    return {
      actor: {
        kind: "agent",
        agentSessionId,
        ...(runtimeTurnId === undefined ? {} : { runtimeTurnId }),
        ...(toolCallId === undefined ? {} : { toolCallId })
      },
      correlation: {
        agentSessionId,
        ...(runtimeTurnId === undefined ? {} : { runtimeTurnId }),
        ...(toolCallId === undefined ? {} : { toolCallId }),
        terminalToolName,
        ...(options.commandId === undefined ? {} : { commandId: options.commandId }),
        ...(options.inputId === undefined ? {} : { inputId: options.inputId }),
        ...(options.target?.terminalTabId === undefined
          ? {}
          : { terminalTabId: options.target.terminalTabId }),
        ...(options.target?.paneId === undefined ? {} : { paneId: options.target.paneId }),
        ...(cwd === undefined ? {} : { cwd })
      }
    };
  };

  const readTerminalTargetPreference = (
    payload: Record<string, unknown>
  ): TerminalTargetPreference => {
    const value = payload.target;
    if (value === "private" || value === "ui") {
      return value;
    }
    return "auto";
  };

  const readOptionalTerminalId = (
    payload: Record<string, unknown>,
    fieldName: "sessionId" | "terminalTabId" | "paneId"
  ): string | undefined => {
    const value = payload[fieldName];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  };


  const readTerminalCommand = (payload: Record<string, unknown>): string | undefined =>
    readOptionalStringField(payload, "command");

  const readTerminalMode = (
    payload: Record<string, unknown>,
    command: string | undefined
  ): "shell" | "command" => {
    if (command !== undefined) {
      return "command";
    }
    return payload.mode === "command" ? "command" : "shell";
  };

  const targetFromPrivateEntry = (entry: PrivateTerminalEntry): TerminalToolTarget => ({
    type: "private",
    sessionId: entry.sessionId,
    title: entry.title,
    ...(entry.cwd === undefined ? {} : { cwd: entry.cwd })
  });

  const targetFromUiPane = (pane: WorkbenchTerminalPaneDescriptor): TerminalToolTarget => ({
    type: "ui",
    sessionId: pane.sessionId,
    terminalTabId: pane.terminalTabId,
    paneId: pane.paneId,
    title: pane.title,
    placement: pane.placement,
    ...(pane.currentCwd !== undefined || pane.cwd !== undefined
      ? { cwd: pane.currentCwd ?? pane.cwd }
      : {})
  });

  const privateTerminalMapForSession = (
    agentSessionId: string
  ): Map<string, PrivateTerminalEntry> => {
    const existing = privateTerminalsByAgentSession.get(agentSessionId);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Map<string, PrivateTerminalEntry>();
    privateTerminalsByAgentSession.set(agentSessionId, created);
    return created;
  };

  const findPrivateTerminalEntry = (
    sessionId: string,
    preferredAgentSessionId?: string
  ): PrivateTerminalEntry | null => {
    if (preferredAgentSessionId !== undefined) {
      const preferred = privateTerminalsByAgentSession
        .get(preferredAgentSessionId)
        ?.get(sessionId);
      if (preferred !== undefined) {
        return preferred;
      }
    }
    for (const terminals of privateTerminalsByAgentSession.values()) {
      const entry = terminals.get(sessionId);
      if (entry !== undefined) {
        return entry;
      }
    }
    return null;
  };

  const latestPrivateTerminalEntry = (agentSessionId: string): PrivateTerminalEntry | null => {
    const terminals = privateTerminalsByAgentSession.get(agentSessionId);
    if (terminals === undefined || terminals.size === 0) {
      return null;
    }
    return [...terminals.values()].sort((left, right) =>
      right.lastUsedAt.localeCompare(left.lastUsedAt)
    )[0] ?? null;
  };

  const rememberTerminalCursor = (target: TerminalToolTarget, cursor: string): void => {
    cursorByTerminalSessionId.set(target.sessionId, cursor);
    if (target.type !== "private") {
      return;
    }
    const entry = findPrivateTerminalEntry(target.sessionId);
    if (entry !== null) {
      entry.cursor = cursor;
      entry.lastUsedAt = new Date().toISOString();
    }
  };

  const isSessionNotFoundError = (error: unknown): boolean =>
    error instanceof Error && /session not found/i.test(error.message);

  const waitForTerminalSessionReady = async (
    sessionId: string,
    timeoutMs = 3_000
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown = null;
    while (Date.now() <= deadline) {
      try {
        await terminalBridge.readObservation({
          sessionId,
          cursor: "0",
          maxBytes: 1,
          waitMs: 25
        });
        return;
      } catch (error) {
        lastError = error;
        if (!isSessionNotFoundError(error)) {
          throw error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      lastError instanceof Error
        ? `Terminal session did not become ready: ${lastError.message}`
        : "Terminal session did not become ready."
    );
  };

  const createPrivateTerminal = async (
    agentSessionId: string,
    payload: Record<string, unknown>
  ): Promise<{
    readonly target: TerminalToolTarget;
    readonly snapshot: TerminalSessionSnapshot;
  }> => {
    const command = readTerminalCommand(payload);
    const mode = readTerminalMode(payload, command);
    if (mode === "command" && command === undefined) {
      throw new Error("terminal_create mode=command requires command");
    }
    const cols = readClampedOptionalNumber(payload, "cols", 80, 1, 300);
    const rows = readClampedOptionalNumber(payload, "rows", 24, 1, 300);
    const title =
      readOptionalStringField(payload, "title")
      ?? (command === undefined ? "Agent Terminal" : command.slice(0, 80));
    const cwd = readOptionalStringField(payload, "cwd");
    const sessionId = `agent-terminal-${agentSessionId}-${randomUUID()}`;
    const commandId = command === undefined ? undefined : `terminal-command-${randomUUID()}`;
    const memoryContext = createAgentTerminalMemoryContext(payload, agentSessionId, "terminal.create", {
      ...(cwd === undefined ? {} : { cwd }),
      ...(commandId === undefined ? {} : { commandId })
    });
    const request: TerminalCreateRequest = {
      sessionId,
      title,
      cols,
      rows,
      source: "agent",
      mode,
      persist: false,
      actor: memoryContext.actor,
      correlation: memoryContext.correlation,
      ...(cwd === undefined ? {} : { cwd }),
      ...(command === undefined ? {} : { command })
    };
    const snapshot = await terminalBridge.createSession(request);
    const now = new Date().toISOString();
    const entry: PrivateTerminalEntry = {
      type: "private",
      agentSessionId,
      sessionId: snapshot.sessionId,
      title: snapshot.title,
      mode,
      createdAt: now,
      lastUsedAt: now,
      ...(snapshot.cwd === undefined ? {} : { cwd: snapshot.cwd }),
      ...(command === undefined ? {} : { command })
    };
    privateTerminalMapForSession(agentSessionId).set(snapshot.sessionId, entry);
    return {
      target: targetFromPrivateEntry(entry),
      snapshot
    };
  };

  const resolvePrivateTerminal = async (
    agentSessionId: string,
    payload: Record<string, unknown>,
    createIfMissing: boolean
  ): Promise<TerminalToolTarget> => {
    const requestedSessionId = readOptionalTerminalId(payload, "sessionId");
    if (requestedSessionId !== undefined) {
      const entry = findPrivateTerminalEntry(requestedSessionId, agentSessionId);
      if (entry === null) {
        throw new Error(`Private terminal session not found: ${requestedSessionId}`);
      }
      entry.lastUsedAt = new Date().toISOString();
      return targetFromPrivateEntry(entry);
    }
    const existing = latestPrivateTerminalEntry(agentSessionId);
    if (existing !== null) {
      existing.lastUsedAt = new Date().toISOString();
      return targetFromPrivateEntry(existing);
    }
    if (!createIfMissing) {
      throw new Error("No private Agent terminal exists. Call terminal_create first.");
    }
    return (await createPrivateTerminal(agentSessionId, payload)).target;
  };

  const resolveUiTerminal = async (
    agentSessionId: string,
    payload: Record<string, unknown>,
    openIfMissing: boolean,
    options: {
      readonly fallbackToActiveWhenOnlySessionId?: boolean;
    } = {}
  ): Promise<TerminalToolTarget> => {
    const service = getWorkbenchObservationService();
    if (service === null) {
      throw new Error("Workbench terminal capability is not available");
    }
    const requestedSessionId = readOptionalTerminalId(payload, "sessionId");
    const requestedTerminalTabId = readOptionalTerminalId(payload, "terminalTabId");
    const requestedPaneId = readOptionalTerminalId(payload, "paneId");
    const listedRaw = await service.listTerminalPanes({});
    const listed = {
      active: listedRaw.active,
      panes: listedRaw.panes
    };
    const explicitTarget =
      requestedSessionId !== undefined
      || requestedTerminalTabId !== undefined
      || requestedPaneId !== undefined;
    let pane =
      listed.panes.find((entry) => (
        (requestedSessionId === undefined || entry.sessionId === requestedSessionId)
        && (requestedTerminalTabId === undefined || entry.terminalTabId === requestedTerminalTabId)
        && (requestedPaneId === undefined || entry.paneId === requestedPaneId)
      ))
      ?? null;
    const canFallbackToActive =
      options.fallbackToActiveWhenOnlySessionId === true
      && requestedSessionId !== undefined
      && requestedTerminalTabId === undefined
      && requestedPaneId === undefined;
    if (pane === null && explicitTarget && !canFallbackToActive) {
      throw new Error("Requested UI terminal pane was not found.");
    }
    if (pane === null) {
      pane = listed.active;
    }
    if (pane === null && openIfMissing) {
      const title = readOptionalStringField(payload, "title");
      const cwd = readOptionalStringField(payload, "cwd");
      pane = await service.openTerminalPane({
        placement: "dock",
        title: title ?? "Agent Terminal",
        sourceAgentSessionId: agentSessionId,
        ...(cwd === undefined ? {} : { cwd })
      });
      await waitForTerminalSessionReady(pane.sessionId);
    }
    if (pane === null) {
      throw new Error("No UI terminal pane is available. Call terminal_create first.");
    }
    try {
      const focused = await service.focusTerminalPane({
        terminalTabId: pane.terminalTabId,
        paneId: pane.paneId
      });
      pane = focused;
    } catch {
      // Focus is best-effort; the runtime session can still be controlled by id.
    }
    return targetFromUiPane(pane);
  };

  const resolveTerminalTarget = async (
    agentSessionId: string,
    payload: Record<string, unknown>,
    options: {
      readonly privateCreateIfMissing: boolean;
      readonly uiOpenIfMissing: boolean;
    }
  ): Promise<TerminalToolTarget> => {
    const preference = readTerminalTargetPreference(payload);
    const requestedSessionId = readOptionalTerminalId(payload, "sessionId");
    const hasUiRef =
      readOptionalTerminalId(payload, "terminalTabId") !== undefined
      || readOptionalTerminalId(payload, "paneId") !== undefined;
    if (
      preference === "ui"
      || hasUiRef
      || (preference === "auto" && getBrowserFollowMode())
    ) {
      return await resolveUiTerminal(agentSessionId, payload, options.uiOpenIfMissing, {
        fallbackToActiveWhenOnlySessionId:
          preference === "auto" && getBrowserFollowMode() && !hasUiRef
      });
    }
    if (requestedSessionId !== undefined) {
      const privateEntry = findPrivateTerminalEntry(requestedSessionId, agentSessionId);
      if (privateEntry !== null) {
        privateEntry.lastUsedAt = new Date().toISOString();
        return targetFromPrivateEntry(privateEntry);
      }
    }
    return await resolvePrivateTerminal(
      agentSessionId,
      payload,
      options.privateCreateIfMissing
    );
  };

  const hasExplicitTerminalTarget = (payload: Record<string, unknown>): boolean =>
    readOptionalTerminalId(payload, "sessionId") !== undefined
    || readOptionalTerminalId(payload, "terminalTabId") !== undefined
    || readOptionalTerminalId(payload, "paneId") !== undefined;

  const readTerminalRunningState = async (
    target: TerminalToolTarget
  ): Promise<boolean | null> => {
    try {
      const response = await terminalBridge.readObservation({
        sessionId: target.sessionId,
        maxBytes: 1,
        waitMs: 0
      });
      return response.running;
    } catch (error) {
      if (isSessionNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  };

  const openReplacementUiTerminal = async (
    agentSessionId: string,
    payload: Record<string, unknown>
  ): Promise<TerminalToolTarget> => {
    const service = getWorkbenchObservationService();
    if (service === null) {
      throw new Error("Workbench terminal capability is not available");
    }
    const title = readOptionalStringField(payload, "title");
    const cwd = readOptionalStringField(payload, "cwd");
    const pane = await service.openTerminalPane({
      placement: "dock",
      title: title ?? "Agent Terminal",
      sourceAgentSessionId: agentSessionId,
      ...(cwd === undefined ? {} : { cwd })
    });
    await waitForTerminalSessionReady(pane.sessionId);
    try {
      const focused = await service.focusTerminalPane({
        terminalTabId: pane.terminalTabId,
        paneId: pane.paneId
      });
      return targetFromUiPane(focused);
    } catch {
      return targetFromUiPane(pane);
    }
  };

  const ensureWritableTerminalTarget = async (
    agentSessionId: string,
    payload: Record<string, unknown>,
    target: TerminalToolTarget,
    targetPreference: TerminalTargetPreference
  ): Promise<TerminalToolTarget> => {
    const running = await readTerminalRunningState(target);
    if (running !== false) {
      return target;
    }
    const explicitTarget = hasExplicitTerminalTarget(payload);
    if (explicitTarget) {
      throw new Error(
        `terminal_session_not_running: ${target.sessionId} is stopped. Call terminal_create or choose a running terminal before writing input.`
      );
    }
    if (target.type === "ui") {
      if (targetPreference === "ui" || (targetPreference === "auto" && getBrowserFollowMode())) {
        return await openReplacementUiTerminal(agentSessionId, payload);
      }
    } else if (targetPreference !== "ui") {
      privateTerminalsByAgentSession.get(agentSessionId)?.delete(target.sessionId);
      return (await createPrivateTerminal(agentSessionId, payload)).target;
    }
    throw new Error(
      `terminal_session_not_running: ${target.sessionId} is stopped. Call terminal_create or choose a running terminal before writing input.`
    );
  };

  const terminalInlineOutputByteLimit = 16_000;

  const truncateUtf8 = (value: string, maxBytes: number): string => {
    let bytes = 0;
    let result = "";
    for (const char of value) {
      const charBytes = Buffer.byteLength(char, "utf8");
      if (bytes + charBytes > maxBytes) {
        break;
      }
      bytes += charBytes;
      result += char;
    }
    return result;
  };

  const projectTerminalOutput = (
    response: TerminalReadResponse
  ): {
    readonly output: string;
    readonly truncated: boolean;
  } => {
    if (Buffer.byteLength(response.output, "utf8") <= terminalInlineOutputByteLimit) {
      return { output: response.output, truncated: false };
    }
    const outputPath = response.memory?.outputTextPath;
    const suffix = outputPath === undefined
      ? "\n\n[Terminal output projected for model context; read the terminal memory artifact for the full output.]"
      : `\n\n[Terminal output projected for model context; full output is cached at ${outputPath}.]`;
    return {
      output: `${truncateUtf8(response.output, terminalInlineOutputByteLimit)}${suffix}`,
      truncated: true
    };
  };

  const terminalToolResult = (
    target: TerminalToolTarget,
    response: TerminalReadResponse,
    extra: Record<string, unknown> = {}
  ) => {
    rememberTerminalCursor(target, response.cursor);
    const projected = projectTerminalOutput(response);
    const memory = response.memory === undefined
      ? undefined
      : {
        ...response.memory,
        truncatedByProjection: response.memory.truncatedByProjection || projected.truncated
      };
    const readHint = terminalReadHintFromMemory(memory);
    return {
      target,
      sessionId: target.sessionId,
      ...(target.terminalTabId === undefined ? {} : { terminalTabId: target.terminalTabId }),
      ...(target.paneId === undefined ? {} : { paneId: target.paneId }),
      cursor: response.cursor,
      output: projected.output,
      running: response.running,
      exitCode: response.exitCode,
      lifecycle: response.lifecycle,
      truncated: response.truncated || projected.truncated,
      ...(memory === undefined ? {} : { memory }),
      ...(readHint === undefined ? {} : { readHint }),
      ...extra
    };
  };

  const terminalScreenToolResult = (
    target: TerminalToolTarget,
    response: TerminalScreenReadResponse
  ) => {
    screenCursorByTerminalSessionId.set(target.sessionId, response.cursor);
    const visibleProjection =
      Buffer.byteLength(response.visibleText, "utf8") <= terminalInlineOutputByteLimit
        ? { visibleText: response.visibleText, truncated: false }
        : {
          visibleText: `${truncateUtf8(
            response.visibleText,
            terminalInlineOutputByteLimit
          )}\n\n[Terminal screen projected for model context; full output history is cached in terminal memory artifacts.]`,
          truncated: true
        };
    const memory = response.memory === undefined
      ? undefined
      : {
        ...response.memory,
        truncatedByProjection:
          response.memory.truncatedByProjection || response.truncated || visibleProjection.truncated
      };
    const readHint = memory?.truncatedByProjection === true
      ? {
        message:
          "Terminal screen was projected for model context. Use terminal_screen again for the live view, or file_read/code_search_text on outputTextPath for full output history.",
        outputTextPath: memory.outputTextPath,
        rawOutputPath: memory.rawOutputPath,
        lineIndexPath: memory.lineIndexPath,
        errorIndexPath: memory.errorIndexPath,
        eventLogPath: memory.eventLogPath,
        summaryPath: memory.summaryPath,
        uiTimelinePath: memory.uiTimelinePath,
        commandsPath: memory.commandsPath
      }
      : undefined;
    return {
      target,
      sessionId: target.sessionId,
      ...(target.terminalTabId === undefined ? {} : { terminalTabId: target.terminalTabId }),
      ...(target.paneId === undefined ? {} : { paneId: target.paneId }),
      cursor: response.cursor,
      output: visibleProjection.visibleText,
      screen: {
        cursor: response.cursor,
        screenVersion: response.screenVersion,
        rows: response.rows,
        cols: response.cols,
        mode: response.mode,
        visibleText: visibleProjection.visibleText,
        visibleRows: response.visibleRows,
        scrollbackText: response.scrollbackText,
        scrollbackCursor: response.scrollbackCursor,
        scrollbackRows: response.scrollbackRows,
        cursorPosition: response.cursorPosition,
        cells: response.cells,
        cellsTruncated: response.cellsTruncated,
        styles: response.styles,
        links: response.links,
        inputModes: response.inputModes,
        selectedText: response.selectedText,
        activeCommand: response.activeCommand,
        prompt: response.prompt,
        regions: response.regions,
        lifecycle: response.lifecycle,
        truncated: response.truncated || visibleProjection.truncated
      },
      running: response.running,
      exitCode: response.exitCode,
      lifecycle: response.lifecycle,
      truncated: response.truncated || visibleProjection.truncated,
      ...(memory === undefined ? {} : { memory }),
      ...(readHint === undefined ? {} : { readHint })
    };
  };

  const terminalTargetEnvelope = (target: TerminalToolTarget) => ({
    target,
    sessionId: target.sessionId,
    ...(target.terminalTabId === undefined ? {} : { terminalTabId: target.terminalTabId }),
    ...(target.paneId === undefined ? {} : { paneId: target.paneId })
  });

  const terminalReadHintFromMemory = (memory: TerminalReadResponse["memory"] | undefined) => {
    if (memory === undefined) {
      return undefined;
    }
    return {
      message:
        "Full terminal artifacts are cached on disk. Use file_read on the listed paths, or code_search_text for focused retrieval.",
      outputTextPath: memory.outputTextPath,
      rawOutputPath: memory.rawOutputPath,
      outputSummaryPath: memory.outputSummaryPath,
      lineIndexPath: memory.lineIndexPath,
      errorIndexPath: memory.errorIndexPath,
      eventLogPath: memory.eventLogPath,
      summaryPath: memory.summaryPath,
      uiTimelinePath: memory.uiTimelinePath,
      commandsPath: memory.commandsPath,
      processesPath: memory.processesPath,
      attachmentsPath: memory.attachmentsPath,
      screenDiffsPath: memory.screenDiffsPath,
      artifactListMethod: "terminal.artifacts.list",
      readRangeMethod: "terminal.output.readRange"
    };
  };

  const projectTerminalText = (
    output: string,
    artifactPath: string | undefined,
    label: string
  ) => {
    if (Buffer.byteLength(output, "utf8") <= terminalInlineOutputByteLimit) {
      return { output, truncated: false };
    }
    const suffix = artifactPath === undefined
      ? `\n\n[${label} projected for model context; read terminal memory artifacts for the full text.]`
      : `\n\n[${label} projected for model context; full text is cached at ${artifactPath}.]`;
    return {
      output: `${truncateUtf8(output, terminalInlineOutputByteLimit)}${suffix}`,
      truncated: true
    };
  };

  const readTerminalOutput = async (
    target: TerminalToolTarget,
    payload: Record<string, unknown>,
    waitMs: number
  ): Promise<TerminalReadResponse> => {
    const cursor =
      readOptionalStringField(payload, "cursor")
      ?? cursorByTerminalSessionId.get(target.sessionId);
    return await terminalBridge.readObservation({
      sessionId: target.sessionId,
      ...(cursor === undefined ? {} : { cursor }),
      maxBytes: readClampedOptionalNumber(payload, "maxBytes", 16_000, 1, 262_144),
      waitMs
    });
  };

  const readTerminalEofCursor = async (sessionId: string): Promise<string | undefined> => {
    try {
      const response = await terminalBridge.readObservation({
        sessionId,
        cursor: String(Number.MAX_SAFE_INTEGER),
        maxBytes: 1,
        waitMs: 0
      });
      return response.cursor;
    } catch {
      return undefined;
    }
  };

  const closePrivateTerminalsForSession = async (agentSessionId: string): Promise<void> => {
    const terminals = privateTerminalsByAgentSession.get(agentSessionId);
    if (terminals === undefined) {
      return;
    }
    privateTerminalsByAgentSession.delete(agentSessionId);
    await Promise.all(
      [...terminals.keys()].map(async (sessionId) => {
        cursorByTerminalSessionId.delete(sessionId);
        screenCursorByTerminalSessionId.delete(sessionId);
        try {
          await terminalBridge.closeSession({
            sessionId,
            actor: { kind: "system" },
            correlation: {
              agentSessionId,
              terminalToolName: "terminal.closePrivateSession"
            }
          });
        } catch (error) {
          if (!isSessionNotFoundError(error)) {
            console.warn(`[lyra-agent] failed to close private terminal ${sessionId}:`, error);
          }
        }
      })
    );
  };

  const listPrivateTerminalsForSession = (agentSessionId: string): readonly {
    readonly sessionId: string;
    readonly title: string;
    readonly cwd?: string;
    readonly mode: "shell" | "command";
    readonly command?: string;
    readonly createdAt: string;
  }[] => {
    const terminals = privateTerminalsByAgentSession.get(agentSessionId);
    if (terminals === undefined) return [];
    return [...terminals.values()].map((entry) => ({
      sessionId: entry.sessionId,
      title: entry.title,
      ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }),
      mode: entry.mode,
      ...(entry.command === undefined ? {} : { command: entry.command }),
      createdAt: entry.createdAt
    }));
  };

  const closePrivateTerminalSession = async (
    agentSessionId: string,
    terminalSessionId: string
  ): Promise<void> => {
    const terminals = privateTerminalsByAgentSession.get(agentSessionId);
    if (terminals === undefined) return;
    const entry = terminals.get(terminalSessionId);
    if (entry === undefined) return;
    terminals.delete(terminalSessionId);
    cursorByTerminalSessionId.delete(terminalSessionId);
    screenCursorByTerminalSessionId.delete(terminalSessionId);
    try {
      await terminalBridge.closeSession({
        sessionId: terminalSessionId,
        actor: { kind: "system" },
        correlation: {
          agentSessionId,
          terminalToolName: "terminal.closePrivateSession"
        }
      });
    } catch (error) {
      if (!isSessionNotFoundError(error)) {
        console.warn(`[lyra-agent] failed to close private terminal ${terminalSessionId}:`, error);
      }
    }
  };


  const terminalHandlers: Record<string, (payload: unknown) => Promise<unknown>> = {
    "terminal.list": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const privateTerminals = [
        ...(privateTerminalsByAgentSession.get(agentSessionId)?.values() ?? [])
      ].map((entry) => ({
        ...targetFromPrivateEntry(entry),
        mode: entry.mode,
        createdAt: entry.createdAt,
        lastUsedAt: entry.lastUsedAt,
        ...(entry.cursor === undefined ? {} : { cursor: entry.cursor }),
        ...(entry.command === undefined ? {} : { command: entry.command })
      }));
      let uiTerminals: readonly WorkbenchTerminalPaneDescriptor[] = [];
      try {
        uiTerminals = (await getWorkbenchObservationService()?.listTerminalPanes({}))?.panes ?? [];
      } catch {
        uiTerminals = [];
      }
      const terminals = [
        ...privateTerminals,
        ...uiTerminals.map((pane) => targetFromUiPane(pane))
      ];
      return {
        target: {
          type: "list",
          preferred: getBrowserFollowMode() ? "ui" : "private"
        },
        terminals,
        cursor: "",
        output: terminals.length === 0 ? "No terminal sessions are available." : "",
        running: false,
        exitCode: null,
        truncated: false
      };
    },
    "terminal.create": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const preference = readTerminalTargetPreference(request);
      const command = readTerminalCommand(request);
      const useUi = preference === "ui"
        || (preference === "auto" && getBrowserFollowMode());
      if (useUi) {
        let target = await resolveUiTerminal(agentSessionId, request, true);
        await waitForTerminalSessionReady(target.sessionId);
        target = await ensureWritableTerminalTarget(
          agentSessionId,
          request,
          target,
          preference
        );
        const commandStartCursor = command === undefined
          ? undefined
          : await readTerminalEofCursor(target.sessionId);
        if (commandStartCursor !== undefined) {
          cursorByTerminalSessionId.set(target.sessionId, commandStartCursor);
        }
        if (command !== undefined) {
          const commandId = `terminal-command-${randomUUID()}`;
          const memoryContext = createAgentTerminalMemoryContext(
            request,
            agentSessionId,
            "terminal.create",
            { target, commandId }
          );
          await terminalBridge.write({
            sessionId: target.sessionId,
            text: command,
            appendNewline: true,
            source: "agent",
            actor: memoryContext.actor,
            correlation: memoryContext.correlation
          });
        }
        const response = await readTerminalOutput(target, request, command === undefined ? 0 : 500);
        return terminalToolResult(target, response, {
          command,
          mode: command === undefined ? "shell" : "command"
        });
      }

      const { target, snapshot } = await createPrivateTerminal(agentSessionId, request);
      const response = await terminalBridge.readObservation({
        sessionId: target.sessionId,
        cursor: "0",
        maxBytes: readClampedOptionalNumber(request, "maxBytes", 16_000, 1, 262_144),
        waitMs: snapshot.mode === "command" ? 500 : 0
      });
      return terminalToolResult(target, response, {
        mode: snapshot.mode,
        ...(snapshot.command === undefined ? {} : { command: snapshot.command })
      });
    },
    "terminal.read": async (payload) => {
      const request = normalizePayload(payload);
      const target = await resolveTerminalTarget(readRuntimeSessionId(request), request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const response = await readTerminalOutput(target, request, 0);
      return terminalToolResult(target, response);
    },
    "terminal.screen": async (payload) => {
      const request = normalizePayload(payload);
      const target = await resolveTerminalTarget(readRuntimeSessionId(request), request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const cursor =
        readOptionalStringField(request, "cursor")
        ?? screenCursorByTerminalSessionId.get(target.sessionId);
      const response = await terminalBridge.readScreen({
        sessionId: target.sessionId,
        ...(cursor === undefined ? {} : { cursor }),
        includeScrollback: request.includeScrollback === true,
        maxRows: readClampedOptionalNumber(request, "maxRows", 200, 1, 2_000),
        maxBytes: readClampedOptionalNumber(request, "maxBytes", 16_000, 1, 262_144)
      });
      return terminalScreenToolResult(target, response);
    },
    "terminal.wait": async (payload) => {
      const request = normalizePayload(payload);
      const target = await resolveTerminalTarget(readRuntimeSessionId(request), request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const memoryContext = createAgentTerminalMemoryContext(
        request,
        readRuntimeSessionId(request),
        "terminal.wait",
        { target }
      );
      const requestedCursor =
        readOptionalStringField(request, "cursor")
        ?? cursorByTerminalSessionId.get(target.sessionId);
      const waitMs = readClampedOptionalNumber(request, "waitMs", 1_000, 0, 30_000);
      const explicitCommandId = readOptionalStringField(request, "commandId");
      const commandStatus = await terminalBridge.readCommandStatus({
        sessionId: target.sessionId,
        ...(explicitCommandId === undefined ? {} : { commandId: explicitCommandId }),
        includeOutputSummary: false,
        actor: memoryContext.actor,
        correlation: memoryContext.correlation
      }).catch(() => undefined);
      const command = commandStatus?.command ?? null;
      const commandIsTerminal =
        command?.status === "completed"
        || command?.status === "failed"
        || command?.status === "cancelled";
      const commandMayBeActive =
        explicitCommandId !== undefined
        || command?.status === "pending"
        || command?.status === "running";
      if (command !== null && (commandIsTerminal || commandMayBeActive)) {
        const waited = commandIsTerminal
          ? {
            sessionId: target.sessionId,
            commandId: command.commandId,
            status: command.status,
            reason: "status",
            exitCode: command.exitCode ?? null,
            signal: command.signal ?? null,
            memory: commandStatus?.memory,
            lifecycle: commandStatus?.lifecycle
          }
          : await terminalBridge.waitCommand({
            sessionId: target.sessionId,
            commandId: command.commandId,
            status: readOptionalStringField(request, "status") ?? "any",
            timeoutMs: waitMs,
            actor: memoryContext.actor,
            correlation: memoryContext.correlation
          }).catch(() => undefined);
        if (waited !== undefined && waited.reason !== "timeout" && waited.reason !== "notFound") {
          const response = await terminalBridge.readObservation({
            sessionId: target.sessionId,
            ...(requestedCursor === undefined ? {} : { cursor: requestedCursor }),
            maxBytes: readClampedOptionalNumber(request, "maxBytes", 16_000, 1, 262_144),
            waitMs: 0
          });
          return terminalToolResult(target, response, {
            reason: `command:${waited.status}`,
            commandId: waited.commandId ?? command.commandId,
            running: false,
            exitCode: waited.exitCode ?? response.exitCode,
            lifecycle: waited.lifecycle ?? commandStatus?.lifecycle ?? response.lifecycle
          });
        }
      }
      const response = await terminalBridge.readObservation({
        sessionId: target.sessionId,
        ...(requestedCursor === undefined ? {} : { cursor: requestedCursor }),
        maxBytes: readClampedOptionalNumber(request, "maxBytes", 16_000, 1, 262_144),
        waitMs
      });
      return terminalToolResult(target, response, {
        reason: response.reason ?? "timeout"
      });
    },
    "terminal.write": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const targetPreference = readTerminalTargetPreference(request);
      let target = await resolveTerminalTarget(agentSessionId, request, {
        privateCreateIfMissing:
          targetPreference !== "ui"
          && !getBrowserFollowMode(),
        uiOpenIfMissing: targetPreference === "ui"
      });
      target = await ensureWritableTerminalTarget(
        agentSessionId,
        request,
        target,
        targetPreference
      );
      const data = typeof request.data === "string" ? request.data : undefined;
      const text = typeof request.text === "string" ? request.text : undefined;
      const keys = Array.isArray(request.keys)
        ? request.keys.filter((key): key is string => typeof key === "string")
        : undefined;
      if (data === undefined && text === undefined && (keys === undefined || keys.length === 0)) {
        throw new Error("terminal_write requires data, text, or keys");
      }
      const commandText = request.appendNewline === true && keys === undefined
        ? text ?? data
        : undefined;
      const commandId = commandText !== undefined && commandText.trim().length > 0
        ? `terminal-command-${randomUUID()}`
        : undefined;
      const commandStartCursor = commandId === undefined
        ? undefined
        : await readTerminalEofCursor(target.sessionId);
      if (commandStartCursor !== undefined) {
        cursorByTerminalSessionId.set(target.sessionId, commandStartCursor);
      }
      const memoryContext = createAgentTerminalMemoryContext(
        request,
        readRuntimeSessionId(request),
        "terminal.write",
        {
          target,
          inputId: `terminal-input-${randomUUID()}`,
          ...(commandId === undefined ? {} : { commandId })
        }
      );
      await terminalBridge.write({
        sessionId: target.sessionId,
        source: "agent",
        actor: memoryContext.actor,
        correlation: memoryContext.correlation,
        ...(data === undefined ? {} : { data }),
        ...(text === undefined ? {} : { text }),
        ...(keys === undefined ? {} : { keys }),
        ...(typeof request.appendNewline === "boolean"
          ? { appendNewline: request.appendNewline }
          : {})
      });
      const cursor = commandStartCursor ?? cursorByTerminalSessionId.get(target.sessionId);
      const response = await terminalBridge.readObservation({
        sessionId: target.sessionId,
        ...(cursor === undefined ? {} : { cursor }),
        maxBytes: readClampedOptionalNumber(request, "maxBytes", 16_000, 1, 262_144),
        waitMs: 250
      });
      return terminalToolResult(target, response, {
        wrote:
          data !== undefined
            ? `${data.length} bytes`
            : text !== undefined
              ? text
              : keys?.join(", ")
      });
    },
    "terminal.close": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const target = await resolveTerminalTarget(agentSessionId, request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const memoryContext = createAgentTerminalMemoryContext(
        request,
        agentSessionId,
        "terminal.close",
        { target }
      );
      try {
        await terminalBridge.closeSession({
          sessionId: target.sessionId,
          actor: memoryContext.actor,
          correlation: memoryContext.correlation
        });
      } catch (error) {
        if (!isSessionNotFoundError(error)) {
          throw error;
        }
      }
      cursorByTerminalSessionId.delete(target.sessionId);
      screenCursorByTerminalSessionId.delete(target.sessionId);
      if (target.type === "private") {
        privateTerminalsByAgentSession.get(agentSessionId)?.delete(target.sessionId);
      } else {
        await getWorkbenchObservationService()?.closeTerminalPane({
          sessionId: target.sessionId,
          ...(target.terminalTabId === undefined ? {} : { terminalTabId: target.terminalTabId }),
          ...(target.paneId === undefined ? {} : { paneId: target.paneId })
        });
      }
      return {
        target,
        sessionId: target.sessionId,
        cursor: "",
        output: "Terminal closed.",
        running: false,
        exitCode: null,
        truncated: false
      };
    },
    "terminal.events.read": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const target = await resolveTerminalTarget(agentSessionId, request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const memoryContext = createAgentTerminalMemoryContext(
        request,
        agentSessionId,
        "terminal_events",
        { target }
      );
      const cursor = readOptionalStringField(request, "cursor");
      const kinds = readOptionalStringArrayField(request, "kinds");
      const actors = readOptionalStringArrayField(request, "actors");
      const response = await terminalBridge.readEvents({
        sessionId: target.sessionId,
        ...(cursor === undefined ? {} : { cursor }),
        limit: readClampedOptionalNumber(request, "limit", 100, 1, 1000),
        ...(kinds === undefined ? {} : { kinds }),
        ...(actors === undefined ? {} : { actors }),
        actor: memoryContext.actor,
        correlation: memoryContext.correlation
      });
      return {
        ...terminalTargetEnvelope(target),
        cursor: response.cursor,
        nextCursor: response.nextCursor,
        hasMore: response.hasMore,
        items: response.items,
        events: response.items,
        memory: response.memory,
        readHint: terminalReadHintFromMemory(response.memory),
        output:
          response.items.length === 0
            ? "No terminal events after the requested cursor."
            : `Read ${response.items.length} terminal events.`,
        running: false,
        exitCode: null,
        truncated: false
      };
    },
    "terminal.waitUntil": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const target = await resolveTerminalTarget(agentSessionId, request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const memoryContext = createAgentTerminalMemoryContext(
        request,
        agentSessionId,
        "terminal_read_until",
        { target }
      );
      const text = readOptionalStringField(request, "text");
      const regex = readOptionalStringField(request, "regex");
      const commandId = readOptionalStringField(request, "commandId");
      const status = readOptionalStringField(request, "status");
      const waitTarget = terminalWaitTargetFromPayload(request);
      const cursor = readOptionalStringField(request, "cursor")
        ?? (waitTarget === "output" ? cursorByTerminalSessionId.get(target.sessionId) : undefined);
      const screenCursor = readOptionalStringField(request, "screenCursor");
      const response = await terminalBridge.waitUntil({
        sessionId: target.sessionId,
        target: waitTarget,
        ...(text === undefined ? {} : { text }),
        ...(regex === undefined ? {} : { regex }),
        ...(commandId === undefined ? {} : { commandId }),
        ...(status === undefined ? {} : { status }),
        ...(cursor === undefined ? {} : { cursor }),
        ...(screenCursor === undefined ? {} : { screenCursor }),
        timeoutMs: readClampedOptionalNumber(request, "timeoutMs", 30_000, 1, 120_000),
        maxBytes: readClampedOptionalNumber(request, "maxBytes", 16_000, 1, 262_144),
        actor: memoryContext.actor,
        correlation: memoryContext.correlation
      });
      if (typeof response.cursor === "string") {
        cursorByTerminalSessionId.set(target.sessionId, response.cursor);
      }
      if (typeof response.screenCursor === "string") {
        screenCursorByTerminalSessionId.set(target.sessionId, response.screenCursor);
      }
      const projected = projectTerminalText(
        response.output ?? "",
        response.memory?.outputTextPath,
        "Terminal wait output"
      );
      return {
        ...terminalTargetEnvelope(target),
        matched: response.matched,
        reason: response.reason,
        cursor: response.cursor ?? null,
        screenCursor: response.screenCursor ?? null,
        commandId: response.commandId ?? null,
        output: projected.output,
        memory: response.memory,
        readHint: terminalReadHintFromMemory(response.memory),
        lifecycle: response.lifecycle,
        running: false,
        exitCode: null,
        truncated: projected.truncated
      };
    },
    "terminal.input.execute": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const targetPreference = readTerminalTargetPreference(request);
      let target = await resolveTerminalTarget(agentSessionId, request, {
        privateCreateIfMissing:
          targetPreference !== "ui"
          && !getBrowserFollowMode(),
        uiOpenIfMissing: targetPreference === "ui"
      });
      target = await ensureWritableTerminalTarget(
        agentSessionId,
        request,
        target,
        targetPreference
      );
      const toolAction = readOptionalStringField(request, "action") ?? "input";
      const semanticAction = terminalSemanticInputActionForToolAction(toolAction, request);
      const terminalToolName = terminalAgentToolNameForAction(toolAction) ?? "terminal_input";
      const command = semanticAction === "runCommand"
        ? readStringField(request, "command")
        : undefined;
      const text = semanticAction === "submitInput" || semanticAction === "pasteText"
        ? readStringField(request, "text")
        : undefined;
      const keys = semanticAction === "pressKeys"
        ? readOptionalStringArrayField(request, "keys")
        : undefined;
      const sensitiveRefs = readOptionalStringArrayField(request, "sensitiveRefs");
      if (semanticAction === "pressKeys" && keys === undefined) {
        throw new Error("terminal_keys requires keys");
      }
      const commandId = command === undefined ? undefined : `terminal-command-${randomUUID()}`;
      const inputId = `terminal-input-${randomUUID()}`;
      const commandStartCursor = commandId === undefined
        ? undefined
        : await readTerminalEofCursor(target.sessionId);
      if (commandStartCursor !== undefined) {
        cursorByTerminalSessionId.set(target.sessionId, commandStartCursor);
      }
      const memoryContext = createAgentTerminalMemoryContext(
        request,
        agentSessionId,
        terminalToolName,
        {
          target,
          inputId,
          ...(commandId === undefined ? {} : { commandId })
        }
      );
      const inputResponse = await terminalBridge.executeInput({
        sessionId: target.sessionId,
        action: semanticAction,
        actor: memoryContext.actor,
        correlation: memoryContext.correlation,
        ...(command === undefined ? {} : { command }),
        ...(text === undefined ? {} : { text }),
        ...(keys === undefined ? {} : { keys }),
        ...(typeof request.appendNewline === "boolean"
          ? { appendNewline: request.appendNewline }
          : {}),
        ...(typeof request.bracketedPaste === "boolean"
          ? { bracketedPaste: request.bracketedPaste }
          : {}),
        ...(sensitiveRefs === undefined ? {} : { sensitiveRefs })
      });
      const cursor = commandStartCursor ?? cursorByTerminalSessionId.get(target.sessionId);
      const response = await terminalBridge.readObservation({
        sessionId: target.sessionId,
        ...(cursor === undefined ? {} : { cursor }),
        maxBytes: readClampedOptionalNumber(request, "maxBytes", 16_000, 1, 262_144),
        waitMs: 250
      });
      return terminalToolResult(target, response, {
        semanticAction,
        commandId,
        command,
        inputId: inputResponse.inputId ?? inputId,
        inputStatus: inputResponse.status,
        permissionId: inputResponse.permissionId ?? null,
        events: inputResponse.events,
        inputMemory: inputResponse.memory,
        lifecycle: inputResponse.lifecycle ?? response.lifecycle,
        wrote:
          command !== undefined
            ? command
            : text !== undefined
              ? `${text.length} chars`
              : keys?.join(", ")
      });
    },
    "terminal.resize": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const target = await resolveTerminalTarget(agentSessionId, request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const cols = readClampedOptionalNumber(request, "cols", 80, 1, 300);
      const rows = readClampedOptionalNumber(request, "rows", 24, 1, 300);
      const memoryContext = createAgentTerminalMemoryContext(
        request,
        agentSessionId,
        "terminal_resize",
        { target }
      );
      await terminalBridge.resize({
        sessionId: target.sessionId,
        cols,
        rows,
        actor: memoryContext.actor,
        correlation: memoryContext.correlation
      });
      const response = await terminalBridge.readScreen({
        sessionId: target.sessionId,
        maxRows: readClampedOptionalNumber(request, "maxRows", 200, 1, 2_000),
        maxBytes: readClampedOptionalNumber(request, "maxBytes", 16_000, 1, 262_144)
      });
      return {
        ...terminalScreenToolResult(target, response),
        action: "resize",
        cols,
        rows
      };
    },
    "terminal.processes.read": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const target = await resolveTerminalTarget(agentSessionId, request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const memoryContext = createAgentTerminalMemoryContext(
        request,
        agentSessionId,
        "terminal_processes",
        { target }
      );
      const pid = readOptionalNumberField(request, "pid");
      const response = await terminalBridge.readProcesses({
        sessionId: target.sessionId,
        ...(pid === undefined ? {} : { pid }),
        includeTree: request.includeTree === true,
        includeCommand: request.includeCommand !== false,
        actor: memoryContext.actor,
        correlation: memoryContext.correlation
      });
      return {
        ...terminalTargetEnvelope(target),
        ...response,
        readHint: terminalReadHintFromMemory(response.memory),
        output: `Read ${response.processes.length} terminal processes.`,
        truncated: response.limited === true
      };
    },
    "terminal.processes.signal": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const target = await resolveTerminalTarget(agentSessionId, request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const memoryContext = createAgentTerminalMemoryContext(
        request,
        agentSessionId,
        "terminal_signal",
        { target, inputId: `terminal-input-${randomUUID()}` }
      );
      const pid = readOptionalNumberField(request, "pid");
      const reason = readOptionalStringField(request, "reason");
      const response = await terminalBridge.signalProcess({
        sessionId: target.sessionId,
        signal: readStringField(request, "signal"),
        ...(pid === undefined ? {} : { pid }),
        ...(reason === undefined ? {} : { reason }),
        actor: memoryContext.actor,
        correlation: memoryContext.correlation
      });
      return {
        ...terminalTargetEnvelope(target),
        ...response,
        readHint: terminalReadHintFromMemory(response.memory),
        output: `Terminal signal ${response.signal} status=${response.status}.`,
        running: false,
        exitCode: null,
        truncated: false
      };
    },
    "terminal.command.status": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const target = await resolveTerminalTarget(agentSessionId, request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const memoryContext = createAgentTerminalMemoryContext(
        request,
        agentSessionId,
        "terminal_command_status",
        { target }
      );
      const requestedCommandId = readOptionalStringField(request, "commandId");
      const response = await terminalBridge.readCommandStatus({
        sessionId: target.sessionId,
        ...(requestedCommandId === undefined ? {} : { commandId: requestedCommandId }),
        includeOutputSummary: request.includeOutputSummary !== false,
        actor: memoryContext.actor,
        correlation: memoryContext.correlation
      });
      const commandId = response.commandId ?? response.command?.commandId ?? null;
      return {
        ...terminalTargetEnvelope(target),
        ...response,
        commandId,
        readHint: terminalReadHintFromMemory(response.memory),
        output:
          response.command === null || response.command === undefined
            ? "No terminal command status is available."
            : `Command ${response.command.commandId} status=${response.command.status}.`,
        running: response.command?.status === "running",
        exitCode: response.command?.exitCode ?? null,
        truncated: false
      };
    },
    "terminal.map.read": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const target = await resolveTerminalTarget(agentSessionId, request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const memoryContext = createAgentTerminalMemoryContext(
        request,
        agentSessionId,
        "terminal_map",
        { target }
      );
      const screenCursor = readOptionalStringField(request, "screenCursor");
      const response = await terminalBridge.readMap({
        sessionId: target.sessionId,
        ...(screenCursor === undefined ? {} : { screenCursor }),
        maxRegions: readClampedOptionalNumber(request, "maxRegions", 80, 1, 500),
        includeText: request.includeText !== false,
        actor: memoryContext.actor,
        correlation: memoryContext.correlation
      });
      const screenResult = terminalScreenToolResult(target, response.screen);
      return {
        ...terminalTargetEnvelope(target),
        screen: screenResult.screen,
        regions: response.regions,
        stale: response.stale === true,
        warning: response.warning,
        memory: response.memory ?? response.screen.memory,
        readHint: terminalReadHintFromMemory(response.memory ?? response.screen.memory),
        output: `Mapped ${response.regions.length} terminal regions.`,
        running: response.screen.running,
        exitCode: response.screen.exitCode,
        lifecycle: screenResult.lifecycle ?? response.screen.lifecycle,
        truncated: response.screen.truncated
      };
    },
    "terminal.act.execute": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const target = await resolveTerminalTarget(agentSessionId, request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const memoryContext = createAgentTerminalMemoryContext(
        request,
        agentSessionId,
        "terminal_act",
        { target, inputId: `terminal-input-${randomUUID()}` }
      );
      const regionId = readOptionalStringField(request, "regionId");
      const screenCursor = readOptionalStringField(request, "screenCursor");
      const text = readOptionalStringField(request, "text");
      const direction = readOptionalStringField(request, "direction");
      const amount = readOptionalNumberField(request, "amount");
      const reason = readOptionalStringField(request, "reason");
      const response = await terminalBridge.executeAct({
        sessionId: target.sessionId,
        action: readOptionalStringField(request, "operation") ?? "confirm",
        ...(regionId === undefined ? {} : { regionId }),
        ...(screenCursor === undefined ? {} : { screenCursor }),
        ...(text === undefined ? {} : { text }),
        ...(direction === undefined ? {} : { direction }),
        ...(amount === undefined ? {} : { amount }),
        ...(reason === undefined ? {} : { reason }),
        actor: memoryContext.actor,
        correlation: memoryContext.correlation
      });
      const screenResult = response.map?.screen === undefined
        ? null
        : terminalScreenToolResult(target, response.map.screen);
      return {
        ...terminalTargetEnvelope(target),
        actId: response.actId,
        status: response.status,
        inputId: response.inputId ?? null,
        permissionId: response.permissionId ?? null,
        screenCursor: response.screenCursor ?? null,
        map: response.map === undefined
          ? undefined
          : {
            regions: response.map.regions,
            stale: response.map.stale,
            warning: response.map.warning,
            screen: screenResult?.screen
          },
        regions: response.map?.regions,
        memory: response.memory ?? response.map?.memory,
        readHint: terminalReadHintFromMemory(response.memory ?? response.map?.memory),
        output: `Terminal act ${response.actId} status=${response.status}.`,
        running: screenResult?.running ?? false,
        exitCode: screenResult?.exitCode ?? null,
        lifecycle: screenResult?.lifecycle ?? response.map?.screen.lifecycle,
        truncated: screenResult?.truncated ?? false
      };
    },
    "terminal.attachments.attach": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const target = await resolveTerminalTarget(agentSessionId, request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const memoryContext = createAgentTerminalMemoryContext(
        request,
        agentSessionId,
        "terminal_attach_agent",
        { target }
      );
      const runtimeTurnId = readRuntimeTurnId(request);
      const toolCallId = readRuntimeToolCallId(request);
      const reason = readOptionalStringField(request, "reason");
      const ttlMs = readOptionalNumberField(request, "ttlMs");
      const response = await terminalBridge.attachAgent({
        sessionId: target.sessionId,
        agentSessionId,
        ...(runtimeTurnId === undefined ? {} : { runtimeTurnId }),
        ...(toolCallId === undefined ? {} : { toolCallId }),
        mode: readOptionalStringField(request, "mode") ?? "observe",
        ...(reason === undefined ? {} : { reason }),
        ...(ttlMs === undefined ? {} : { ttlMs }),
        actor: memoryContext.actor,
        correlation: memoryContext.correlation
      });
      return {
        ...terminalTargetEnvelope(target),
        ...response,
        readHint: terminalReadHintFromMemory(response.memory),
        output: `Attached Agent to terminal as ${response.attachment.mode}.`,
        running: false,
        exitCode: null,
        truncated: false
      };
    },
    "terminal.attachments.detach": async (payload) => {
      const request = normalizePayload(payload);
      const agentSessionId = readRuntimeSessionId(request);
      const target = await resolveTerminalTarget(agentSessionId, request, {
        privateCreateIfMissing: false,
        uiOpenIfMissing: false
      });
      const memoryContext = createAgentTerminalMemoryContext(
        request,
        agentSessionId,
        "terminal_detach_agent",
        { target }
      );
      const reason = readOptionalStringField(request, "reason");
      const response = await terminalBridge.detachAgent({
        sessionId: target.sessionId,
        attachmentId: readStringField(request, "attachmentId"),
        ...(reason === undefined ? {} : { reason }),
        actor: memoryContext.actor,
        correlation: memoryContext.correlation
      });
      return {
        ...terminalTargetEnvelope(target),
        ...response,
        readHint: terminalReadHintFromMemory(response.memory),
        output: `Detached Agent terminal attachment ${response.attachmentId}.`,
        running: false,
        exitCode: null,
        truncated: false
      };
    }
  };



  return {
    handlers: terminalHandlers,
    closePrivateTerminalsForSession,
    listPrivateTerminalsForSession,
    closePrivateTerminalSession,
    dispose: () => {
      for (const agentSessionId of [...privateTerminalsByAgentSession.keys()]) {
        void closePrivateTerminalsForSession(agentSessionId);
      }
    }
  };
};
