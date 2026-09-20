import {
  Children,
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
  readonly className?: string;
  readonly content: string;
  readonly documentKey?: number | string;
  readonly linkSafety?: NonNullable<StreamdownProps["linkSafety"]>;
  readonly streaming?: boolean;
};

const defaultLinkSafety = { enabled: true } satisfies NonNullable<
  StreamdownProps["linkSafety"]
>;

/**
 * The one rich-document renderer used by chat, plan previews and temporary
 * chat. Settled Markdown chunks keep a stable Streamdown instance so finishing
 * a response does not swap to a different parser or DOM shape. Only the live
 * tail re-parses while tokens arrive.
 */
export function LyraMarkdown({
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
    if (!latexContent.includes("![") && !latexContent.includes("<img")) {
      return emptyMediaTokens;
    }
    return scanMarkdownMediaTokens(latexContent);
  }, [latexContent]);
  const hasExtractedMedia = mediaTokens.some((token) => token.type === "image");

  const streamdown = (body: string, key: string | number | undefined, live: boolean, wrapClass?: string) => (
    <Streamdown
      key={key}
      {...(wrapClass === undefined ? {} : { className: wrapClass })}
      components={components}
      controls={false}
      dir="auto"
      isAnimating={live}
      lineNumbers={false}
      linkSafety={linkSafety}
      mode="streaming"
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

  if (hasExtractedMedia) {
    return (
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
    );
  }

  if (chunks.settled.length === 0) {
    return streamdown(latexContent, documentKey, streaming, classes);
  }

  return (
    <div className={`${classes} lyra-agents-streamdown-chunks`}>
      {chunks.settled.map((block, index) =>
        streamdown(block, `${documentKey ?? "md"}:${index}`, false)
      )}
      {chunks.tail.length > 0
        ? streamdown(chunks.tail, `${documentKey ?? "md"}:tail`, streaming)
        : null}
    </div>
  );
}
