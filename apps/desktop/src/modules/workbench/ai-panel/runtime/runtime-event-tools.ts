import type { FileEditorRevealLocation } from "../../file-editor";
import {
  isTerminalToolName,
  isWriteToolName,
  toRuntimeFeedItem,
} from "./feed-utils";
import {
  isRecord,
  pickNumber,
  pickRawString,
  pickString,
} from "../view-helpers";
import {
  type RuntimeEventProcessingContext,
  RUNTIME_FEED_ITEM_LIMIT,
} from "./runtime-event-context";

export const handleWriteStreamEvent = ({
  event,
  payload,
  progress,
  onWriteStreamEvent,
}: RuntimeEventProcessingContext): void => {
  if (onWriteStreamEvent === undefined) {
    return;
  }
  const toolName = pickString(payload, "toolName");
  const toolCallId = pickString(payload, "toolCallId");
  const input = isRecord(payload.input) ? payload.input : null;
  const output = isRecord(payload.output) ? payload.output : null;
  const filePath =
    (progress === null ? null : pickString(progress, "path"))
    ?? (output === null ? null : pickString(output, "path"))
    ?? (input === null ? null : pickString(input, "path"));
  if (
    toolName === null
    || toolCallId === null
    || filePath === null
    || !isWriteToolName(toolName)
  ) {
    return;
  }
  if (event.phase === "tool_started") {
    onWriteStreamEvent({
      kind: "started",
      sessionId: event.sessionId,
      turnId: event.turnId,
      toolCallId,
      toolName,
      filePath,
      timestamp: event.timestamp,
    });
  }
  if (event.phase === "tool_progress" && progress !== null) {
    const stage = pickString(progress, "stage");
    if (stage === "baseline") {
      onWriteStreamEvent({
        kind: "started",
        sessionId: event.sessionId,
        turnId: event.turnId,
        toolCallId,
        toolName,
        filePath,
        timestamp: event.timestamp,
        ...(typeof progress.created === "boolean" ? { created: progress.created } : {}),
        ...(typeof progress.baselineContent === "string"
          ? { baselineContent: progress.baselineContent }
          : {}),
      });
    }
    const chunkText = pickRawString(progress, "chunkText");
    if (stage === "writing" && chunkText !== null) {
      onWriteStreamEvent({
        kind: "delta",
        sessionId: event.sessionId,
        turnId: event.turnId,
        toolCallId,
        toolName,
        filePath,
        timestamp: event.timestamp,
        chunkText,
        ...(pickNumber(progress, "bytesWritten") === null
          ? {}
          : { bytesWritten: pickNumber(progress, "bytesWritten")! }),
        ...(pickNumber(progress, "bytesTotal") === null
          ? {}
          : { bytesTotal: pickNumber(progress, "bytesTotal")! }),
        ...(pickNumber(progress, "progress") === null
          ? {}
          : { progress: pickNumber(progress, "progress")! }),
      });
    }
  }
  if (event.phase === "tool_finished") {
    const status = pickString(payload, "status") === "failed" ? "failed" : "completed";
    const errorObject = isRecord(payload.error) ? payload.error : null;
    onWriteStreamEvent({
      kind: "finished",
      sessionId: event.sessionId,
      turnId: event.turnId,
      toolCallId,
      toolName,
      filePath,
      timestamp: event.timestamp,
      status,
      ...(output !== null && typeof output.created === "boolean"
        ? { created: output.created }
        : {}),
      ...(output !== null && typeof output.baselineContent === "string"
        ? { baselineContent: output.baselineContent }
        : {}),
      ...(output !== null && pickNumber(output, "firstChangedLine") !== null
        ? { firstChangedLine: pickNumber(output, "firstChangedLine")! }
        : {}),
      ...(output !== null && pickNumber(output, "addedLines") !== null
        ? { addedLines: pickNumber(output, "addedLines")! }
        : {}),
      ...(output !== null && pickNumber(output, "removedLines") !== null
        ? { removedLines: pickNumber(output, "removedLines")! }
        : {}),
      ...(errorObject !== null && typeof errorObject.code === "string"
        ? { errorCode: errorObject.code }
        : {}),
      ...(errorObject !== null && typeof errorObject.message === "string"
        ? { errorMessage: errorObject.message }
        : {}),
    });
  }
};

