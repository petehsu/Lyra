"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useRouter } from "next/navigation";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { SiteCopy, SiteLocale } from "@/lib/i18n";
import type { SiteTheme } from "@/lib/site-preferences";
import { ContactSection } from "./contact-section";
import { DownloadSection } from "./download-section";
import { HeroSection } from "./hero-section";
import { LocalSection } from "./local-section";
import { PricingSection } from "./pricing-section";
import { ProductShowcase } from "./product-showcase";
import { SiteFooter } from "./site-footer";
import { VideoSection } from "./video-section";

gsap.registerPlugin(ScrollTrigger, useGSAP);

type SiteHomeProps = {
  readonly locale: SiteLocale;
  readonly copy: SiteCopy;
};

export function SiteHome({ locale, copy }: SiteHomeProps) {
  const root = useRef<HTMLElement>(null);
  const router = useRouter();
  const [theme, setTheme] = useState<SiteTheme | null>(null);

  useEffect(() => {
    const current =
      document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(current);
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  useEffect(() => {
    const handleWorkbenchSiteActive = (event: Event) => {
      const active = (event as CustomEvent<{ readonly active: boolean }>).detail.active;
      if (!active) {
        const scene = root.current?.querySelector<HTMLElement>(".hero-section");
        if (scene !== null && scene !== undefined) {
          const revealPosition = scene.offsetTop + scene.offsetHeight - window.innerHeight;
          window.scrollTo({ top: revealPosition, behavior: "auto" });
          ScrollTrigger.update();
        }
      }
      document.documentElement.dataset.workbenchSiteActive = active ? "true" : "false";
    };

    window.addEventListener("lyra:workbench-site-active", handleWorkbenchSiteActive);
    return () => {
      window.removeEventListener("lyra:workbench-site-active", handleWorkbenchSiteActive);
      delete document.documentElement.dataset.workbenchSiteActive;
    };
  }, []);

  const handleThemeChange = useCallback((nextTheme: SiteTheme) => {
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    localStorage.setItem("lyra-site-theme", nextTheme);
    setTheme(nextTheme);
    window.requestAnimationFrame(() => ScrollTrigger.refresh());
  }, []);

  const handleLocaleChange = useCallback(
    (nextLocale: SiteLocale) => {
      if (nextLocale === locale) return;
      router.push(`/${nextLocale}${window.location.hash}`);
    },
    [locale, router]
  );

  useGSAP(
    () => {
      const media = gsap.matchMedia();

      media.add(
        "(min-width: 1081px) and (prefers-reduced-motion: no-preference)",
        () => {
          const scene = root.current?.querySelector<HTMLElement>(".hero-section");
          const camera = root.current?.querySelector<HTMLElement>(".hero-workbench-camera");
          const caption = root.current?.querySelector<HTMLElement>(".hero-reveal-caption");
          if (scene === null || scene === undefined
            || camera === null || camera === undefined
            || caption === null || caption === undefined) {
            return;
          }

          const frameRatio = 1.44;
          const readInset = (property: string, fallback: number) => {
            const frame = camera.querySelector<HTMLElement>(".real-workbench-frame");
            if (frame === null) return fallback;
            const parsed = Number.parseFloat(
              getComputedStyle(frame).getPropertyValue(property)
            );
            return Number.isFinite(parsed) ? parsed : fallback;
          };
          const measure = () => {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const contentLeft = readInset("--workbench-site-left", 420);
            const contentTop = readInset("--workbench-site-top", 34);
            const contentRight = readInset("--workbench-site-right", 0);
            const finalWidth = Math.min(
              1280,
              viewportWidth - 64,
              (viewportHeight - 112) * frameRatio
            );
            const finalHeight = finalWidth / frameRatio;
            const initialWidth = viewportWidth + contentLeft + contentRight;
            return {
              initialWidth,
              initialLeft: -contentLeft,
              initialTop: -contentTop,
              finalWidth,
              finalLeft: (viewportWidth - finalWidth) / 2,
              finalTop: (viewportHeight - finalHeight) / 2 - 10
            };
          };

          gsap.set(caption, { autoAlpha: 0, y: 18 });
          const timeline = gsap.timeline({
            defaults: { ease: "none" },
            scrollTrigger: {
              trigger: scene,
              start: "top top",
              end: "bottom bottom",
              scrub: 0.55,
              invalidateOnRefresh: true,
              refreshPriority: -10
            }
          });

          timeline.fromTo(
            camera,
            {
              left: () => measure().initialLeft,
              top: () => measure().initialTop,
              width: () => measure().initialWidth
            },
            {
              left: () => measure().finalLeft,
              top: () => measure().finalTop,
              width: () => measure().finalWidth,
              duration: 1
            },
            0
          ).to(
            caption,
            { autoAlpha: 1, y: 0, duration: 0.18 },
            0.77
          );

          const refreshGeometry = () => ScrollTrigger.refresh();
          window.addEventListener("lyra:workbench-geometry", refreshGeometry);

          return () => {
            window.removeEventListener("lyra:workbench-geometry", refreshGeometry);
            timeline.scrollTrigger?.kill();
            timeline.kill();
          };
        }
      );

      media.add(
        "(prefers-reduced-motion: no-preference)",
        () => {
          gsap.from(".site-header-embedded", {
            y: -10,
            autoAlpha: 0,
            duration: 0.6,
            ease: "power2.out"
          });
          gsap.from(".hero-enter", {
            y: 24,
            autoAlpha: 0,
            duration: 0.75,
            ease: "power3.out",
            delay: 0.1
          });

          ScrollTrigger.batch(".drop-reveal", {
            start: "top 86%",
            once: true,
            onEnter: (elements) => {
              gsap.from(elements, {
                y: 28,
                autoAlpha: 0,
                duration: 0.65,
                ease: "power2.out",
                stagger: 0.08,
                overwrite: true
              });
            }
          });
        }
      );

      return () => media.revert();
    },
    { scope: root }
  );

  return (
    <main ref={root} className="site-shell" lang={locale === "zh" ? "zh-CN" : "en"}>
      <HeroSection
        locale={locale}
        nav={copy.nav}
        copy={copy.hero}
        theme={theme}
        onThemeChange={handleThemeChange}
        onLocaleChange={handleLocaleChange}
      />
      <ProductShowcase copy={copy.product} sectionId="product" />
      <LocalSection copy={copy.local} sectionId="local" />
      <VideoSection copy={copy.video} />
      <PricingSection copy={copy.pricing} />
      <DownloadSection copy={copy.download} />
      <ContactSection copy={copy.contact} />
      <SiteFooter locale={locale} copy={copy.footer} />
    </main>
  );
}
