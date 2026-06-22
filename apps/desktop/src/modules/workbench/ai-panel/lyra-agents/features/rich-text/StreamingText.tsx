import { cjk } from "@streamdown/cjk";
import { Streamdown, type StreamdownProps } from "streamdown";

import { useData } from "../../data/DataProvider";
import { useStreamText } from "../../hooks/useStreamText";
import { LyraDocument, PlainAgentText } from "./LyraDocument";

const streamdownPlugins = { cjk } satisfies StreamdownProps["plugins"];
const streamdownLinkSafety = { enabled: false } satisfies NonNullable<StreamdownProps["linkSafety"]>;

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
          {content}
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