export const handleTerminalExecStarted = ({
  event,
  payload,
  onTerminalExecStarted,
}: RuntimeEventProcessingContext): void => {
  if (event.phase !== "tool_started") {
    return;
  }
  const toolName = pickString(payload, "toolName");
  if (toolName !== "terminal.exec") {
    return;
  }
  const input = isRecord(payload.input) ? payload.input : null;
  const command = input !== null ? (pickString(input, "command") ?? "") : "";
  const cwd = input !== null ? (pickString(input, "cwd") || undefined) : undefined;
  const toolCallId = pickString(payload, "toolCallId") ?? "";
  if (onTerminalExecStarted !== undefined && command.length > 0) {
    onTerminalExecStarted(command, cwd, toolCallId, event.turnId, event.sessionId);
  }
};

export const handleRuntimeFeed = ({
  event,
  payload,
  progress,
  toolNameLabels,
  runtimeToolFallbackLabel,
  setRuntimeFeed,
  openRuntimeTargetPath,
  followEnabled = false,
}: RuntimeEventProcessingContext): void => {
  const feedItem = toRuntimeFeedItem(event, toolNameLabels, runtimeToolFallbackLabel);
  if (feedItem === null) {
    return;
  }
  const isTerminal = isTerminalToolName(feedItem.toolName);
  const outputPayload = isRecord(payload.output) ? payload.output : null;
  const terminalOutput = isTerminal && progress !== null
    ? (pickRawString(progress, "stdoutChunk") ?? "")
    : isTerminal && outputPayload !== null && pickString(outputPayload, "kind") === "read"
      ? (pickRawString(outputPayload, "output") ?? "")
      : null;
  const terminalError = isTerminal && progress !== null
    ? (pickRawString(progress, "stderrChunk") ?? "")
    : null;

  setRuntimeFeed((current) => {
    const existingIndex = current.findIndex((item) => item.id === feedItem.id);
    if (existingIndex === -1) {
      return [...current, feedItem].slice(-RUNTIME_FEED_ITEM_LIMIT);
    }
    const next = [...current];
    const previous = next[existingIndex];
    if (previous === undefined) {
      return [...current, feedItem].slice(-RUNTIME_FEED_ITEM_LIMIT);
    }
    const accumulatedOutput = isTerminal && (terminalOutput !== null || terminalError !== null)
      ? `${previous.liveOutput ?? ""}${terminalOutput ?? ""}${terminalError !== null && terminalError.length > 0 ? terminalError : ""}`
      : previous.liveOutput;

    next[existingIndex] = {
      ...previous,
      ...feedItem,
      target: feedItem.target.length > 0 ? feedItem.target : previous.target,
      ...(feedItem.openPath !== undefined || previous.openPath !== undefined
        ? { openPath: feedItem.openPath ?? previous.openPath }
        : {}),
      ...(accumulatedOutput !== undefined && accumulatedOutput.length > 0
        ? { liveOutput: accumulatedOutput }
        : {}),
    };
    return next;
  });
  if (
    followEnabled &&
    feedItem.autoOpen === true &&
    typeof feedItem.openPath === "string" &&
    feedItem.openPath.trim().length > 0
  ) {
    const location =
      feedItem.firstChangedLine === undefined
        ? undefined
        : ({ line: feedItem.firstChangedLine } as FileEditorRevealLocation);
    void openRuntimeTargetPath(feedItem.openPath, {
      allowMissing: event.phase !== "tool_finished",
      forceReloadIfOpen:
        event.phase === "tool_progress" || feedItem.status === "completed",
      ...(location === undefined ? {} : { location }),
    });
  }
};
