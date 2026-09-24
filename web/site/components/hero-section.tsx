import { ArrowDown } from "@lyra/icons";
import type { SiteCopy, SiteLocale } from "@/lib/i18n";
import type { SiteTheme } from "@/lib/site-preferences";
import { RealWorkbenchFrame } from "./real-workbench-frame";
import { SiteHeader } from "./site-header";

type HeroSectionProps = {
  readonly locale: SiteLocale;
  readonly nav: SiteCopy["nav"];
  readonly copy: SiteCopy["hero"];
  readonly theme: SiteTheme | null;
  readonly onThemeChange: (theme: SiteTheme) => void;
  readonly onLocaleChange: (locale: SiteLocale) => void;
};

function HeroSiteSurface({
  locale,
  nav,
  copy,
  theme,
  onThemeChange,
  onLocaleChange
}: HeroSectionProps) {
  return (
    <div className="hero-site-surface">
      <SiteHeader
        locale={locale}
        nav={nav}
        theme={theme}
        onThemeChange={onThemeChange}
        onLocaleChange={onLocaleChange}
      />
      <div className="hero-site-page">
        <div className="hero-copy hero-enter">
          <h1 id="hero-title">{copy.title}</h1>
          <p>{copy.body}</p>
          <div className="hero-actions">
            <a className="hero-primary" href="#product">
              {copy.primary}
              <ArrowDown size={15} aria-hidden="true" />
            </a>
            <a className="hero-secondary" href="#video">
              {copy.secondary}
            </a>
          </div>
        </div>
        <div className="hero-wordmark" aria-hidden="true">LYRA</div>
        <p className="hero-note">{copy.note}</p>
      </div>
    </div>
  );
}

export function HeroSection(props: HeroSectionProps) {
  return (
    <section className="hero-section" aria-labelledby="hero-title">
      <div className="hero-portal-sticky">
        <div className="hero-workbench-camera">
          <RealWorkbenchFrame siteSurface={<HeroSiteSurface {...props} />} />
        </div>
        <p className="hero-reveal-caption" aria-hidden="true">
          {props.locale === "zh" ? "您一直在 Lyra 里。" : "You were in Lyra all along."}
        </p>
      </div>
    </section>
  );
}
