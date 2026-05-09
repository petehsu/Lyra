import { useEffect, useRef } from "react";

import type {
  AgentFollowTargetSummary,
  AgentRuntimeEvent,
  AgentSessionDetail,
} from "./agent-ui-types";
import type {
  AiPanelFollowOpenFileLocation,
  AiPanelFollowOpenFilePath,
} from "./types";
import {
  extractChangedFiles,
  isRecord,
  readNumber,
  readString,
} from "./patch-artifact";

type UseAgentWorkspaceFollowParams = {
  readonly enabled: boolean;
  readonly detail: AgentSessionDetail | null;
  readonly workspaceRoot: string | null;
  readonly onOpenFilePath?: AiPanelFollowOpenFilePath | undefined;
};

type WorkspaceFollowTarget = {
  readonly key: string;
  readonly path: string;
  readonly location?: AiPanelFollowOpenFileLocation;
  readonly allowMissing?: boolean;
};

export const useAgentWorkspaceFollow = ({
  enabled,
  detail,
  workspaceRoot,
  onOpenFilePath,
}: UseAgentWorkspaceFollowParams): void => {
  const lastOpenedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || onOpenFilePath === undefined) {
      lastOpenedKeyRef.current = null;
      return;
    }
    const target = latestWorkspaceFollowTarget(detail);
    if (target === null || target.key === lastOpenedKeyRef.current) {
      return;
    }
    const resolvedPath = resolveFollowWorkspaceUri(target.path, workspaceRoot);
    if (!isOpenableFollowPath(target.path, resolvedPath, workspaceRoot)) {
      return;
    }
    lastOpenedKeyRef.current = target.key;
    onOpenFilePath(
      resolvedPath,
      target.location,
      {
        forceReloadIfOpen: true,
        ...(target.allowMissing === true ? { allowMissing: true } : {}),
      }
    );
  }, [detail, enabled, onOpenFilePath, workspaceRoot]);
};

export const latestWorkspaceFollowTarget = (
  detail: AgentSessionDetail | null
): WorkspaceFollowTarget | null => {
  if (detail === null) {
    return null;
  }
  for (const event of [...detail.runtimeEvents].reverse()) {
    const target = targetFromRuntimeEvent(event);
    if (target !== null) {
      return target;
    }
  }
  return targetFromFollowSummary(detail);
};

export const resolveFollowWorkspaceUri = (workspaceUri: string, workspaceRoot: string | null): string => {
  const trimmed = workspaceUri.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  if (trimmed.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return trimmed;
    }
  }
  const root = workspaceRoot?.trim() ?? "";
  if (root.length === 0 || isAbsolutePath(trimmed)) {
    return trimmed;
  }
  return `${root.replace(/[\\/]+$/, "")}/${trimmed.replace(/^[\\/]+/, "")}`;
};

const targetFromRuntimeEvent = (event: AgentRuntimeEvent): WorkspaceFollowTarget | null => {
  if (event.phase === "follow_projection_updated") {
    return targetFromProjectionEvent(event);
  }
  if (
    event.phase !== "tool_operation_started"
    && event.phase !== "tool_operation_completed"
    && event.phase !== "tool_operation_failed"
  ) {
    return null;
  }
  const payload = isRecord(event.payload) ? event.payload : {};
  const operation = isRecord(payload.operation) ? payload.operation : {};
  const result = isRecord(payload.result) ? payload.result : {};
  const toolPath = readToolPath(operation, payload, result);
  if (!isFollowFileTool(toolPath)) {
    return null;
  }
  const paths = pathsFromToolOperation(operation, result);
  const path = paths.find(isCandidateFollowPath) ?? null;
  if (path === null) {
    return null;
  }
  const location = readLocation(operation, result);
  return {
    key: [
      event.sessionId,
      event.turnId,
      event.phase,
      toolPath,
      path,
      String(event.timestamp),
    ].join(":"),
    path,
    ...(location === undefined ? {} : { location }),
    ...(event.phase === "tool_operation_started" && isWriteFileTool(toolPath)
      ? { allowMissing: true }
      : {}),
  };
};

const targetFromProjectionEvent = (event: AgentRuntimeEvent): WorkspaceFollowTarget | null => {
  const payload = isRecord(event.payload) ? event.payload : {};
  const operations = Array.isArray(payload.operations) ? payload.operations : [];
  for (const [index, value] of [...operations].reverse().entries()) {
    if (!isRecord(value)) {
      continue;
    }
    const toolPath = readString(value.toolPath) ?? readString(value.toolName);
    if (!isFollowFileTool(toolPath)) {
      continue;
    }
    const path = readString(value.filePath);
    if (path === null) {
      continue;
    }
    if (!isCandidateFollowPath(path)) {
      continue;
    }
    const status = readString(value.status);
    return {
      key: [
        event.sessionId,
        event.turnId,
        "follow_projection_updated",
        toolPath,
        path,
        String(readNumber(value.startedAt) ?? readString(value.startedAt) ?? event.timestamp),
        String(readNumber(value.finishedAt) ?? readString(value.finishedAt) ?? ""),
        String(index),
      ].join(":"),
      path,
      ...(status !== null && (status === "running" || status === "active") && isWriteFileTool(toolPath)
        ? { allowMissing: true }
        : {}),
    };
  }
  return null;
};

