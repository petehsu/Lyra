import { Check, CodeXml, Copy, WrapText } from "@lyra/icons";
import { cloneElement, isValidElement, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import { AppButton } from "@renderer/ui/components";
import { t } from "@workbench/i18n";
import { writeClipboardText } from "../../../../../../shared/clipboard";

type CodeElementProps = ComponentProps<"code"> & { "data-block"?: string };

/** Decorate the parsed fence, leaving highlighting, streaming and diagrams to Streamdown. */
export function LyraMarkdownPre({ children }: ComponentProps<"pre">) {
  if (!isValidElement<CodeElementProps>(children)) return children;
  const block = cloneElement(children, { "data-block": "true" });
  const language = /(?:^|\s)language-(\S+)/u.exec(children.props.className ?? "")?.[1] ?? "";
  const code = children.props.children;
  if (language === "mermaid" || typeof code !== "string") return block;
  return <MarkdownCodeBlock code={code} language={language}>{block}</MarkdownCodeBlock>;
}

function MarkdownCodeBlock({ code, language, children }: {
  readonly code: string;
  readonly language: string;
  readonly children: ReactNode;
}) {
  const [wrapped, setWrapped] = useState(false);
  const [feedback, setFeedback] = useState<{ code: string; copied: boolean } | null>(null);
  const copyAttempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    copyAttempt.current += 1;
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const result = feedback?.code === code ? feedback : null;
  const copyLabel = result === null ? t("richText.codeBlock.copy")
    : result.copied ? t("dialog.copiedAction") : t("richText.codeBlock.copyFailed");
  const copy = async () => {
    const attempt = ++copyAttempt.current;
    const copied = await writeClipboardText(code);
    if (attempt !== copyAttempt.current) return;
    setFeedback({ code, copied });
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeedback(null), 2_000);
  };

  return (
    <div className="lyra-markdown-code-block" data-wrap={wrapped} dir="ltr">
      <div className="lyra-markdown-code-header">
        <span className="lyra-markdown-code-language">
          <CodeXml size={14} aria-hidden="true" />
          <span>{language || t("richText.codeBlock.text")}</span>
        </span>
        <div className="lyra-markdown-code-actions">
          <AppButton
            variant="ghost" size="icon"
            aria-label={t("richText.codeBlock.wrap")}
            title={t("richText.codeBlock.wrap")}
            aria-pressed={wrapped}
            onClick={() => setWrapped((value) => !value)}
          ><WrapText size={16} aria-hidden="true" /></AppButton>
          <AppButton variant="ghost" size="icon" aria-label={copyLabel} title={copyLabel} onClick={() => void copy()}>
            {result?.copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          </AppButton>
          <span className="lyra-markdown-code-feedback" role="status">
            {result === null ? "" : copyLabel}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}
