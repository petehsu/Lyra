import type { ReactNode } from "react";
import {
  LEGAL_META,
  LEGAL_NAVIGATION,
  STATUS_LABEL,
  legalHref,
  localized,
  type LegalLocale
} from "@/lib/legal";

type LegalShellProps = {
  readonly locale: LegalLocale;
  readonly currentPath: string;
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
};

const copy = {
  skip: {
    "en-US": "Skip to legal content",
    "zh-CN": "跳转至法律正文"
  },
  navigation: {
    "en-US": "Legal pages",
    "zh-CN": "法律页面"
  },
  language: {
    "en-US": "Language",
    "zh-CN": "语言"
  },
  version: {
    "en-US": "Version",
    "zh-CN": "版本"
  },
  effective: {
    "en-US": "Effective date",
    "zh-CN": "生效日期"
  },
  notSet: {
    "en-US": "Not set",
    "zh-CN": "未填写"
  },
  verified: {
    "en-US": "Implementation last verified",
    "zh-CN": "实现最后核验"
  },
  applies: {
    "en-US": "Applies to",
    "zh-CN": "适用版本"
  },
  authority: {
    "en-US":
      "English and Simplified Chinese share the same version, section IDs, status, and effective date and have equal authority.",
    "zh-CN":
      "英文与简体中文共享同一版本、章节 ID、状态和生效日期，具有同等效力。"
  },
  operator: {
    "en-US":
      "Operated by 徐远豪 (Pete Hsu), an individual developer in mainland China trading as Lyra.",
    "zh-CN":
      "由中国大陆个人开发者徐远豪（Pete Hsu）以 Lyra 名义运营。"
  },
  back: {
    "en-US": "Lyra home",
    "zh-CN": "Lyra 首页"
  }
} as const;

export function LegalShell({
  locale,
  currentPath,
  title,
  description,
  children
}: LegalShellProps) {
  const homeLocale = locale === "zh-CN" ? "zh" : "en";

  return (
    <div className="legal-page" lang={locale}>
      <a className="legal-skip-link" href="#legal-content">
        {localized(copy.skip, locale)}
      </a>
      <header className="legal-site-header">
        <a className="legal-brand" href={legalHref("/legal", locale)}>
          <img src="/lyra-mark.svg" alt="" width="22" height="22" />
          <span>LYRA LEGAL</span>
        </a>
        <nav
          className="legal-site-navigation"
          aria-label={localized(copy.navigation, locale)}
        >
          {LEGAL_NAVIGATION.map((item) => (
            <a
              key={item.path}
              href={legalHref(item.path, locale)}
              aria-current={currentPath === item.path ? "page" : undefined}
            >
              {localized(item.label, locale)}
            </a>
          ))}
        </nav>
        <div
          className="legal-language-switch"
          aria-label={localized(copy.language, locale)}
        >
          <a
            href={legalHref(currentPath, "en-US")}
            hrefLang="en"
            lang="en"
            aria-current={locale === "en-US" ? "true" : undefined}
          >
            EN
          </a>
          <span aria-hidden="true">/</span>
          <a
            href={legalHref(currentPath, "zh-CN")}
            hrefLang="zh-CN"
            lang="zh-CN"
            aria-current={locale === "zh-CN" ? "true" : undefined}
          >
            中文
          </a>
        </div>
      </header>

      <main id="legal-content" className="legal-main" tabIndex={-1}>
        <header className="legal-document-header">
          <div className="legal-status-row">
            <span className="legal-status" data-status={LEGAL_META.status}>
              {localized(STATUS_LABEL, locale)}
            </span>
            <span>{LEGAL_META.applicableVersion}</span>
          </div>
          <h1>{title}</h1>
          <p className="legal-deck">{description}</p>
          <dl className="legal-meta">
            <div>
              <dt>{localized(copy.version, locale)}</dt>
              <dd>{LEGAL_META.version}</dd>
            </div>
            <div>
              <dt>{localized(copy.effective, locale)}</dt>
              <dd>
                {LEGAL_META.effectiveDate ??
                  localized(copy.notSet, locale)}
              </dd>
            </div>
            <div>
              <dt>{localized(copy.verified, locale)}</dt>
              <dd>{LEGAL_META.lastVerified}</dd>
            </div>
            <div>
              <dt>{localized(copy.applies, locale)}</dt>
              <dd>{LEGAL_META.applicableVersion}</dd>
            </div>
          </dl>
          <p className="legal-authority">
            {localized(copy.authority, locale)}
          </p>
        </header>
        {children}
      </main>

      <footer className="legal-footer">
        <p>{localized(copy.operator, locale)}</p>
        <a href={`/${homeLocale}`}>{localized(copy.back, locale)}</a>
      </footer>
    </div>
  );
}
