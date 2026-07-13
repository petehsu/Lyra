import { ArrowDown } from "lucide-react";
import type { ReactNode } from "react";
import type { SiteCopy, SiteLocale } from "@/lib/i18n";
import type { SiteTheme } from "@/lib/site-preferences";
import {
  HERO_ASCII_SHAPES,
  renderHeroAsciiShape
} from "@/lib/hero-ascii-shapes";
import { AsciiMark } from "./ascii-mark";
import { HeroAsciiField } from "./hero-ascii-field";
import { LyraWorkbenchDemo } from "./lyra-workbench-demo";
import { SiteHeader } from "./site-header";

type HeroSectionProps = {
  readonly locale: SiteLocale;
  readonly nav: SiteCopy["nav"];
  readonly copy: SiteCopy["hero"];
  readonly demoCopy: SiteCopy["demo"];
  readonly siteContent: ReactNode;
  readonly theme: SiteTheme | null;
  readonly onThemeChange: (theme: SiteTheme) => void;
  readonly onLocaleChange: (locale: SiteLocale) => void;
};

const keywordShapes = HERO_ASCII_SHAPES.slice(1);
const keywordAsciiArt = keywordShapes.map((shape) =>
  renderHeroAsciiShape(shape)
);

function HeroIntro({
  copy,
  mobile
}: {
  readonly copy: SiteCopy["hero"];
  readonly mobile: boolean;
}) {
  return (
    <>
      <div className={mobile ? "hero-copy" : "hero-copy hero-enter"}>
        <h1 id={mobile ? undefined : "hero-title"} aria-label={copy.title}>
          {copy.titleLines.map((line) => (
            <span className="hero-title-line" key={line}>{line}</span>
          ))}
        </h1>
      </div>
      <div className="hero-center-wordmark" aria-hidden="true">LYRA</div>
      <div className={mobile ? "hero-context" : "hero-context hero-enter"}>
        <small className="hero-release">{copy.note}</small>
        <p>{copy.body}</p>
        <a className="hero-scroll-link" href="#product">
          {copy.primary}
          <ArrowDown size={15} aria-hidden="true" />
        </a>
      </div>
    </>
  );
}

function HeroKeywordPanels({ copy }: { readonly copy: SiteCopy["hero"] }) {
  return (
    <div className="hero-keyword-panels">
      {copy.keywords.map((keyword, index) => (
        <section
          className="hero-story-panel hero-keyword-panel"
          data-hero-story-panel={index + 1}
          key={keyword.title}
        >
          <h2>{keyword.title}</h2>
          <p>{keyword.body}</p>
        </section>
      ))}
    </div>
  );
}

function HeroMobileKeywords({ copy }: { readonly copy: SiteCopy["hero"] }) {
  return (
    <div className="hero-mobile-keywords">
      {copy.keywords.map((keyword, index) => (
        <section className="hero-mobile-keyword" key={keyword.title}>
          <pre
            className="hero-keyword-mark"
            role="img"
            aria-label={keyword.title}
          >
            {keywordAsciiArt[index]}
          </pre>
          <div>
            <h2>{keyword.title}</h2>
            <p>{keyword.body}</p>
          </div>
        </section>
      ))}
    </div>
  );
}

function HeroCopy({
  copy,
  mobile = false
}: {
  readonly copy: SiteCopy["hero"];
  readonly mobile?: boolean;
}) {
  if (mobile) {
    return (
      <div className="hero-mobile-copy">
        <div className="hero-visual">
          <AsciiMark />
        </div>
        <HeroIntro copy={copy} mobile />
      </div>
    );
  }

  return (
    <div className="hero-site-page">
      <HeroAsciiField />
      <div className="hero-logo-target" aria-hidden="true" />
      <div
        className="hero-story-panel hero-intro-panel"
        data-hero-story-panel={0}
      >
        <HeroIntro copy={copy} mobile={false} />
      </div>
      <HeroKeywordPanels copy={copy} />
      <div className="hero-visual hero-logo-fallback">
        <AsciiMark />
      </div>
    </div>
  );
}

function HeroSiteSurface({
  locale,
  nav,
  copy,
  siteContent,
  theme,
  onThemeChange,
  onLocaleChange
}: {
  readonly locale: SiteLocale;
  readonly nav: SiteCopy["nav"];
  readonly copy: SiteCopy["hero"];
  readonly siteContent: ReactNode;
  readonly theme: SiteTheme | null;
  readonly onThemeChange: (theme: SiteTheme) => void;
  readonly onLocaleChange: (locale: SiteLocale) => void;
}) {
  return (
    <div className="hero-site-surface">
      <SiteHeader
        locale={locale}
        nav={nav}
        theme={theme}
        onThemeChange={onThemeChange}
        onLocaleChange={onLocaleChange}
      />
      <div className="hero-site-document">
        <HeroCopy copy={copy} />
        {siteContent}
      </div>
    </div>
  );
}

export function HeroSection({
  locale,
  nav,
  copy,
  demoCopy,
  siteContent,
  theme,
  onThemeChange,
  onLocaleChange
}: HeroSectionProps) {
  const siteSurface = (
    <HeroSiteSurface
      locale={locale}
      nav={nav}
      copy={copy}
      siteContent={siteContent}
      theme={theme}
      onThemeChange={onThemeChange}
      onLocaleChange={onLocaleChange}
    />
  );

  return (
    <section className="hero-section" aria-labelledby="hero-title">
      <div className="hero-mobile-header">
        <SiteHeader
          locale={locale}
          nav={nav}
          theme={theme}
          onThemeChange={onThemeChange}
          onLocaleChange={onLocaleChange}
        />
      </div>
      <HeroCopy copy={copy} mobile />
      <HeroMobileKeywords copy={copy} />
      <div className="hero-portal-sticky">
        <LyraWorkbenchDemo
          copy={demoCopy}
          className="hero-workbench"
          siteSurface={siteSurface}
          initialWorkspace="site"
          initialTerminalVisible={false}
          locale={locale}
          theme={theme}
          onThemeChange={onThemeChange}
          onLocaleChange={onLocaleChange}
        />
      </div>
    </section>
  );
}
