import type { AgentPatchChangedFile, AgentRuntimeEvent } from "./agent-ui-types";
import { isRecord, readString } from "./patch-artifact";

type DiffPreviewProps = {
  readonly content: string;
  readonly changedFiles: readonly AgentPatchChangedFile[];
};

type DiffLineKind = "file" | "hunk" | "add" | "delete" | "context" | "meta";

type DiffLine = {
  readonly id: string;
  readonly kind: DiffLineKind;
  readonly oldLine: number | null;
  readonly newLine: number | null;
  readonly marker: string;
  readonly text: string;
};

const hunkPattern = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/u;

const parseDiffLines = (content: string): readonly DiffLine[] => {
  const lines = content.split(/\r?\n/u);
  let oldLine: number | null = null;
  let newLine: number | null = null;
  return lines.map((line, index): DiffLine => {
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      return {
        id: `${String(index)}:file`,
        kind: "file",
        oldLine: null,
        newLine: null,
        marker: line.slice(0, 3),
        text: line.slice(4),
      };
    }
    if (line.startsWith("@@")) {
      const match = hunkPattern.exec(line);
      oldLine = match?.[1] === undefined ? null : Number.parseInt(match[1], 10);
      newLine = match?.[2] === undefined ? null : Number.parseInt(match[2], 10);
      return {
        id: `${String(index)}:hunk`,
        kind: "hunk",
        oldLine: null,
        newLine: null,
        marker: "@@",
        text: line,
      };
    }
    if (line.startsWith("+")) {
      const currentNewLine = newLine;
      if (newLine !== null) {
        newLine += 1;
      }
      return {
        id: `${String(index)}:add`,
        kind: "add",
        oldLine: null,
        newLine: currentNewLine,
        marker: "+",
        text: line.slice(1),
      };
    }
    if (line.startsWith("-")) {
      const currentOldLine = oldLine;
      if (oldLine !== null) {
        oldLine += 1;
      }
      return {
        id: `${String(index)}:delete`,
        kind: "delete",
        oldLine: currentOldLine,
        newLine: null,
        marker: "-",
        text: line.slice(1),
      };
    }
    if (line.startsWith(" ")) {
      const currentOldLine = oldLine;
      const currentNewLine = newLine;
      if (oldLine !== null) {
        oldLine += 1;
      }
      if (newLine !== null) {
        newLine += 1;
      }
      return {
        id: `${String(index)}:context`,
        kind: "context",
        oldLine: currentOldLine,
        newLine: currentNewLine,
        marker: " ",
        text: line.slice(1),
      };
    }
    return {
      id: `${String(index)}:meta`,
      kind: "meta",
      oldLine: null,
      newLine: null,
      marker: "",
      text: line,
    };
  });
};

const changeTypeLabel = (value: string): string => {
  switch (value) {
    case "created":
      return "created";
    case "deleted":
      return "deleted";
    case "modified":
      return "modified";
    default:
      return value;
  }
};

export const DiffPreview = ({ content, changedFiles }: DiffPreviewProps) => {
  const lines = parseDiffLines(content);
  return (
    <div className="lyra-ai-patch-diff-preview">
      {changedFiles.length === 0 ? null : (
        <div className="lyra-ai-patch-diff-files" aria-label="Changed files">
          {changedFiles.map((file) => (
            <span key={file.path} className="lyra-ai-patch-diff-file-chip">
              <span>{file.path}</span>
              <small>{changeTypeLabel(file.changeType)} · +{file.additions} -{file.deletions}</small>
            </span>
          ))}
        </div>
      )}
      <div className="lyra-ai-patch-diff-code" role="table" aria-label="Unified diff preview">
        {lines.map((line) => (
          <div
            key={line.id}
            className={`lyra-ai-patch-diff-line lyra-ai-patch-diff-line-${line.kind}`}
            role="row"
          >
            <span className="lyra-ai-patch-diff-line-number" role="cell">
              {line.oldLine ?? ""}
            </span>
            <span className="lyra-ai-patch-diff-line-number" role="cell">
              {line.newLine ?? ""}
            </span>
            <span className="lyra-ai-patch-diff-marker" role="cell">
              {line.marker}
            </span>
            <code className="lyra-ai-patch-diff-text" role="cell">
              {line.text.length === 0 ? " " : line.text}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
};

type LiveDiffPreviewProps = {
  readonly events: readonly AgentRuntimeEvent[];
};

type LiveDiffRow = {
  readonly id: string;
  readonly filePath: string;
  readonly finalized: boolean;
  readonly changedFiles: readonly AgentPatchChangedFile[];
};

export const LiveDiffPreview = ({ events }: LiveDiffPreviewProps) => {
  const rows = liveDiffRows(events);
  if (rows.length === 0) {
    return null;
  }
  return (
    <section className="lyra-ai-patch-diff-preview" aria-label="Live diff preview">
      <div className="lyra-ai-patch-diff-files" aria-label="Live changed files">
        {rows.map((row) => (
          <span key={row.id} className="lyra-ai-patch-diff-file-chip" data-status={row.finalized ? "finalized" : "streaming"}>
            <span>{row.filePath}</span>
            <small>{row.finalized ? "finalized" : "editing"}{changeCountLabel(row.changedFiles)}</small>
          </span>
        ))}
      </div>
    </section>
  );
};

const liveDiffRows = (events: readonly AgentRuntimeEvent[]): readonly LiveDiffRow[] => {
  const finalized = new Set(
    events
      .filter((event) => event.phase === "follow_live_edit_finalized")
      .map((event) => readStringFromPayload(event.payload, "filePath"))
      .filter((filePath): filePath is string => filePath !== null)
  );
  return events
    .filter((event) => event.phase === "follow_live_edit_delta")
    .map((event, index): LiveDiffRow | null => {
      const filePath = readStringFromPayload(event.payload, "filePath");
      if (filePath === null) {
        return null;
      }
      return {
        id: `live-diff:${String(index)}:${filePath}`,
        filePath,
        finalized: finalized.has(filePath),
        changedFiles: changedFilesFromPayload(event.payload),
      };
    })
    .filter((row): row is LiveDiffRow => row !== null)
    .slice(-4);
};

const readStringFromPayload = (payload: unknown, key: string): string | null =>
  isRecord(payload) ? readString(payload[key]) : null;

const changedFilesFromPayload = (payload: unknown): readonly AgentPatchChangedFile[] => {
  if (!isRecord(payload) || !Array.isArray(payload.diffHunks)) {
    return [];
  }
  return payload.diffHunks
    .map((value): AgentPatchChangedFile | null => {
      if (!isRecord(value)) {
        return null;
      }
      const path = readString(value.path);
      if (path === null) {
        return null;
      }
      return {
        path,
        changeType: readString(value.changeType) ?? "modified",
        additions: typeof value.additions === "number" ? value.additions : 0,
        deletions: typeof value.deletions === "number" ? value.deletions : 0,
      };
    })
    .filter((file): file is AgentPatchChangedFile => file !== null);
};

const changeCountLabel = (files: readonly AgentPatchChangedFile[]): string => {
  if (files.length === 0) {
    return "";
  }
  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  return ` · +${String(additions)} -${String(deletions)}`;
};
