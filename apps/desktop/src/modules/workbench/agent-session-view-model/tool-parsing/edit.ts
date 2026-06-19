import type { AgentToolActivity } from "../../../../shared/agent";
import type { ToolDetails } from "../../ai-panel/lyra-agents/core/types";
import {
  asRecord,
  stringField,
  toolArgsRecord,
  toolFsPath,
  toolInputRecord,
  toolOutputText
} from "./common";
import { parseUnifiedDiff } from "./diff";

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

const editFilePathFromTool = (tool: AgentToolActivity): string => {
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
    ?? "Edited file";
};

export const toEditDetails = (tool: AgentToolActivity): ToolDetails => {
  const file = editFilePathFromTool(tool);
  const diffText = diffTextFromTool(tool);
  if (diffText !== null) {
    const parsed = parseUnifiedDiff(diffText);
    if (parsed.hunks.length > 0) {
      return {
        type: "edit",
        file,
        additions: parsed.additions,
        deletions: parsed.deletions,
        hunks: parsed.hunks
      };
    }
  }
  return {
    type: "edit",
    file,
    additions: 0,
    deletions: 0,
    hunks: []
  };
};