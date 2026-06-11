import type { AgentToolActivity } from "../../../../shared/agent";
import type { ToolActionTarget, ToolDetails } from "../../ai-panel/agent-chat-demo/core/types";
import { asRecord, arrayField, numberField, rangeField, stringField, toolInputRecord, uniqueActionTargets } from "./common";

type ParsedTerminalDetails = Extract<ToolDetails, { type: "terminal" }>;

export const normalizeTerminalTarget = (value: unknown): ParsedTerminalDetails["target"] => {
  const record = asRecord(value);
  const type = stringField(record, "type");
  if (type === "private" || type === "ui" || type === "list") {
    return type;
  }
  return "private";
};

export const normalizeTerminalReason = (
  value: string | undefined
): ParsedTerminalDetails["reason"] | undefined => {
  if (value === "output" || value === "exit" || value === "timeout") {
    return value;
  }
  return undefined;
};

export const terminalMemoryFromRaw = (
  rawMemory: Record<string, unknown>
): ParsedTerminalDetails["memory"] | undefined => {
  const eventLogPath = stringField(rawMemory, "eventLogPath");
  const summaryPath = stringField(rawMemory, "summaryPath");
  const uiTimelinePath = stringField(rawMemory, "uiTimelinePath");
  const outputTextPath = stringField(rawMemory, "outputTextPath");
  const rawOutputPath = stringField(rawMemory, "rawOutputPath");
  const lineIndexPath = stringField(rawMemory, "lineIndexPath");
  const errorIndexPath = stringField(rawMemory, "errorIndexPath");
  const commandsPath = stringField(rawMemory, "commandsPath");
  const eventSeqRange = rangeField(rawMemory.eventSeqRange);
  const outputByteRange = rangeField(rawMemory.outputByteRange);
  const estimatedTokens = numberField(rawMemory, "estimatedTokens");
  const lineCount = numberField(rawMemory, "lineCount");
  const errorCount = numberField(rawMemory, "errorCount");
  const latestOutputPreview = stringField(rawMemory, "latestOutputPreview");
  const truncatedByProjection =
    typeof rawMemory.truncatedByProjection === "boolean"
      ? rawMemory.truncatedByProjection
      : undefined;
  const hasMemory =
    eventLogPath !== undefined
    || summaryPath !== undefined
    || uiTimelinePath !== undefined
    || outputTextPath !== undefined
    || rawOutputPath !== undefined
    || lineIndexPath !== undefined
    || errorIndexPath !== undefined
    || commandsPath !== undefined
    || eventSeqRange !== undefined
    || outputByteRange !== undefined
    || estimatedTokens !== undefined
    || lineCount !== undefined
    || errorCount !== undefined
    || latestOutputPreview !== undefined
    || truncatedByProjection !== undefined;
  if (!hasMemory) return undefined;
  return {
    ...(eventLogPath === undefined ? {} : { eventLogPath }),
    ...(summaryPath === undefined ? {} : { summaryPath }),
    ...(uiTimelinePath === undefined ? {} : { uiTimelinePath }),
    ...(outputTextPath === undefined ? {} : { outputTextPath }),
    ...(rawOutputPath === undefined ? {} : { rawOutputPath }),
    ...(lineIndexPath === undefined ? {} : { lineIndexPath }),
    ...(errorIndexPath === undefined ? {} : { errorIndexPath }),
    ...(commandsPath === undefined ? {} : { commandsPath }),
    ...(eventSeqRange === undefined ? {} : { eventSeqRange }),
    ...(outputByteRange === undefined ? {} : { outputByteRange }),
    ...(estimatedTokens === undefined ? {} : { estimatedTokens }),
    ...(lineCount === undefined ? {} : { lineCount }),
    ...(errorCount === undefined ? {} : { errorCount }),
    ...(latestOutputPreview === undefined ? {} : { latestOutputPreview }),
    ...(truncatedByProjection === undefined ? {} : { truncatedByProjection })
  };
};

