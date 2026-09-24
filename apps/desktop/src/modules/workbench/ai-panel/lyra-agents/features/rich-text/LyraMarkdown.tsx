import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useMemo,
  type ComponentProps,
  type ReactNode
} from "react";
import { Streamdown, StreamdownContext, type StreamdownProps } from "streamdown";

import { LyraImage, LyraLink } from "./streamdown-components";
import { splitSettledMarkdown } from "./markdown-stream-split";
import { normalizeAiLatex } from "./normalize-ai-latex";
import { lyraRehypePlugins, lyraRemarkPlugins } from "./rich-markdown-plugins";
import { useLyraStreamdownPlugins } from "./streamdown-plugins";
import { ChatMediaLayout } from "../media";
import { scanMarkdownMediaTokens } from "../media/layout";

const emptyMediaTokens: ReturnType<typeof scanMarkdownMediaTokens> = [];
const ArrangeMediaContext = createContext(false);

const isWhitespaceNode = (node: ReactNode): boolean =>
  typeof node === "string" && node.trim().length === 0;

/**
 * CommonMark treats Markdown inside raw HTML blocks as literal text. AI output
 * frequently uses the otherwise-standard details/summary pattern and expects
 * lists, code and emphasis in its body to remain rich. Re-render only that raw
 * body through the same mature Streamdown pipeline; no second parser or custom
 * Markdown grammar is introduced.
 */
function LyraDetails({ children, node: _node, ...props }: ComponentProps<"details"> & {
  readonly node?: unknown;
}) {
  const arrangeMedia = useContext(ArrangeMediaContext);
  const context = useContext(StreamdownContext);
  const childNodes = Children.toArray(children);
  const summaryIndex = childNodes.findIndex((child) =>
    !isWhitespaceNode(child) && isValidElement(child)
  );
  const summary = summaryIndex >= 0 ? childNodes[summaryIndex] : null;
  const bodyNodes = childNodes.filter((_, index) => index !== summaryIndex);
  const rawBody = bodyNodes.every((child) => typeof child === "string")
    ? bodyNodes.join("").trim()
    : null;

  return (
    <details {...props} className="lyra-agents-md-details">
      {summary}
      <div className="lyra-agents-md-details-body">
        {rawBody !== null && rawBody.length > 0 ? (
          <LyraMarkdown
            arrangeMedia={arrangeMedia}
            content={rawBody}
            streaming={context.isAnimating}
            {...(context.linkSafety === undefined ? {} : { linkSafety: context.linkSafety })}
          />
        ) : bodyNodes}
      </div>
    </details>
  );
}

function LyraSummary({ children, node: _node, ...props }: ComponentProps<"summary"> & {
  readonly node?: unknown;
}) {
  return (
    <summary {...props} className="lyra-agents-md-details-summary">
      <span className="lyra-agents-md-details-chevron" aria-hidden="true" />
      <span>{children}</span>
    </summary>
  );
}

const components = {
  a: LyraLink,
  details: LyraDetails,
  img: LyraImage,
  summary: LyraSummary
} as NonNullable<StreamdownProps["components"]>;

// text-only avoids temporary placeholder links becoming clickable while the
// model is still writing their destination. The rest of the tolerance rules
// come from remend instead of Lyra maintaining its own Markdown repair parser.
const streamingTolerance = {
  linkMode: "text-only"
} satisfies NonNullable<StreamdownProps["remend"]>;

// Sanitizer extras live in lyraRehypePlugins (span/div className for math,
// plus kbd/dl/footnotes already in the GitHub schema). Passing allowedTags
// here would be ignored once rehypePlugins is set.

export type LyraMarkdownProps = {
  /** Chat pulls images out of the document and places them beside the text. */
  readonly arrangeMedia?: boolean;
  readonly className?: string;
  readonly content: string;
  readonly documentKey?: number | string;
  readonly linkSafety?: NonNullable<StreamdownProps["linkSafety"]>;
  readonly streaming?: boolean;
};

const defaultLinkSafety = { enabled: true } satisfies NonNullable<
  StreamdownProps["linkSafety"]
>;

// Streamdown only skips useTransition when `animated` is a truthy plugin
// config. Duration 0 does not fade; isAnimating=false keeps the plugin off.
const liveStreamdownAnimated = { duration: 0 } as const;

/**
 * The one rich-document renderer used by chat, file preview, plan previews
 * and temporary chat. Settled Markdown chunks keep a stable Streamdown instance so finishing
 * a response does not swap to a different parser or DOM shape. Only the live
 * tail re-parses while tokens arrive.
 *
 * Streamdown 2.5 `mode="streaming"` keeps the previous block tree in useState
 * and, when `animated` is unset, commits the next tree through useTransition.
 * Token bursts interrupt that update until the stream goes idle — a few words
 * paint, then the rest dumps at the end. A zero-duration `animated` object
 * takes Streamdown's synchronous setState path. `isAnimating` stays false so
 * the rehype fade plugin (also gated on that flag) does not restrobe old text.
 * Settled chunks use static mode and paint in the same turn.
 */
export function LyraMarkdown({
  arrangeMedia = true,
  className,
  content,
  documentKey,
  linkSafety = defaultLinkSafety,
  streaming = false
}: LyraMarkdownProps) {
  const plugins = useLyraStreamdownPlugins();
  const classes = ["lyra-agents-rich-text", "lyra-agents-streamdown", className]
    .filter(Boolean)
    .join(" ");
  const latexContent = useMemo(() => normalizeAiLatex(content), [content]);
  const chunks = useMemo(() => splitSettledMarkdown(latexContent), [latexContent]);
  const mediaTokens = useMemo(() => {
    if (!arrangeMedia || (!latexContent.includes("![") && !latexContent.includes("<img"))) {
      return emptyMediaTokens;
    }
    return scanMarkdownMediaTokens(latexContent);
  }, [arrangeMedia, latexContent]);
  const hasExtractedMedia = mediaTokens.some((token) => token.type === "image");

  const streamdown = (body: string, key: string | number | undefined, live: boolean, wrapClass?: string) => (
    <Streamdown
      key={key}
      {...(wrapClass === undefined ? {} : { className: wrapClass })}
      components={components}
      controls={false}
      dir="auto"
      animated={live ? liveStreamdownAnimated : false}
      isAnimating={false}
      lineNumbers={false}
      linkSafety={linkSafety}
      mode={live ? "streaming" : "static"}
      normalizeHtmlIndentation
      parseIncompleteMarkdown={live}
      plugins={plugins}
      rehypePlugins={lyraRehypePlugins}
      remarkPlugins={lyraRemarkPlugins}
      remend={streamingTolerance}
    >
      {body}
    </Streamdown>
  );

  const body = hasExtractedMedia ? (
    <div className={classes}>
      <ChatMediaLayout
        tokens={mediaTokens}
        renderText={(segment) => streamdown(
          segment.text,
          `${documentKey ?? "md"}:${segment.id}`,
          streaming
        )}
      />
    </div>
  ) : chunks.settled.length === 0 ? (
    streamdown(latexContent, documentKey, streaming, classes)
  ) : (
    <div className={`${classes} lyra-agents-streamdown-chunks`}>
      {chunks.settled.map((block, index) =>
        streamdown(block, `${documentKey ?? "md"}:${index}`, false)
      )}
      {chunks.tail.length > 0
        ? streamdown(chunks.tail, `${documentKey ?? "md"}:tail`, streaming)
        : null}
    </div>
  );

  return (
    <ArrangeMediaContext.Provider value={arrangeMedia}>
      {body}
    </ArrangeMediaContext.Provider>
  );
}
