import {
  Children,
  isValidElement,
  useContext,
  type ComponentProps,
  type ReactNode
} from "react";
import { Streamdown, StreamdownContext, type StreamdownProps } from "streamdown";

import { LyraImage, LyraLink } from "./streamdown-components";
import { useLyraStreamdownPlugins } from "./streamdown-plugins";

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

// Prefer standard HTML disclosure elements over Lyra's former :::details
// dialect. They are sanitized by Streamdown and work in any CommonMark tool.
const allowedTags = {
  details: ["open"],
  summary: []
} satisfies NonNullable<StreamdownProps["allowedTags"]>;

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
 * chat. It intentionally stays in Streamdown's block mode after completion:
 * completed blocks retain their React identity, and finishing a response no
 * longer swaps to a whole-document parse with a different DOM shape.
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

  return (
    <Streamdown
      key={documentKey}
      allowedTags={allowedTags}
      className={classes}
      components={components}
      controls={false}
      dir="auto"
      isAnimating={streaming}
      lineNumbers={false}
      linkSafety={linkSafety}
      mode="streaming"
      normalizeHtmlIndentation
      parseIncompleteMarkdown={streaming}
      plugins={plugins}
      remend={streamingTolerance}
    >
      {content}
    </Streamdown>
  );
}
