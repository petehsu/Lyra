import { useRef } from "react";

import { useData } from "../../data/DataProvider";
import { useStreamText } from "../../hooks/useStreamText";
import { PlainAgentText } from "./LyraDocument";
import { LyraMarkdown } from "./LyraMarkdown";
import {
  useStreamingBlockReplacementRevision,
  useStreamingMessageText,
  useSmoothStreamingText
} from "./use-streaming-message-text";
import { streamdownLinkSafety } from "./streamdown-plugins";
import {
  useLyraRichTextClickHandler
} from "./streamdown-components";

/**
 * Renders agent text during and after streaming using a single renderer
 * (Streamdown) for both states. During streaming, text is read from the
 * external StreamStore (via useStreamingMessageText) which accumulates deltas
 * at O(1) and commits once per IPC delivery batch. After streaming ends, the
 * finalized text from messageCommitted (passed as `content`) becomes the
 * source of truth. Using one renderer for both states eliminates the
 * streaming-vs-final style divergence.
 */
export function StreamingText({
  content,
  streaming,
  messageId,
  blockId
}: {
  content: string;
  streaming: boolean;
  messageId: string;
  blockId: string | null;
}) {
  const { aiRichRenderingEnabled } = useData();
  const useTypewriter = streaming && !aiRichRenderingEnabled;
  const rootRef = useRef<HTMLDivElement>(null);
  // Read only this streamed block. When not
  // streaming, falls back to `content` (the finalized message text).
  const streamStoreText = useStreamingMessageText(messageId, blockId, content, streaming);
  const smoothText = useSmoothStreamingText(
    streamStoreText,
    streaming && aiRichRenderingEnabled
  );
  const replacementRevision = useStreamingBlockReplacementRevision(messageId, blockId, streaming);
  // Streamdown 2.5 memoizes inner Markdown nodes by source position. A same-
  // length replacement therefore needs a one-time remount; keep that revision
  // stable after completion so the streaming -> final transition does not
  // remount again.
  const documentRevisionRef = useRef({ identity: `${messageId}:${blockId ?? "latest"}`, revision: 0 });
  const documentIdentity = `${messageId}:${blockId ?? "latest"}`;
  if (documentRevisionRef.current.identity !== documentIdentity) {
    documentRevisionRef.current = { identity: documentIdentity, revision: 0 };
  }
  if (replacementRevision > documentRevisionRef.current.revision) {
    documentRevisionRef.current.revision = replacementRevision;
  }
  const { text } = useStreamText(smoothText.text, {
    speed: 3,
    interval: 25,
    enabled: useTypewriter,
  });
  const handleClick = useLyraRichTextClickHandler(rootRef);
  if (!aiRichRenderingEnabled) {
    if (streaming) {
      return (
        <div className="lyra-agents-streaming-text lyra-agents-plain-text">
          <span>{text}</span>
        </div>
      );
    }
    return <PlainAgentText content={content} />;
  }

  return (
    <div
      ref={rootRef}
      className="lyra-agents-streaming-text lyra-agents-rich-text"
      onClick={handleClick}
    >
      <LyraMarkdown
        content={smoothText.text}
        documentKey={documentRevisionRef.current.revision}
        linkSafety={streamdownLinkSafety}
        streaming={streaming || smoothText.catchingUp}
      />
    </div>
  );
}
