import type { DiffHunk, DiffLine } from "../../ai-panel/lyra-agents/core/types";

export type ParsedUnifiedDiff = {
  readonly hunks: DiffHunk[];
  readonly additions: number;
  readonly deletions: number;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

const countLineStats = (hunks: readonly DiffHunk[]): { additions: number; deletions: number } => {
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") additions += 1;
      if (line.kind === "del") deletions += 1;
    }
  }
  return { additions, deletions };
};

export const parseUnifiedDiff = (text: string): ParsedUnifiedDiff => {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) {
    return { hunks: [], additions: 0, deletions: 0 };
  }

  const lines = normalized.split("\n");
  let start = 0;
  while (start < lines.length) {
    const line = lines[start]?.trim() ?? "";
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("diff ")) {
      start += 1;
      continue;
    }
    break;
  }

  const hunks: DiffHunk[] = [];
  let currentHunk: DiffHunk | null = null;

  for (let index = start; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const trimmed = rawLine.trimEnd();
    if (trimmed.startsWith("\\ No newline at end of file")) {
      continue;
    }

    const headerMatch = trimmed.match(HUNK_HEADER);
    if (headerMatch !== null) {
      const startLine = Number.parseInt(headerMatch[2] ?? "1", 10);
      currentHunk = { startLine: Number.isFinite(startLine) ? startLine : 1, lines: [] };
      hunks.push(currentHunk);
      continue;
    }

    if (currentHunk === null) {
      continue;
    }

    const prefix = trimmed.charAt(0);
    const body = trimmed.slice(1);
    let kind: DiffLine["kind"] = "ctx";
    if (prefix === "+") kind = "add";
    if (prefix === "-") kind = "del";
    if (prefix === " " || prefix === "+" || prefix === "-") {
      currentHunk.lines.push({ kind, text: body });
    }
  }

  const stats = countLineStats(hunks);
  return {
    hunks,
    additions: stats.additions,
    deletions: stats.deletions
  };
};

/** Reconstruct post-edit file text by applying parsed hunks onto a before snapshot. */
export const reconstructContentAfterDiff = (
  before: string,
  hunks: readonly DiffHunk[]
): string => {
  const lines = before.length === 0 ? [] : before.replace(/\r\n/g, "\n").split("\n");
  for (const hunk of hunks) {
    let cursor = Math.max(0, hunk.startLine - 1);
    for (const line of hunk.lines) {
      if (line.kind === "ctx") {
        if (cursor >= lines.length) {
          lines.push(line.text);
        } else {
          lines[cursor] = line.text;
        }
        cursor += 1;
        continue;
      }
      if (line.kind === "del") {
        if (cursor < lines.length) {
          lines.splice(cursor, 1);
        }
        continue;
      }
      lines.splice(cursor, 0, line.text);
      cursor += 1;
    }
  }
  return lines.join("\n");
};