import { Moon, Sun } from "lucide-react";
import type { SiteCopy, SiteLocale } from "@/lib/i18n";
import type { SiteTheme } from "@/lib/site-preferences";

type SiteHeaderProps = {
  readonly locale: SiteLocale;
  readonly nav: SiteCopy["nav"];
  readonly theme: SiteTheme | null;
  readonly onThemeChange: (theme: SiteTheme) => void;
  readonly onLocaleChange: (locale: SiteLocale) => void;
};

export function SiteHeader({
  locale,
  nav,
  theme,
  onThemeChange,
  onLocaleChange
}: SiteHeaderProps) {
  const otherLocale = locale === "zh" ? "en" : "zh";
  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <header className="site-header site-header-embedded">
      <a className="brand-lockup" href={`/${locale}`} aria-label="Lyra">
        <img src="/lyra-mark.svg" alt="" />
        <span>LYRA</span>
      </a>
      <nav aria-label="Primary navigation">
        <a href="#product">{nav.details}</a>
        <a href="#oma">{nav.oma}</a>
        <a href="#local">{nav.local}</a>
        <a href="#pricing">{nav.pricing}</a>
        <a href="/docs">{nav.docs}</a>
      </nav>
      <div className="header-actions">
        <button
          type="button"
          className="theme-toggle"
          aria-label={nextTheme === "dark" ? nav.darkTheme : nav.lightTheme}
          title={nextTheme === "dark" ? nav.darkTheme : nav.lightTheme}
          onClick={() => onThemeChange(nextTheme)}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <a
          className="language-link"
          href={`/${otherLocale}`}
          lang={otherLocale}
          onClick={(event) => {
            event.preventDefault();
            onLocaleChange(otherLocale);
          }}
        >
          {nav.language}
        </a>
        <a className="download-link" href="#download">{nav.download}</a>
      </div>
    </header>
  );
}
