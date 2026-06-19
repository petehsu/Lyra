import type { ReactNode } from "react";

import type { HighlightSpan } from "../../../../../../shared/render";
import { scopeToHighlightClass } from "./scope-theme";

export const renderHighlightedCode = (
  source: string,
  spans: readonly HighlightSpan[]
): ReactNode => {
  if (spans.length === 0) {
    return source;
  }

  const sorted = [...spans].sort(
    (left, right) => left.start - right.start || left.end - right.end
  );
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const span of sorted) {
    const start = Math.max(0, Math.min(span.start, source.length));
    const end = Math.max(start, Math.min(span.end, source.length));
    if (start > cursor) {
      parts.push(source.slice(cursor, start));
    }
    if (end > start) {
      parts.push(
        <span
          key={`${start}-${end}-${span.scope}`}
          className={scopeToHighlightClass(span.scope)}
        >
          {source.slice(start, end)}
        </span>
      );
    }
    cursor = Math.max(cursor, end);
  }

  if (cursor < source.length) {
    parts.push(source.slice(cursor));
  }

  return parts;
};