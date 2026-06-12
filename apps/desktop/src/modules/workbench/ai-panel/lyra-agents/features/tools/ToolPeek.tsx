import type { ToolPeek } from "../../core/types";
import { imagePreviewSourceFromSource } from "../rich-text/ActionTargets";

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
  const thumbnailSrc = peek.thumbnail === undefined
    ? undefined
    : imagePreviewSourceFromSource(peek.thumbnail.src);

  return (
    <span className={`lyra-agents-tool-peek ${className}`.trim()}>
      {peek.thumbnail !== undefined && thumbnailSrc !== undefined ? (
        <img
          src={thumbnailSrc}
          alt={peek.thumbnail.alt}
          className="lyra-agents-tool-peek-thumb"
        />
      ) : null}
      {peek.chips.map((chip) => (
        <span key={chip} className="lyra-agents-tool-peek-chip">
          {chip}
        </span>
      ))}
      {peek.excerpt !== undefined ? (
        <span className="lyra-agents-tool-peek-excerpt" title={peek.excerpt}>
          {peek.excerpt}
        </span>
      ) : null}
    </span>
  );
}
