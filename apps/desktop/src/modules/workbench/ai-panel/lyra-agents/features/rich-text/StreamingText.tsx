import type { LyraRenderDocument } from "../../../../../../shared/render";
import { useData } from "../../data/DataProvider";
import { useStreamText } from "../../hooks/useStreamText";
import { LyraDocument, PlainAgentText } from "./LyraDocument";

/**
 * Renders agent text during and after streaming.
 * Rich mode mounts the agent-provided render snapshot synchronously.
 */
export function StreamingText({
  content,
  document,
  streaming,
}: {
  content: string;
  document?: LyraRenderDocument | null;
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
      return <LyraDocument content={content} document={document} />;
    }
    return <PlainAgentText content={content} />;
  }

  if (aiRichRenderingEnabled) {
    return (
      <div className="lyra-agents-streaming-text lyra-agents-streaming-rich">
        <LyraDocument content={content} document={document} />
      </div>
    );
  }

  return (
    <div className="lyra-agents-streaming-text lyra-agents-plain-text">
      <span>{text}</span>
    </div>
  );
}