import { useEffect, useMemo, useRef, useState } from "react";

import type { DiffHunk } from "../../core/types";

/** Matches `.lyra-agents-diff-line` single-line row height in agents.scss. */
export const DIFF_LINE_HEIGHT_PX = 20;
/** Max viewport before inner scroll; mirrors diff-stats pill body cap. */
export const DIFF_VIEWPORT_MAX_HEIGHT_PX = 220;
const OVERSCAN_LINES = 10;

type FlatDiffLine = {
  readonly key: string;
  readonly lineNumber: number;
  readonly kind: "add" | "del" | "ctx";
  readonly text: string;
};

export const flattenDiffHunks = (hunks: readonly DiffHunk[]): FlatDiffLine[] => {
  const lines: FlatDiffLine[] = [];
  for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex += 1) {
    const hunk = hunks[hunkIndex]!;
    for (let lineIndex = 0; lineIndex < hunk.lines.length; lineIndex += 1) {
      const line = hunk.lines[lineIndex]!;
      lines.push({
        key: `${hunkIndex}:${lineIndex}`,
        lineNumber: hunk.startLine + lineIndex,
        kind: line.kind,
        text: line.text
      });
    }
  }
  return lines;
};

export const diffVisibleLineRange = (
  scrollTop: number,
  viewportHeight: number,
  lineCount: number,
  overscan = OVERSCAN_LINES
): { readonly start: number; readonly end: number } => {
  if (lineCount <= 0) {
    return { start: 0, end: -1 };
  }
  const start = Math.max(0, Math.floor(scrollTop / DIFF_LINE_HEIGHT_PX) - overscan);
  const end = Math.min(
    lineCount - 1,
    Math.ceil((scrollTop + viewportHeight) / DIFF_LINE_HEIGHT_PX) + overscan
  );
  return { start, end };
};

export function VirtualizedDiffView({
  hunks,
  running = false,
  className = ""
}: {
  readonly hunks: readonly DiffHunk[];
  readonly running?: boolean;
  readonly className?: string;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const lines = useMemo(() => flattenDiffHunks(hunks), [hunks]);
  const longestLineText = useMemo(
    () => lines.reduce((longest, line) => (line.text.length > longest.length ? line.text : longest), ""),
    [lines]
  );
  const contentHeight = lines.length * DIFF_LINE_HEIGHT_PX;
  const viewportHeight = Math.min(contentHeight, DIFF_VIEWPORT_MAX_HEIGHT_PX);
  const { start, end } = diffVisibleLineRange(scrollTop, viewportHeight, lines.length);
  const shouldVirtualize = lines.length > OVERSCAN_LINES * 2 + 4;

  useEffect(() => {
    if (!running) return;
    const viewport = viewportRef.current;
    if (viewport === null) return;
    viewport.scrollTop = viewport.scrollHeight;
    setScrollTop(viewport.scrollTop);
  }, [lines.length, running]);

  if (lines.length === 0) {
    return null;
  }

  const visibleLines = shouldVirtualize ? lines.slice(start, end + 1) : lines;
  const topSpacer = shouldVirtualize ? start * DIFF_LINE_HEIGHT_PX : 0;
  const bottomSpacer = shouldVirtualize
    ? Math.max(0, contentHeight - topSpacer - visibleLines.length * DIFF_LINE_HEIGHT_PX)
    : 0;

  return (
    <div
      ref={viewportRef}
      className={["lyra-agents-diff-viewport", className].filter(Boolean).join(" ")}
      style={{ maxHeight: DIFF_VIEWPORT_MAX_HEIGHT_PX }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="lyra-agents-diff-viewport-track" style={{ minHeight: contentHeight }}>
        <div className="lyra-agents-diff-width-probe" aria-hidden>
          <div className="lyra-agents-diff-line lyra-agents-diff-line-ctx">
            <span className="lyra-agents-diff-gutter">00000</span>
            <span className="lyra-agents-diff-sign">+</span>
            <span className="lyra-agents-diff-text">{longestLineText || "\u00A0"}</span>
          </div>
        </div>
        {topSpacer > 0 ? <div style={{ height: topSpacer }} aria-hidden /> : null}
        {visibleLines.map((line) => (
          <div
            key={line.key}
            className={`lyra-agents-diff-line lyra-agents-diff-line-${line.kind}`}
          >
            <span className="lyra-agents-diff-gutter">{line.lineNumber}</span>
            <span className="lyra-agents-diff-sign">
              {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
            </span>
            <span className="lyra-agents-diff-text">{line.text || "\u00A0"}</span>
          </div>
        ))}
        {bottomSpacer > 0 ? <div style={{ height: bottomSpacer }} aria-hidden /> : null}
      </div>
    </div>
  );
}