export const terminalReadHintFromRaw = (
  rawReadHint: Record<string, unknown>
): ParsedTerminalDetails["readHint"] | undefined => {
  const message = stringField(rawReadHint, "message");
  const outputTextPath = stringField(rawReadHint, "outputTextPath");
  const rawOutputPath = stringField(rawReadHint, "rawOutputPath");
  const lineIndexPath = stringField(rawReadHint, "lineIndexPath");
  const errorIndexPath = stringField(rawReadHint, "errorIndexPath");
  const eventLogPath = stringField(rawReadHint, "eventLogPath");
  const summaryPath = stringField(rawReadHint, "summaryPath");
  const uiTimelinePath = stringField(rawReadHint, "uiTimelinePath");
  const commandsPath = stringField(rawReadHint, "commandsPath");
  const hasReadHint =
    message !== undefined
    || outputTextPath !== undefined
    || rawOutputPath !== undefined
    || lineIndexPath !== undefined
    || errorIndexPath !== undefined
    || eventLogPath !== undefined
    || summaryPath !== undefined
    || uiTimelinePath !== undefined
    || commandsPath !== undefined;
  if (!hasReadHint) return undefined;
  return {
    ...(message === undefined ? {} : { message }),
    ...(outputTextPath === undefined ? {} : { outputTextPath }),
    ...(rawOutputPath === undefined ? {} : { rawOutputPath }),
    ...(lineIndexPath === undefined ? {} : { lineIndexPath }),
    ...(errorIndexPath === undefined ? {} : { errorIndexPath }),
    ...(eventLogPath === undefined ? {} : { eventLogPath }),
    ...(summaryPath === undefined ? {} : { summaryPath }),
    ...(uiTimelinePath === undefined ? {} : { uiTimelinePath }),
    ...(commandsPath === undefined ? {} : { commandsPath })
  };
};

export const terminalVisibleRowsFromRaw = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        const row = numberField(record, "row");
        const text = stringField(record, "text") ?? "";
        if (row === undefined) return [];
        return [{ row, text, wrapped: typeof record.wrapped === "boolean" ? record.wrapped : false }];
      })
    : [];

export const terminalCellsFromRaw = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        const row = numberField(record, "row");
        const col = numberField(record, "col");
        const width = numberField(record, "width");
        if (row === undefined || col === undefined || width === undefined) return [];
        return [{
          row,
          col,
          text: stringField(record, "text") ?? "",
          width,
          styleId: stringField(record, "styleId") ?? null,
          hyperlinkId: stringField(record, "hyperlinkId") ?? null
        }];
      })
    : [];

export const terminalStylesFromRaw = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        const styleId = stringField(record, "styleId");
        if (styleId === undefined) return [];
        return [{
          styleId,
          foreground: stringField(record, "foreground") ?? "default",
          background: stringField(record, "background") ?? "default",
          bold: typeof record.bold === "boolean" ? record.bold : false,
          dim: typeof record.dim === "boolean" ? record.dim : false,
          italic: typeof record.italic === "boolean" ? record.italic : false,
          underline: typeof record.underline === "boolean" ? record.underline : false,
          inverse: typeof record.inverse === "boolean" ? record.inverse : false
        }];
      })
    : [];

export const terminalLinksFromRaw = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        const linkId = stringField(record, "linkId");
        const uri = stringField(record, "uri");
        const rowStart = numberField(record, "rowStart");
        const rowEnd = numberField(record, "rowEnd");
        const colStart = numberField(record, "colStart");
        const colEnd = numberField(record, "colEnd");
        if (
          linkId === undefined
          || uri === undefined
          || rowStart === undefined
          || rowEnd === undefined
          || colStart === undefined
          || colEnd === undefined
        ) return [];
        return [{ linkId, uri, rowStart, rowEnd, colStart, colEnd }];
      })
    : [];

export const terminalInputModesFromRaw = (value: unknown) => {
  const record = asRecord(value);
  return {
    applicationCursor:
      typeof record.applicationCursor === "boolean" ? record.applicationCursor : false,
    applicationKeypad:
      typeof record.applicationKeypad === "boolean" ? record.applicationKeypad : false,
    bracketedPaste:
      typeof record.bracketedPaste === "boolean" ? record.bracketedPaste : false,
    mouseReporting: stringField(record, "mouseReporting") ?? "none",
    mouseEncoding: stringField(record, "mouseEncoding") ?? "default",
    lineWrap: typeof record.lineWrap === "boolean" ? record.lineWrap : true
  };
};

