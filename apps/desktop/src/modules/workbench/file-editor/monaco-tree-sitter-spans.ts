import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

import type { HighlightSpan } from "../../../shared/render";
import { scopeToInlineClassName } from "./monaco-tree-sitter-theme";

export const byteOffsetToCharOffset = (source: string, byteOffset: number): number => {
  const bytes = new TextEncoder().encode(source);
  const clamped = Math.max(0, Math.min(byteOffset, bytes.length));
  if (clamped === 0) {
    return 0;
  }
  return new TextDecoder().decode(bytes.subarray(0, clamped)).length;
};

export const spanToRange = (
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  source: string,
  span: HighlightSpan
): Monaco.IRange | null => {
  const start = byteOffsetToCharOffset(source, span.start);
  const end = byteOffsetToCharOffset(source, span.end);
  if (start >= end) {
    return null;
  }

  const startPosition = model.getPositionAt(start);
  const endPosition = model.getPositionAt(end);
  return new monaco.Range(
    startPosition.lineNumber,
    startPosition.column,
    endPosition.lineNumber,
    endPosition.column
  );
};

export const spansToDecorations = (
  monaco: typeof Monaco,
  model: Monaco.editor.ITextModel,
  source: string,
  spans: readonly HighlightSpan[]
): Monaco.editor.IModelDeltaDecoration[] => {
  if (spans.length === 0) {
    return [];
  }

  const sorted = [...spans].sort(
    (left, right) => left.start - right.start || left.end - right.end
  );
  const decorations: Monaco.editor.IModelDeltaDecoration[] = [];

  for (const span of sorted) {
    const range = spanToRange(monaco, model, source, span);
    if (range === null) {
      continue;
    }
    decorations.push({
      range,
      options: {
        inlineClassName: scopeToInlineClassName(span.scope),
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    });
  }

  return decorations;
};