const targetFromFollowSummary = (detail: AgentSessionDetail): WorkspaceFollowTarget | null => {
  const summary = detail.followSummary ?? null;
  const target = summary?.activeTarget ?? summary?.targets[0] ?? null;
  if (target === null || !isConcreteFileTarget(target)) {
    return null;
  }
  const path = readString(target.workspaceUri) ?? readPathLikeString(target.resourceRef);
  if (path === null) {
    return null;
  }
  if (!isCandidateFollowPath(path)) {
    return null;
  }
  return {
    key: [
      detail.session.id,
      summary?.runtimeTurnId ?? "",
      target.followTargetId,
      target.toolOperationId ?? "",
      path,
      String(target.updatedAt),
    ].join(":"),
    path,
  };
};

const pathsFromToolOperation = (
  operation: Record<string, unknown>,
  result: Record<string, unknown>
): readonly string[] => {
  const args = isRecord(operation.args) ? operation.args : {};
  const directPaths = [
    readString(args.path),
    readString(args.filePath),
    readString(args.workspaceUri),
    readString(args.toPath),
    readString(result.workspaceUri),
    readString(result.filePath),
    readPathLikeString(result.path),
  ].filter((path): path is string => path !== null);
  const changedFiles = extractChangedFiles(result.changedFiles).map((file) => file.path);
  return [...directPaths, ...changedFiles].filter(uniqueStrings);
};

const readToolPath = (
  operation: Record<string, unknown>,
  payload: Record<string, unknown>,
  result: Record<string, unknown>
): string | null =>
  readString(operation.toolPath)
  ?? readString(operation.path)
  ?? readString(payload.toolPath)
  ?? readString(payload.path)
  ?? readString(result.toolPath);

const readLocation = (
  operation: Record<string, unknown>,
  result: Record<string, unknown>
): AiPanelFollowOpenFileLocation | undefined => {
  const args = isRecord(operation.args) ? operation.args : {};
  const line = readNumber(args.line)
    ?? readNumber(args.startLine)
    ?? readNumber(result.line)
    ?? readNumber(result.startLine);
  if (line === null) {
    return undefined;
  }
  const column = readNumber(args.column) ?? readNumber(result.column);
  const endLine = readNumber(args.endLine) ?? readNumber(result.endLine);
  return {
    line,
    ...(column === null ? {} : { column }),
    ...(endLine === null ? {} : { endLine }),
  };
};

const isConcreteFileTarget = (target: AgentFollowTargetSummary): boolean =>
  target.kind === "file"
  || target.kind === "diff"
  || target.kind === "editor"
  || target.kind === "document";

const isFollowFileTool = (toolPath: string | null): boolean =>
  toolPath !== null && (isReadFileTool(toolPath) || isWriteFileTool(toolPath));

const isReadFileTool = (toolPath: string): boolean =>
  includesToolName(toolPath, [
    "read_file",
    "read_range",
    "read_text",
    "open_file",
  ]);

const isWriteFileTool = (toolPath: string | null): boolean =>
  toolPath !== null
  && includesToolName(toolPath, [
    "write_file",
    "edit_file",
    "replace_in_file",
    "create_file",
    "apply_patch",
    "propose_patch",
    "rollback_patch",
  ]);

const includesToolName = (toolPath: string, names: readonly string[]): boolean => {
  const normalized = toolPath.toLowerCase();
  return names.some((name) => normalized === name || normalized.endsWith(`/${name}`) || normalized.includes(`/${name}/`));
};

const readPathLikeString = (value: unknown): string | null => {
  const text = readString(value);
  if (text === null) {
    return null;
  }
  if (!isCandidateFollowPath(text)) {
    return null;
  }
  if (
    text.startsWith("file://")
    || isAbsolutePath(text)
    || text.includes("/")
    || text.includes("\\")
    || /(^|[/\\])[^/\\]+\.[^/\\.]+$/u.test(text)
  ) {
    return text;
  }
  return null;
};

const uniqueStrings = (value: string, index: number, values: readonly string[]): boolean =>
  values.indexOf(value) === index;

const isAbsolutePath = (value: string): boolean =>
  value.startsWith("/")
  || /^[A-Za-z]:[\\/]/.test(value)
  || value.startsWith("\\\\");

const isCandidateFollowPath = (value: string): boolean => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed === "/tools" || trimmed.startsWith("/tools/")) {
    return false;
  }
  const firstSegment = trimmed.split(/[\\/]/u)[0] ?? "";
  if (
    firstSegment.startsWith("tool_result_")
    || firstSegment.startsWith("artifact_")
    || firstSegment.startsWith("evidence_")
  ) {
    return false;
  }
  return !trimmed.split(/[\\/]/u).some((segment) => segment === ".." || segment.includes("\0"));
};

const isOpenableFollowPath = (
  originalPath: string,
  resolvedPath: string,
  workspaceRoot: string | null
): boolean => {
  if (!isCandidateFollowPath(originalPath) || !isCandidateFollowPath(resolvedPath)) {
    return false;
  }
  const root = workspaceRoot?.trim() ?? "";
  if (root.length === 0 || !isAbsolutePath(resolvedPath)) {
    return true;
  }
  const normalizedRoot = normalizePathForContainment(root);
  const normalizedPath = normalizePathForContainment(resolvedPath);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
};

const normalizePathForContainment = (value: string): string =>
  value.replace(/\\/g, "/").replace(/\/+$/u, "");
