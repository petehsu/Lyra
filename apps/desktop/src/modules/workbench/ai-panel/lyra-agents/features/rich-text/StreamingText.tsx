import { Streamdown } from "streamdown";
import { useEffect, useRef, useState } from "react";

import { useData } from "../../data/DataProvider";
import { useStreamText } from "../../hooks/useStreamText";
import { PlainAgentText } from "./LyraDocument";
import { useStreamingMessageText } from "./use-streaming-message-text";
import { lyraParseMarkdownIntoBlocks } from "./remark-block-splitter";
import { lyraStreamdownPlugins, streamdownLinkSafety, lyraRemarkPlugins } from "./streamdown-plugins";
import { LyraImage, useLyraRichTextClickHandler, useLyraRichTextFaviconDecoration } from "./streamdown-components";

const STREAMING_RENDER_BATCH_MS = 40;

function useBatchedStreamingContent(content: string, enabled: boolean): string {
  const [rendered, setRendered] = useState(content);
  const latestRef = useRef(content);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    latestRef.current = content;
    if (!enabled) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setRendered(content);
      return;
    }
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setRendered(latestRef.current);
    }, STREAMING_RENDER_BATCH_MS);
  }, [content, enabled]);

  useEffect(() => () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
  }, []);

  return enabled ? rendered : content;
}

/**
 * Renders agent text during and after streaming using a single renderer
 * (Streamdown) for both states. During streaming, text is read from the
 * external StreamStore (via useStreamingMessageText) which accumulates deltas
 * at O(1) and commits via requestAnimationFrame. After streaming ends, the
 * finalized text from messageCommitted (passed as `content`) becomes the
 * source of truth. Using one renderer for both states eliminates the
 * streaming-vs-final style divergence.
 */
export function StreamingText({
  content,
  streaming,
  messageId
}: {
  content: string;
  streaming: boolean;
  messageId: string;
}) {
  const { aiRichRenderingEnabled } = useData();
  const useTypewriter = streaming && !aiRichRenderingEnabled;
  const rootRef = useRef<HTMLDivElement>(null);
  // Read streaming text from the external store (RAF-coalesced). When not
  // streaming, falls back to `content` (the finalized message text).
  const streamStoreText = useStreamingMessageText(messageId, content, streaming);
  const richContent = useBatchedStreamingContent(streamStoreText, streaming && aiRichRenderingEnabled);
  const { text } = useStreamText(streamStoreText, {
    speed: 3,
    interval: 25,
    enabled: useTypewriter,
  });
  const handleClick = useLyraRichTextClickHandler(rootRef);
  // Decorate HTTP/HTTPS links with favicon chips after streamdown renders.
  // Only decorate in the static (final) state — streaming output is in flux
  // and decorating on every chunk would thrash the DOM.
  useLyraRichTextFaviconDecoration(rootRef, streaming, richContent);

  const streamdownComponents = useRef({ img: LyraImage }).current;

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

  // Rich mode: both streaming and final use Streamdown. The only difference
  // is mode ("streaming" runs remend + block-split memoization; "static"
  // renders the whole doc in one pass) and isAnimating (controls caret).
  // parseMarkdownIntoBlocksFn overrides streamdown's default marked-based
  // splitter with a remark-based one, so block boundaries are decided by the
  // same parser (remark-parse) that renders each block — eliminating the
  // marked/remark boundary disagreements that caused streaming rendering
  // glitches (setext headings, $$ math, HTML blocks split mid-element).
  return (
    <div
      ref={rootRef}
      className="lyra-agents-streaming-text lyra-agents-rich-text"
      onClick={handleClick}
    >
      <Streamdown
        className="lyra-agents-rich-text lyra-agents-streamdown"
        components={streamdownComponents}
        controls={false}
        dir="auto"
        lineNumbers={false}
        linkSafety={streamdownLinkSafety}
        mode={streaming ? "streaming" : "static"}
        isAnimating={streaming}
        parseIncompleteMarkdown={streaming}
        parseMarkdownIntoBlocksFn={lyraParseMarkdownIntoBlocks}
        normalizeHtmlIndentation
        plugins={lyraStreamdownPlugins}
        remarkPlugins={lyraRemarkPlugins}
      >
        {richContent}
      </Streamdown>
    </div>
  );
}
