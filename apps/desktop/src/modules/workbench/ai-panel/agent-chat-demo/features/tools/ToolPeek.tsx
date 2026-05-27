import type { ToolPeek } from "../../core/types";

export function ToolPeekStrip({
  peek,
  className = "",
}: {
  peek?: ToolPeek | undefined;
  className?: string;
}) {
  if (peek === undefined) return null;
  if (peek.chips.length === 0 && peek.excerpt === undefined && peek.thumbnail === undefined) {
    return null;
  }

  return (
    <span className={`tool-peek ${className}`.trim()}>
      {peek.thumbnail !== undefined ? (
        <img
          src={peek.thumbnail.src}
          alt={peek.thumbnail.alt}
          className="tool-peek-thumb"
        />
      ) : null}
      {peek.chips.map((chip) => (
        <span key={chip} className="tool-peek-chip">
          {chip}
        </span>
      ))}
      {peek.excerpt !== undefined ? (
        <span className="tool-peek-excerpt" title={peek.excerpt}>
          {peek.excerpt}
        </span>
      ) : null}
    </span>
  );
}
