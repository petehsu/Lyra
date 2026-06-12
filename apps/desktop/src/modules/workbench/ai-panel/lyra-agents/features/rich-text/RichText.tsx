import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { MermaidBlock } from "./Mermaid";
import {
  ActionTargetButton,
  ClickableImage,
  classifyActionTarget
} from "./ActionTargets";

/**
 * Renders markdown content with:
 * - GFM (tables, strikethrough, task lists, autolinks)
 * - Syntax-highlighted code blocks
 * - Mermaid diagrams (```mermaid code fences)
 * - Tolerant of malformed markdown (react-markdown handles gracefully)
 */
export function RichText({ content }: { content: string }) {
  // Pre-process: fix common AI output issues
  const cleaned = fixCommonIssues(content);

  return (
    <div className="lyra-agents-rich-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}

const components: Components = {
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "");
    const lang = match?.[1];
    const codeStr = String(children).replace(/\n$/, "");

    // Mermaid diagrams
    if (lang === "mermaid") {
      return <MermaidBlock code={codeStr} />;
    }

    // Inline code (no language class, no newlines)
    if (!className && !String(children).includes("\n")) {
      const text = String(children).trim();
      const target = classifyActionTarget(text);

      if (target !== null) {
        return (
          <ActionTargetButton target={target} className="lyra-agents-md-inline-code lyra-agents-md-clickable-path">
            {children}
          </ActionTargetButton>
        );
      }
      return (
        <code
          className="lyra-agents-md-inline-code"
          {...props}
        >
          {children}
        </code>
      );
    }

    // Block code
    return (
      <pre className="lyra-agents-md-code-block">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  },
  pre({ children }) {
    // react-markdown wraps code in <pre>, but we handle it in `code` above.
    return <>{children}</>;
  },
  table({ children }) {
    return (
      <div className="lyra-agents-md-table-wrap">
        <table className="lyra-agents-md-table">{children}</table>
      </div>
    );
  },
  a({ href, children }) {
    const target = href === undefined ? null : classifyActionTarget(href);

    if (target !== null) {
      return (
        <ActionTargetButton target={target} className="lyra-agents-md-link">
          {children}
        </ActionTargetButton>
      );
    }

    return (
      <a href={href} className="lyra-agents-md-link">
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    return <ClickableImage src={src} alt={alt} className="lyra-agents-md-image-container" />;
  }
};

/**
 * Fix common AI output issues:
 * - Unclosed code fences
 * - Broken table pipes (fullwidth → halfwidth)
 * - Stray HTML-like tags that aren't real HTML
 */
function fixCommonIssues(content: string): string {
  let result = content;

  // Normalize fullwidth pipes to halfwidth (common in CJK model output)
  result = result.replace(/｜/g, "|");

  // Fix unclosed code fences: if odd number of ```, append a closing one
  const fenceCount = (result.match(/^```/gm) || []).length;
  if (fenceCount % 2 !== 0) {
    result += "\n```";
  }

  // Fix broken bold: odd number of ** pairs
  const boldMarkers = (result.match(/\*\*/g) || []).length;
  if (boldMarkers % 2 !== 0) {
    result += "**";
  }

  return result;
}
