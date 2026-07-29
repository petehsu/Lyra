import type { SiteCopy, SiteLocale } from "@/lib/i18n";
import { legalHref } from "@/lib/legal";

type SiteFooterProps = {
  readonly locale: SiteLocale;
  readonly copy: SiteCopy["footer"];
};

export function SiteFooter({ locale, copy }: SiteFooterProps) {
  const legalLocale = locale === "zh" ? "zh-CN" : "en-US";
  return (
    <footer className="site-footer">
      <div className="footer-branding">
        <a className="brand-lockup" href={`/${locale}`}>
          <img src="/lyra-mark.svg" alt="" />
          <span>LYRA</span>
        </a>
        <p>{copy.statement}</p>
      </div>
      <div className="footer-meta">
        <p>{copy.independent}</p>
        <nav aria-label="Legal">
          <a href={legalHref("/legal/terms", legalLocale)}>{copy.terms}</a>
          <a href={legalHref("/legal/privacy", legalLocale)}>{copy.privacy}</a>
          <a href={legalHref("/legal/licenses", legalLocale)}>{copy.licenses}</a>
          <a href={legalHref("/legal", legalLocale)}>{copy.legal}</a>
        </nav>
        <span>2026 Lyra</span>
      </div>
    </footer>
  );
}
