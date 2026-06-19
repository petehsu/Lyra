import { useData } from "../../data/DataProvider";
import { useStreamText } from "../../hooks/useStreamText";
import { LyraDocument, PlainAgentText } from "./LyraDocument";

/**
 * Renders agent text during and after streaming.
 * Rich mode: live LyraDocument (debounced) with a cursor while tokens arrive.
 * Plain mode: typewriter text with a cursor, then static plain text when done.
 */
export function StreamingText({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}) {
  const { aiRichRenderingEnabled } = useData();
  const useTypewriter = streaming && !aiRichRenderingEnabled;
  const { text } = useStreamText(content, {
    speed: 3,
    interval: 25,
    enabled: useTypewriter,
  });

  if (!streaming) {
    if (aiRichRenderingEnabled) {
      return <LyraDocument content={content} />;
    }
    return <PlainAgentText content={content} />;
  }

  if (aiRichRenderingEnabled) {
    return (
      <div className="lyra-agents-streaming-text lyra-agents-streaming-rich">
        <LyraDocument content={content} />
        <span className="lyra-agents-streaming-cursor" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="lyra-agents-streaming-text lyra-agents-plain-text">
      <span>{text}</span>
      <span className="lyra-agents-streaming-cursor" aria-hidden="true" />
    </div>
  );
}