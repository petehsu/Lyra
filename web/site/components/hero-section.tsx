import type { SiteCopy, SiteLocale } from "@/lib/i18n";
import type { SiteTheme } from "@/lib/site-preferences";
import { LocalSection } from "./local-section";
import { HeroLandscape } from "./hero-landscape";
import { HeroPixelTransition } from "./hero-pixel-transition";
import { ProductShowcase } from "./product-showcase";
import { RealWorkbenchFrame } from "./real-workbench-frame";
import { SiteHeader } from "./site-header";
import { VideoSection } from "./video-section";

type HeroSectionProps = {
  readonly locale: SiteLocale;
  readonly nav: SiteCopy["nav"];
  readonly copy: SiteCopy["hero"];
  readonly product: SiteCopy["product"];
  readonly local: SiteCopy["local"];
  readonly video: SiteCopy["video"];
  readonly theme: SiteTheme | null;
  readonly onThemeChange: (theme: SiteTheme) => void;
  readonly onLocaleChange: (locale: SiteLocale) => void;
};

function HeroSiteSurface({
  locale,
  nav,
  copy,
  product,
  local,
  theme,
  onThemeChange,
  onLocaleChange
}: HeroSectionProps) {
  return (
    <div className="hero-site-story">
      <div className="hero-opening-art" aria-hidden="true">
        <HeroLandscape />
        <HeroPixelTransition />
      </div>
      <div className="hero-site-surface">
        <SiteHeader
          locale={locale}
          nav={nav}
          theme={theme}
          onThemeChange={onThemeChange}
          onLocaleChange={onLocaleChange}
        />
        <div className="hero-site-page">
          <div className="hero-copy">
            <h1 id="hero-title">{copy.title}</h1>
          </div>
        </div>
      </div>
      <ProductShowcase copy={product} sectionId="product" />
      <LocalSection copy={local} sectionId="local" />
    </div>
  );
}

export function HeroSection(props: HeroSectionProps) {
  return (
    <section className="hero-section" aria-labelledby="hero-title">
      <div className="hero-portal-sticky">
        <div className="hero-scene-flow">
          <HeroLandscape desktop />
          <div className="hero-workbench-stage">
            <div className="hero-workbench-camera">
              <RealWorkbenchFrame
                locale={props.locale}
                theme={props.theme}
                siteSurface={<HeroSiteSurface {...props} />}
                onThemeChange={props.onThemeChange}
                onLocaleChange={props.onLocaleChange}
              />
            </div>
            <p className="hero-reveal-caption" aria-hidden="true">
              {props.copy.previewCaption}
            </p>
          </div>
          <VideoSection copy={props.video} locale={props.locale} theme={props.theme} />
        </div>
      </div>
    </section>
  );
}
