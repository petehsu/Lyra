import type { LyraRenderDocument } from "../../../../../../shared/render";
import { useData } from "../../data/DataProvider";
import { useStreamText } from "../../hooks/useStreamText";
import { LyraDocument, PlainAgentText } from "./LyraDocument";
import { useLyraDocument } from "./use-lyra-document";

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

  // Defense layer: while streaming in rich mode, render the live `content`
  // locally instead of trusting only the agent-provided snapshot. The snapshot
  // can lag behind `content` (event-merge boundaries, network jitter), and
  // LyraDocument renders ONLY the snapshot when present — so a stale snapshot
  // would freeze the text mid-sentence. Rendering from `content` here keeps
  // characters flowing no matter what; LyraDocument's own null-document path
  // falls back to plain `content` until the first local render lands.
  const localStreamingDoc = useLyraDocument(
    content,
    streaming && aiRichRenderingEnabled,
    true,
  );

  if (!streaming) {
    if (aiRichRenderingEnabled) {
      return <LyraDocument content={content} document={document ?? null} />;
    }
    return <PlainAgentText content={content} />;
  }

  if (aiRichRenderingEnabled) {
    return (
      <div className="lyra-agents-streaming-text lyra-agents-streaming-rich">
        <LyraDocument
          content={content}
          document={localStreamingDoc.document ?? document ?? null}
        />
      </div>
    );
  }

  return (
    <div className="lyra-agents-streaming-text lyra-agents-plain-text">
      <span>{text}</span>
    </div>
  );
}