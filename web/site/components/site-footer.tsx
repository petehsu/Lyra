import type { SiteCopy, SiteLocale } from "@/lib/i18n";

type SiteFooterProps = {
  readonly locale: SiteLocale;
  readonly copy: SiteCopy["footer"];
};

export function SiteFooter({ locale, copy }: SiteFooterProps) {
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
          <a href="/legal/terms/">{copy.terms}</a>
          <a href="/legal/privacy/">{copy.privacy}</a>
          <a href="/legal/">{copy.legal}</a>
        </nav>
        <span>2026 Lyra</span>
      </div>
    </footer>
  );
}