export const terminalScreenFromRaw = (
  rawScreen: Record<string, unknown>
): ParsedTerminalDetails["screen"] | undefined => {
  const cursor = stringField(rawScreen, "cursor");
  const screenVersion = numberField(rawScreen, "screenVersion");
  const rows = numberField(rawScreen, "rows");
  const cols = numberField(rawScreen, "cols");
  const visibleText = stringField(rawScreen, "visibleText") ?? "";
  const rawCursorPosition = asRecord(rawScreen.cursorPosition);
  const cursorRow = numberField(rawCursorPosition, "row");
  const cursorCol = numberField(rawCursorPosition, "col");
  if (
    cursor === undefined
    || screenVersion === undefined
    || rows === undefined
    || cols === undefined
    || cursorRow === undefined
    || cursorCol === undefined
  ) {
    return undefined;
  }
  const mode = stringField(rawScreen, "mode");
  return {
    cursor,
    screenVersion,
    rows,
    cols,
    mode: mode === "normal" || mode === "alternate" ? mode : "unknown",
    visibleText,
    visibleRows: terminalVisibleRowsFromRaw(rawScreen.visibleRows),
    scrollbackText: stringField(rawScreen, "scrollbackText") ?? null,
    scrollbackCursor: stringField(rawScreen, "scrollbackCursor") ?? "0",
    scrollbackRows: terminalVisibleRowsFromRaw(rawScreen.scrollbackRows),
    cursorPosition: {
      row: cursorRow,
      col: cursorCol,
      visible: typeof rawCursorPosition.visible === "boolean" ? rawCursorPosition.visible : true
    },
    cells: terminalCellsFromRaw(rawScreen.cells),
    cellsTruncated: typeof rawScreen.cellsTruncated === "boolean" ? rawScreen.cellsTruncated : false,
    styles: terminalStylesFromRaw(rawScreen.styles),
    links: terminalLinksFromRaw(rawScreen.links),
    inputModes: terminalInputModesFromRaw(rawScreen.inputModes),
    selectedText: stringField(rawScreen, "selectedText") ?? null,
    activeCommand: stringField(rawScreen, "activeCommand") ?? null,
    prompt: stringField(rawScreen, "prompt") ?? null,
    regions: [],
    truncated: typeof rawScreen.truncated === "boolean" ? rawScreen.truncated : false
  };
};

export const terminalArtifactTarget = (
  label: string,
  path: string | undefined
): ToolActionTarget | null =>
  path === undefined
    ? null
    : {
        kind: "file",
        label,
        value: path
      };

export const terminalArtifactTargets = (
  memory: ParsedTerminalDetails["memory"],
  readHint: ParsedTerminalDetails["readHint"]
): ToolActionTarget[] => uniqueActionTargets([
  terminalArtifactTarget("summary.json", readHint?.summaryPath ?? memory?.summaryPath),
  terminalArtifactTarget("ui-timeline.jsonl", readHint?.uiTimelinePath ?? memory?.uiTimelinePath),
  terminalArtifactTarget("session-output.txt", readHint?.outputTextPath ?? memory?.outputTextPath),
  terminalArtifactTarget("session-output.raw", readHint?.rawOutputPath ?? memory?.rawOutputPath),
  terminalArtifactTarget(
    "session-output.lines.jsonl",
    readHint?.lineIndexPath ?? memory?.lineIndexPath
  ),
  terminalArtifactTarget(
    "session-output.errors.jsonl",
    readHint?.errorIndexPath ?? memory?.errorIndexPath
  ),
  terminalArtifactTarget("events.jsonl", readHint?.eventLogPath ?? memory?.eventLogPath),
  terminalArtifactTarget("commands.jsonl", readHint?.commandsPath ?? memory?.commandsPath)
]);

export const toTerminalDetails = (
  tool: AgentToolActivity,
  output: string,
  raw: Record<string, unknown>
): ParsedTerminalDetails => {
  const input = toolInputRecord(tool);
  const target = asRecord(raw.target);
  const action = stringField(input, "action") ?? "terminal";
  const cursor = stringField(raw, "cursor");
  const sessionId = stringField(raw, "sessionId");
  const terminalTabId = stringField(raw, "terminalTabId") ?? stringField(target, "terminalTabId");
  const paneId = stringField(raw, "paneId") ?? stringField(target, "paneId");
  const command = stringField(raw, "command") ?? stringField(input, "command");
  const wrote = stringField(raw, "wrote");
  const reason = normalizeTerminalReason(stringField(raw, "reason"));
  const screen = terminalScreenFromRaw(asRecord(raw.screen));
  const memory = terminalMemoryFromRaw(asRecord(raw.memory));
  const readHint = terminalReadHintFromRaw(asRecord(raw.readHint));
  const artifacts = terminalArtifactTargets(memory, readHint);
  return {
    type: "terminal",
    action,
    target: normalizeTerminalTarget(raw.target),
    output: stringField(raw, "output") ?? screen?.visibleText ?? output,
    running: typeof raw.running === "boolean" ? raw.running : false,
    exitCode: typeof raw.exitCode === "number" ? raw.exitCode : null,
    truncated: typeof raw.truncated === "boolean" ? raw.truncated : false,
    ...(cursor === undefined ? {} : { cursor }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(terminalTabId === undefined ? {} : { terminalTabId }),
    ...(paneId === undefined ? {} : { paneId }),
    ...(command === undefined ? {} : { command }),
    ...(wrote === undefined ? {} : { wrote }),
    ...(reason === undefined ? {} : { reason }),
    ...(screen === undefined ? {} : { screen }),
    ...(memory === undefined ? {} : { memory }),
    ...(readHint === undefined ? {} : { readHint }),
    ...(artifacts.length === 0 ? {} : { artifacts })
  };
};
