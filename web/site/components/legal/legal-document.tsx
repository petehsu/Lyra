import { Fragment, type ReactNode } from "react";
import {
  localized,
  type LegalDocument,
  type LegalLocale
} from "@/lib/legal";

type LegalDocumentViewProps = {
  readonly document: LegalDocument;
  readonly locale: LegalLocale;
  readonly insertAfterSections?: readonly {
    readonly id: string;
    readonly content: ReactNode;
  }[];
};

const tocLabel = {
  "en-US": "On this page",
  "zh-CN": "本页目录"
} as const;

export function LegalDocumentView({
  document,
  locale,
  insertAfterSections
}: LegalDocumentViewProps) {
  return (
    <div className="legal-document-layout">
      <nav
        className="legal-toc"
        aria-label={localized(tocLabel, locale)}
      >
        <strong>{localized(tocLabel, locale)}</strong>
        <ol>
          {document.sections.map((section, index) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>
                <span aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {localized(section.heading, locale)}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <article className="legal-article">
        {document.sections.map((section, index) => (
          <Fragment key={section.id}>
            <section id={section.id} className="legal-section">
              <p className="legal-section-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h2>{localized(section.heading, locale)}</h2>
              {section.blocks.map((block, blockIndex) => {
                if (block.kind === "list") {
                  return (
                    <ul key={`${section.id}-list-${blockIndex}`}>
                      {block.items.map((item, itemIndex) => (
                        <li key={`${section.id}-item-${itemIndex}`}>
                          {localized(item, locale)}
                        </li>
                      ))}
                    </ul>
                  );
                }
                return (
                  <p
                    className={
                      block.kind === "notice"
                        ? "legal-inline-notice"
                        : undefined
                    }
                    key={`${section.id}-paragraph-${blockIndex}`}
                  >
                    {localized(block.text, locale)}
                  </p>
                );
              })}
            </section>
            {insertAfterSections?.find(
              (insertion) => insertion.id === section.id
            )?.content ?? null}
          </Fragment>
        ))}
      </article>
    </div>
  );
}
