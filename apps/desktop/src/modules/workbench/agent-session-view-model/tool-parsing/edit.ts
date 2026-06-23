import type { AgentToolActivity } from "../../../../shared/agent";
import type { ToolDetails } from "../../ai-panel/lyra-agents/core/types";
import {
  asRecord,
  numberField,
  stringField,
  toolArgsRecord,
  toolFsPath,
  toolInputRecord,
  toolOutputText
} from "./common";
import { parseUnifiedDiff, reconstructContentAfterDiff } from "./diff";

const EDIT_TOOL_PATH_MARKERS = [
  "/tools/filesystem/write_file",
  "/tools/filesystem/edit_file",
  "/tools/filesystem/strict_edit",
  "/tools/filesystem/multi_edit",
  "/tools/filesystem/apply_patch",
  // Streaming-preview activities are emitted under /tools/runtime/* with the
  // model tool name; keep them in sync with the executed file family so the
  // live preview and the final result render as one edit card.
  "/tools/runtime/write_file",
  "/tools/runtime/edit_file",
  "/tools/runtime/apply_patch"
] as const;

const diffPathFromUnifiedDiff = (diffText: string | null): string | null => {
  if (diffText === null) return null;
  let fallback: string | null = null;
  for (const line of diffText.replace(/\r\n/g, "\n").split("\n")) {
    if (line.startsWith("@@")) break;
    if (!line.startsWith("+++ ") && !line.startsWith("--- ")) continue;
    const rawPath = line.slice(4).trim();
    if (rawPath.length === 0 || rawPath === "/dev/null") continue;
    const path = rawPath.startsWith("a/") || rawPath.startsWith("b/") ? rawPath.slice(2) : rawPath;
    if (line.startsWith("+++ ")) return path;
    fallback = path;
  }
  return fallback;
};

const diffTextFromTool = (tool: AgentToolActivity): string | null => {
  const output = asRecord(tool.output);
  const rawOutput = asRecord(output.raw);
  const diff = stringField(rawOutput, "diff");
  if (diff !== undefined && diff.trim().length > 0) {
    return diff;
  }
  const changes = tool.changes ?? output.changes;
  if (Array.isArray(changes) && changes.length > 0) {
    const firstChange = asRecord(changes[0]);
    const diffRef = asRecord(firstChange.diffRef);
    const preview = stringField(diffRef, "preview");
    if (preview !== undefined && preview.trim().length > 0) {
      return preview;
    }
  }
  const body = toolOutputText(tool);
  if (body.includes("@@") && (body.includes("\n+") || body.includes("\n-"))) {
    const marker = body.indexOf("--- ");
    return marker >= 0 ? body.slice(marker) : body;
  }
  return null;
};

const editStatsFromRecord = (
  value: unknown
): { readonly additions: number; readonly deletions: number } | null => {
  const record = asRecord(value);
  const additions = numberField(record, "additions", "addedLines", "adds");
  const deletions = numberField(record, "deletions", "deletedLines", "removes");
  return additions === undefined || deletions === undefined ? null : { additions, deletions };
};

const editStatsFromTool = (
  tool: AgentToolActivity
): { readonly additions: number; readonly deletions: number } | null => {
  const output = asRecord(tool.output);
  const rawOutput = asRecord(output.raw);
  const changedFiles = rawOutput.changedFiles;
  if (Array.isArray(changedFiles) && changedFiles.length > 0) {
    const stats = editStatsFromRecord(changedFiles[0]);
    if (stats !== null) return stats;
  }

  const changes = tool.changes ?? output.changes;
  if (Array.isArray(changes) && changes.length > 0) {
    const firstChange = asRecord(changes[0]);
    return editStatsFromRecord(firstChange.detail);
  }
  return null;
};

export const editFilePathFromTool = (tool: AgentToolActivity): string => {
  const output = asRecord(tool.output);
  const rawOutput = asRecord(output.raw);
  const changedFiles = rawOutput.changedFiles;
  if (Array.isArray(changedFiles) && changedFiles.length > 0) {
    const first = asRecord(changedFiles[0]);
    const path = stringField(first, "path");
    if (path !== undefined) return path;
  }
  const args = toolArgsRecord(tool);
  const input = toolInputRecord(tool);
  const nestedArgs = asRecord(args.args ?? input.args);
  return stringField(nestedArgs, "path")
    ?? stringField(args, "path")
    ?? stringField(input, "path")
    ?? toolFsPath(tool)
    ?? diffPathFromUnifiedDiff(diffTextFromTool(tool))
    ?? "Edited file";
};

export const isEditToolActivity = (tool: AgentToolActivity): boolean => {
  const hint = (tool.activityKind ?? tool.rendererHint ?? "").trim().toLowerCase();
  if (hint === "edit") return true;
  if (tool.name === "apply_patch" || tool.name === "edit_file" || tool.name === "write_file") return true;
  const rawOutput = asRecord(asRecord(tool.output).raw);
  if (
    stringField(rawOutput, "activityKind") === "edit" ||
    stringField(rawOutput, "rendererHint") === "edit"
  ) {
    return true;
  }
  const toolPath = (toolFsPath(tool) ?? stringField(toolArgsRecord(tool), "path") ?? "").toLowerCase();
  return EDIT_TOOL_PATH_MARKERS.some((marker) => toolPath.includes(marker));
};

export const previewContentFromEditTool = (
  tool: AgentToolActivity,
  before = ""
): string | null => {
  const diffText = diffTextFromTool(tool);
  if (diffText === null) return null;
  const parsed = parseUnifiedDiff(diffText);
  if (parsed.hunks.length === 0) return null;
  return reconstructContentAfterDiff(before, parsed.hunks);
};

export const firstEditHunkLine = (tool: AgentToolActivity): number | undefined => {
  const diffText = diffTextFromTool(tool);
  if (diffText === null) return undefined;
  const parsed = parseUnifiedDiff(diffText);
  const firstHunk = parsed.hunks[0];
  if (firstHunk === undefined) return undefined;
  const firstChange = firstHunk.lines.find((line) => line.kind === "add" || line.kind === "del");
  if (firstChange === undefined) return firstHunk.startLine;
  const offset = firstHunk.lines.indexOf(firstChange);
  return firstHunk.startLine + offset;
};

export const toEditDetails = (tool: AgentToolActivity): ToolDetails => {
  const file = editFilePathFromTool(tool);
  const structuredStats = editStatsFromTool(tool);
  const diffText = diffTextFromTool(tool);
  if (diffText !== null) {
    const parsed = parseUnifiedDiff(diffText);
    if (parsed.hunks.length > 0) {
      return {
        type: "edit",
        file,
        additions: structuredStats?.additions ?? parsed.additions,
        deletions: structuredStats?.deletions ?? parsed.deletions,
        hunks: parsed.hunks
      };
    }
  }
  return {
    type: "edit",
    file,
    additions: structuredStats?.additions ?? 0,
    deletions: structuredStats?.deletions ?? 0,
    hunks: []
  };
};
