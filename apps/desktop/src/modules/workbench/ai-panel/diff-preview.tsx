import type { AgentPatchChangedFile } from "./agent-ui-types";

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
