"use client";

import { useEffect, useRef } from "react";
import type { SiteCopy, SiteLocale } from "@/lib/i18n";
import { HeroLandscape } from "./hero-landscape";
import { PricingSection } from "./pricing-section";
import { DownloadSection } from "./download-section";

// The same site content without nested demos, animation players or preference writes.
export function FilmWebsitePreview({ copy, locale, theme }: { copy: SiteCopy; locale: SiteLocale; theme: "light" | "dark" }) {
  const stage = useRef("home");
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = locale;
    document.documentElement.style.colorScheme = theme;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== parent || event.data?.type !== "lyra-film-page") return;
      const next = event.data.stage;
      if (!["home", "pricing", "download"].includes(next) || stage.current === next) return;
      stage.current = next;
      document.getElementById(next)?.scrollIntoView({ behavior: "instant", block: "start" });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [locale, theme]);
  return <main className="film-website-preview">
    <section id="home" className="hero-site-surface">
      <HeroLandscape />
      <header className="film-preview-header"><img src="/lyra-mark.svg" alt="" /> LYRA</header>
      <div className="hero-site-page"><div className="hero-copy"><h1>{copy.hero.title}</h1></div></div>
    </section>
    <PricingSection copy={copy.pricing} />
    <DownloadSection copy={copy.download} />
  </main>;
}
