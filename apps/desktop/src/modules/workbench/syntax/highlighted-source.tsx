import { useEffect, useState, type CSSProperties } from "react";
import type { BundledLanguage, HighlightResult } from "@streamdown/code";

import { lyraCodePlugin } from "./code-plugin";

type SyntaxToken = HighlightResult["tokens"][number][number];

const tokenStyle = (token: SyntaxToken): CSSProperties => {
  const style: Record<string, string> = {};
  if (token.color !== undefined) {
    style["--sdm-c"] = token.color;
  }
  if (token.bgColor !== undefined) {
    style["--sdm-tbg"] = token.bgColor;
  }
  if (token.htmlStyle !== undefined && typeof token.htmlStyle === "object") {
    for (const [key, value] of Object.entries(token.htmlStyle)) {
      if (key === "color") {
        style["--sdm-c"] = value;
      } else if (key === "background-color") {
        style["--sdm-tbg"] = value;
      } else {
        style[key] = value;
      }
    }
  }
  return style;
};

const fallbackTokens = (code: string): HighlightResult["tokens"] =>
  code.split("\n").map((line) => [{ content: line, offset: 0 }]);

const resolveLanguage = (language: string): BundledLanguage =>
  lyraCodePlugin.supportsLanguage(language as BundledLanguage)
    ? (language as BundledLanguage)
    : "text";

export function HighlightedSource({
  code,
  language,
  className
}: {
  readonly code: string;
  readonly language: string;
  readonly className?: string;
}) {
  const [tokens, setTokens] = useState<HighlightResult["tokens"]>(() => fallbackTokens(code));

  useEffect(() => {
    const apply = (result: HighlightResult): void => {
      setTokens(result.tokens);
    };
    const next = lyraCodePlugin.highlight(
      { code, language: resolveLanguage(language), themes: lyraCodePlugin.getThemes() },
      apply
    );
    if (next) {
      apply(next);
      return;
    }
    setTokens(fallbackTokens(code));
  }, [code, language]);

  return (
    <pre className={["lyra-syntax-source", className].filter(Boolean).join(" ")} data-language={language}>
      <code>
        {tokens.map((line, lineIndex) => (
          <span className="lyra-syntax-source-line" key={lineIndex}>
            {line.map((token, tokenIndex) => (
              <span key={tokenIndex} style={tokenStyle(token)}>
                {token.content}
              </span>
            ))}
            {lineIndex < tokens.length - 1 ? "\n" : null}
          </span>
        ))}
      </code>
    </pre>
  );
}
