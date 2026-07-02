import { cjk } from "@streamdown/cjk";
import { Streamdown, type StreamdownProps } from "streamdown";
import { useEffect, useRef, useState } from "react";

import { useData } from "../../data/DataProvider";
import { useStreamText } from "../../hooks/useStreamText";
import { LyraDocument, PlainAgentText } from "./LyraDocument";

const streamdownPlugins = { cjk } satisfies StreamdownProps["plugins"];
const streamdownLinkSafety = { enabled: false } satisfies NonNullable<StreamdownProps["linkSafety"]>;
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
 * Renders agent text during and after streaming.
 * Rich streaming uses Streamdown for incomplete markdown repair, then final
 * messages switch to Lyra's markdown-it renderer as the single rich authority.
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
  const richContent = useBatchedStreamingContent(content, streaming && aiRichRenderingEnabled);
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
        <Streamdown
          className="lyra-agents-rich-text lyra-agents-streamdown"
          controls={false}
          dir="auto"
          lineNumbers={false}
          linkSafety={streamdownLinkSafety}
          mode="streaming"
          normalizeHtmlIndentation
          parseIncompleteMarkdown
          plugins={streamdownPlugins}
        >
          {richContent}
        </Streamdown>
      </div>
    );
  }

  return (
    <div className="lyra-agents-streaming-text lyra-agents-plain-text">
      <span>{text}</span>
    </div>
  );
}
