"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import Lenis from "lenis";
import { useRouter } from "next/navigation";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { SiteCopy, SiteLocale } from "@/lib/i18n";
import type { SiteTheme } from "@/lib/site-preferences";
import { ContactSection } from "./contact-section";
import { DownloadSection } from "./download-section";
import { GradualBlur } from "./gradual-blur";
import {
  HERO_ASCII_MORPH_EVENT,
  type HeroAsciiMorphDetail
} from "./hero-ascii-field";
import { HeroSection } from "./hero-section";
import { LocalSection } from "./local-section";
import { LYRA_DEMO_LAYOUT_EVENT } from "./lyra-workbench-demo";
import { OmaSection } from "./oma-section";
import { PricingSection } from "./pricing-section";
import { ProductShowcase } from "./product-showcase";
import { SiteFooter } from "./site-footer";

gsap.registerPlugin(ScrollTrigger, useGSAP);

type SiteHomeProps = {
  readonly locale: SiteLocale;
  readonly copy: SiteCopy;
};

type OmaMotion = {
  readonly portal: HTMLElement;
  readonly stage: HTMLElement;
  readonly phrase: HTMLElement;
  readonly content: HTMLElement;
  readonly shortTails: readonly HTMLElement[];
  readonly longTails: readonly HTMLElement[];
  baseFontSize: number;
  basePhraseHeight: number;
};

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));
const smoothUnit = (value: number) => value * value * (3 - 2 * value);

const getOmaMotion = (portal: HTMLElement): OmaMotion | null => {
  const stage = portal.querySelector<HTMLElement>(".oma-portal-stage");
  const phrase = portal.querySelector<HTMLElement>(".oma-phrase");
  const content =
    portal.parentElement?.querySelector<HTMLElement>(".oma-content") ?? null;
  if (stage === null || phrase === null || content === null) return null;
  return {
    portal,
    stage,
    phrase,
    content,
    shortTails: Array.from(
      portal.querySelectorAll<HTMLElement>(".oma-tail-short")
    ),
    longTails: Array.from(
      portal.querySelectorAll<HTMLElement>(".oma-tail-long")
    ),
    baseFontSize: Number.parseFloat(getComputedStyle(phrase).fontSize),
    basePhraseHeight: phrase.offsetHeight
  };
};

const measureOmaMotion = (motion: OmaMotion) => {
  motion.phrase.style.removeProperty("font-size");
  motion.baseFontSize = Number.parseFloat(
    getComputedStyle(motion.phrase).fontSize
  );
  motion.basePhraseHeight = motion.phrase.offsetHeight;
};

const applyOmaMotion = (
  motion: OmaMotion,
  progress: number,
  entranceProgress = 1
) => {
  const tailProgress = smoothUnit(
    clampUnit((progress - 0.08) / 0.28)
  );
  const collapseProgress = smoothUnit(
    clampUnit((progress - 0.36) / 0.22)
  );
  const dockProgress = smoothUnit(
    clampUnit((progress - 0.78) / 0.14)
  );
  const tailOpacity = 1 - tailProgress;
  const tailBlur = tailProgress * 18;
  const stageRect = motion.stage.getBoundingClientRect();
  const contentRect = motion.content.getBoundingClientRect();
  const pushProgress = smoothUnit(
    clampUnit(
      (window.innerHeight * 0.84 - contentRect.top)
        / (window.innerHeight * 0.62)
    )
  );
  const fontScale = 1 + pushProgress * 0.9;
  const fontSize =
    Math.round(motion.baseFontSize * fontScale * 4) / 4;
  const phraseHeight =
    motion.basePhraseHeight * fontSize / motion.baseFontSize;
  const lineY = contentRect.top - stageRect.top;
  const dockY =
    lineY
    - 34
    - phraseHeight / 2
    - motion.stage.clientHeight / 2;

  gsap.set(motion.shortTails, {
    filter: `blur(${tailBlur}px)`,
    opacity: tailOpacity,
    width: `${0.62 * (1 - collapseProgress)}em`
  });
  gsap.set(motion.longTails, {
    filter: `blur(${tailBlur}px)`,
    opacity: tailOpacity,
    width: `${2.65 * (1 - collapseProgress)}em`
  });
  gsap.set(motion.phrase, {
    columnGap: `${0.18 - collapseProgress * 0.16}em`,
    filter: "none",
    fontSize,
    force3D: false,
    opacity: entranceProgress,
    scale: 1,
    visibility: entranceProgress > 0.001 ? "visible" : "hidden",
    y: Math.round(dockY * dockProgress * 2) / 2
  });
};

const clearOmaMotion = (motion: OmaMotion) => {
  gsap.set(
    [
      motion.stage,
      motion.phrase,
      ...motion.shortTails,
      ...motion.longTails
    ],
    { clearProps: "all" }
  );
};

function SiteStory({
  copy,
  anchored = false
}: {
  readonly copy: SiteCopy;
  readonly anchored?: boolean;
}) {
  return (
    <>
      <ProductShowcase
        copy={copy.product}
        sectionId={anchored ? "product" : undefined}
      />
      <OmaSection
        copy={copy.oma}
        sectionId={anchored ? "oma" : undefined}
      />
      <LocalSection
        copy={copy.local}
        sectionId={anchored ? "local" : undefined}
      />
    </>
  );
}

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
      let smoothScroll: Lenis | null = null;

      media.add("(prefers-reduced-motion: no-preference)", () => {
        const lenis = new Lenis({
          lerp: 0.085,
          smoothWheel: true,
          syncTouch: false,
          wheelMultiplier: 0.9,
          anchors: true,
          allowNestedScroll: true
        });
        smoothScroll = lenis;
        const updateSmoothScroll = (time: number) => lenis.raf(time * 1000);
        lenis.on("scroll", ScrollTrigger.update);
        gsap.ticker.add(updateSmoothScroll);
        gsap.ticker.lagSmoothing(0);

        gsap
          .timeline({ defaults: { duration: 0.75, ease: "power3.out" } })
          .from(".site-header-embedded", { y: -12, opacity: 0 })
          .from(".hero-enter", { y: -28, opacity: 0, stagger: 0.08 }, "-=0.35")

        const omaEntries = gsap.utils
          .toArray<HTMLElement>(".oma-portal")
          .filter(
            (portal) =>
              portal.closest(".hero-site-document") === null
              && portal.offsetParent !== null
          )
          .flatMap((portal) => {
            const motion = getOmaMotion(portal);
            if (motion === null) return [];
            const syncMotion = () => {
              const portalRect = portal.getBoundingClientRect();
              const viewportHeight = window.innerHeight;
              const portalTravel = Math.max(
                1,
                portal.offsetHeight - viewportHeight
              );
              const progress = clampUnit(-portalRect.top / portalTravel);

              gsap.set(motion.stage, { y: 0 });
              applyOmaMotion(motion, progress, 1);
            };

            syncMotion();
            const trigger = ScrollTrigger.create({
              trigger: portal,
              start: "top bottom",
              end: "bottom top",
              onRefresh: () => {
                measureOmaMotion(motion);
                syncMotion();
              },
              onUpdate: syncMotion
            });
            return [{ motion, trigger }];
          });

        gsap.utils.toArray<HTMLElement>(".drop-reveal")
          .filter((element) => element.closest(".hero-site-document") === null)
          .forEach((element) => {
            gsap.from(element, {
              y: -54,
              opacity: 0,
              duration: 0.9,
              ease: "power3.out",
              scrollTrigger: {
                trigger: element,
                start: "top 84%",
                once: true
              }
            });
          });

        return () => {
          omaEntries.forEach(({ motion, trigger }) => {
            trigger.kill();
            clearOmaMotion(motion);
          });
          gsap.ticker.remove(updateSmoothScroll);
          gsap.ticker.lagSmoothing(500, 33);
          lenis.destroy();
          if (smoothScroll === lenis) smoothScroll = null;
        };
      });

      media.add(
        "(min-width: 1081px) and (min-aspect-ratio: 4 / 5) and (prefers-reduced-motion: no-preference)",
        () => {
          const scene = root.current?.querySelector<HTMLElement>(".hero-section");
          const workbench = root.current?.querySelector<HTMLElement>(".hero-workbench");
          const frame = root.current?.querySelector<HTMLElement>(
            ".hero-workbench .lyra-demo-scroll"
          );
          const windowElement = root.current?.querySelector<HTMLElement>(
            ".hero-workbench .lyra-demo-window"
          );
          const surface = root.current?.querySelector<HTMLElement>(
            ".hero-workbench .hero-site-surface"
          );
          const siteDocument = root.current?.querySelector<HTMLElement>(
            ".hero-workbench .hero-site-document"
          );
          const siteHeader = root.current?.querySelector<HTMLElement>(
            ".hero-workbench .site-header-embedded"
          );
          const finalSection = root.current?.querySelector<HTMLElement>(
            ".hero-workbench .hero-site-document .local-section"
          );
          const productSection = root.current?.querySelector<HTMLElement>(
            ".hero-workbench .hero-site-document #product"
          );
          const omaSection = root.current?.querySelector<HTMLElement>(
            ".hero-workbench .hero-site-document #oma"
          );
          const heroPage = root.current?.querySelector<HTMLElement>(
            ".hero-workbench .hero-site-page"
          );
          const heroLogoTarget = root.current?.querySelector<HTMLElement>(
            ".hero-workbench .hero-logo-target"
          );
          const storyPanels = Array.from(
            root.current?.querySelectorAll<HTMLElement>(
              ".hero-workbench [data-hero-story-panel]"
            ) ?? []
          );
          const omaPortal = root.current?.querySelector<HTMLElement>(
            ".hero-workbench .oma-portal"
          );
          const omaMotion =
            omaPortal === undefined || omaPortal === null
              ? null
              : getOmaMotion(omaPortal);
          if (scene === undefined || scene === null
            || workbench === undefined || workbench === null
            || frame === undefined || frame === null
            || windowElement === undefined || windowElement === null
            || surface === undefined || surface === null
            || siteDocument === undefined || siteDocument === null
            || siteHeader === undefined || siteHeader === null
            || finalSection === undefined || finalSection === null
            || productSection === undefined || productSection === null
            || omaSection === undefined || omaSection === null
            || heroPage === undefined || heroPage === null
            || heroLogoTarget === undefined || heroLogoTarget === null
            || storyPanels.length !== 4
            || omaPortal === undefined || omaPortal === null
            || omaMotion === null) {
            return;
          }

          let geometry = {
            morphDistance: 0,
            keywordDistance: 0,
            contentDistance: 0,
            zoomDistance: 0,
            heroTargetX: 0,
            heroTargetY: 0,
            heroTargetWidth: 0,
            heroTargetHeight: 0,
            initialFrameWidth: 0,
            initialSurfaceCenterOffsetX: 0,
            initialSurfaceTopOffsetY: 0,
            initialSurfaceCenterX: 0,
            initialSurfaceTopY: 0,
            finalFrameWidth: 0,
            finalSurfaceCenterOffsetX: 0,
            finalSurfaceTopOffsetY: 0,
            finalSurfaceCenterX: 0,
            finalSurfaceTopY: 0,
            finalStageX: 0,
            finalStageY: 0,
            finalStageWidth: 0,
            finalStageHeight: 0
          };
          const portalProgress = { value: 0 };
          let portalTween: gsap.core.Tween | null = null;

          const applyProgress = (progress: number) => {
            const travel =
              geometry.morphDistance
              + geometry.keywordDistance
              + geometry.contentDistance
              + geometry.zoomDistance;
            const distance = progress * travel;
            const fieldProgress = Math.min(
              1,
              Math.max(0, distance / geometry.morphDistance)
            );
            const keywordProgress = Math.min(
              3,
              Math.max(
                0,
                (
                  distance - geometry.morphDistance
                ) / geometry.keywordDistance * 3
              )
            );
            const keywordStage = Math.min(
              2,
              Math.floor(keywordProgress)
            );
            const keywordStageProgress =
              keywordProgress - keywordStage;
            const transitionProgress = Math.min(
              1,
              keywordStageProgress / 0.35
            );
            const transitionEased =
              transitionProgress
              * transitionProgress
              * (3 - 2 * transitionProgress);
            const shapeProgress =
              keywordProgress >= 3
                ? 3
                : keywordStage + transitionEased;
            const contentProgress = Math.min(
              geometry.contentDistance,
              Math.max(
                0,
                distance
                - geometry.morphDistance
                - geometry.keywordDistance
              )
            );
            const zoomProgress = Math.min(
              1,
              Math.max(
                0,
                (
                  distance
                  - geometry.morphDistance
                  - geometry.keywordDistance
                  - geometry.contentDistance
                ) / geometry.zoomDistance
              )
            );
            const surfaceTheme =
              document.documentElement.dataset.theme === "dark"
                ? "dark"
                : "light";
            siteHeader.dataset.surface = surfaceTheme;
            surface.dataset.surface = surfaceTheme;
            heroPage.style.setProperty(
              "--hero-morph-progress",
              String(fieldProgress)
            );
            const storyIndex = Math.min(
              storyPanels.length - 1,
              Math.floor(keywordProgress)
            );
            const nextStoryIndex = Math.min(
              storyPanels.length - 1,
              storyIndex + 1
            );
            const storyBlendRaw = keywordProgress - storyIndex;
            const storyBlend =
              storyBlendRaw * storyBlendRaw * (3 - 2 * storyBlendRaw);
            storyPanels.forEach((panel, index) => {
              const opacity =
                index === storyIndex
                  ? 1 - storyBlend
                  : index === nextStoryIndex
                    ? storyBlend
                    : 0;
              gsap.set(panel, {
                filter: `blur(${(1 - opacity) * 12}px)`,
                opacity,
                y: (index - keywordProgress) * 96,
                visibility: opacity > 0.001 ? "visible" : "hidden"
              });
            });
            window.dispatchEvent(
              new CustomEvent<HeroAsciiMorphDetail>(
                HERO_ASCII_MORPH_EVENT,
                {
                  detail: {
                    fieldProgress,
                    shapeProgress,
                    target: {
                      x: geometry.heroTargetX,
                      y: geometry.heroTargetY,
                      width: geometry.heroTargetWidth,
                      height: geometry.heroTargetHeight
                    }
                  }
                }
              )
            );
            const omaPortalTravel = Math.max(
              1,
              omaPortal.offsetHeight - heroPage.offsetHeight
            );
            const omaPortalOffset =
              contentProgress - omaPortal.offsetTop;
            const omaProgress = clampUnit(
              omaPortalOffset / omaPortalTravel
            );
            gsap.set(omaMotion.stage, {
              y: Math.min(
                omaPortalTravel,
                Math.max(0, omaPortalOffset)
              )
            });
            applyOmaMotion(omaMotion, omaProgress, 1);
            const normalized = Math.min(
              1,
              Math.max(0, (zoomProgress - 0.03) / 0.94)
            );
            const innerProgress = Math.min(1, normalized / 0.78);
            const stageProgress = Math.min(
              1,
              Math.max(0, (normalized - 0.78) / 0.22)
            );
            const innerEased = innerProgress * innerProgress
              * (3 - 2 * innerProgress);
            const stageEased = stageProgress * stageProgress
              * (3 - 2 * stageProgress);
            const frameWidth = gsap.utils.interpolate(
              geometry.initialFrameWidth,
              geometry.finalFrameWidth,
              innerEased
            );
            const surfaceCenterOffsetX = gsap.utils.interpolate(
              geometry.initialSurfaceCenterOffsetX,
              geometry.finalSurfaceCenterOffsetX,
              innerEased
            );
            const surfaceTopOffsetY = gsap.utils.interpolate(
              geometry.initialSurfaceTopOffsetY,
              geometry.finalSurfaceTopOffsetY,
              innerEased
            );
            const surfaceCenterX = gsap.utils.interpolate(
              geometry.initialSurfaceCenterX,
              geometry.finalSurfaceCenterX,
              innerEased
            );
            const surfaceTopY = gsap.utils.interpolate(
              geometry.initialSurfaceTopY,
              geometry.finalSurfaceTopY,
              innerEased
            );
            const stageX = geometry.finalStageX * stageEased;
            const stageY = geometry.finalStageY * stageEased;
            const stageWidth = gsap.utils.interpolate(
              window.innerWidth,
              geometry.finalStageWidth,
              stageEased
            );
            const stageHeight = gsap.utils.interpolate(
              window.innerHeight,
              geometry.finalStageHeight,
              stageEased
            );
            const frameX = surfaceCenterX - surfaceCenterOffsetX;
            const frameY = surfaceTopY - surfaceTopOffsetY;
            gsap.set(workbench, {
              left: stageX,
              top: stageY,
              width: stageWidth,
              height: stageHeight
            });
            gsap.set(frame, {
              left: frameX - stageX,
              top: frameY - stageY,
              width: frameWidth
            });

            if (zoomProgress === 0) {
              gsap.set(siteDocument, {
                y: -contentProgress
              });
              return;
            }

            const surfaceHeight = surface.clientHeight;
            const visibleTop = Math.max(0, stageY - surfaceTopY);
            const visibleBottom = Math.min(
              surfaceHeight,
              stageY + stageHeight - surfaceTopY
            );
            const targetCenter =
              finalSection.offsetTop + finalSection.offsetHeight / 2;
            gsap.set(siteDocument, {
              y: (visibleTop + visibleBottom) / 2 - targetCenter
            });
          };

          const measure = () => {
            measureOmaMotion(omaMotion);
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const stageInset = 0;
            let finalStageWidth = Math.min(1240, viewportWidth - 48);

            gsap.set(workbench, {
              left: 0,
              top: 0,
              width: viewportWidth,
              height: viewportHeight,
              opacity: 1,
              clearProps: "transform"
            });
            gsap.set(frame, {
              left: stageInset,
              top: stageInset,
              width: finalStageWidth - stageInset * 2
            });
            let windowRect = windowElement.getBoundingClientRect();
            let finalStageHeight = windowRect.height + stageInset * 2;
            const availableHeight = viewportHeight - 112;
            if (finalStageHeight > availableHeight) {
              finalStageWidth = stageInset * 2
                + (finalStageWidth - stageInset * 2)
                * (availableHeight - stageInset * 2)
                / (finalStageHeight - stageInset * 2);
              gsap.set(frame, {
                width: finalStageWidth - stageInset * 2
              });
              windowRect = windowElement.getBoundingClientRect();
              finalStageHeight = windowRect.height + stageInset * 2;
            }

            const finalStageX = (viewportWidth - finalStageWidth) / 2;
            const finalStageY = (viewportHeight - finalStageHeight) / 2 + 12;
            const finalFrameX = finalStageX + stageInset;
            const finalFrameY = finalStageY + stageInset;
            const frameRect = frame.getBoundingClientRect();
            let surfaceRect = surface.getBoundingClientRect();
            const finalSurfaceCenterOffsetX =
              surfaceRect.left + surfaceRect.width / 2 - frameRect.left;
            const finalSurfaceTopOffsetY = surfaceRect.top - frameRect.top;
            const finalFrameWidth = frameRect.width;
            let initialFrameWidth =
              finalFrameWidth * Math.max(
                viewportWidth / surfaceRect.width,
                (viewportHeight + 8) / surfaceRect.height
              );
            gsap.set(frame, { left: 0, top: 0, width: initialFrameWidth });
            let initialFrameRect = frame.getBoundingClientRect();
            surfaceRect = surface.getBoundingClientRect();
            initialFrameWidth *= Math.max(
              viewportWidth / surfaceRect.width,
              (viewportHeight + 8) / surfaceRect.height
            );
            gsap.set(frame, { width: initialFrameWidth });
            initialFrameRect = frame.getBoundingClientRect();
            surfaceRect = surface.getBoundingClientRect();
            gsap.set(siteDocument, { y: 0 });
            const heroLogoTargetRect =
              heroLogoTarget.getBoundingClientRect();
            const morphDistance = viewportHeight * 1.05;
            const keywordDistance = viewportHeight * 5.4;

            const contentDistance = Math.max(
              0,
              finalSection.offsetTop
                + finalSection.offsetHeight / 2
                - viewportHeight / 2
            );
            const zoomDistance = viewportHeight * 1.7;
            scene.style.height =
              `${
                viewportHeight
                + morphDistance
                + keywordDistance
                + contentDistance
                + zoomDistance
              }px`;

            geometry = {
              morphDistance,
              keywordDistance,
              contentDistance,
              zoomDistance,
              heroTargetX:
                heroLogoTargetRect.left - surfaceRect.left,
              heroTargetY:
                heroLogoTargetRect.top - surfaceRect.top,
              heroTargetWidth: heroLogoTargetRect.width,
              heroTargetHeight: heroLogoTargetRect.height,
              initialFrameWidth,
              initialSurfaceCenterOffsetX:
                surfaceRect.left + surfaceRect.width / 2 - initialFrameRect.left,
              initialSurfaceTopOffsetY:
                surfaceRect.top - initialFrameRect.top,
              initialSurfaceCenterX: viewportWidth / 2,
              initialSurfaceTopY: 0,
              finalFrameWidth,
              finalSurfaceCenterOffsetX,
              finalSurfaceTopOffsetY,
              finalSurfaceCenterX:
                finalFrameX + finalSurfaceCenterOffsetX,
              finalSurfaceTopY:
                finalFrameY + finalSurfaceTopOffsetY,
              finalStageX,
              finalStageY,
              finalStageWidth,
              finalStageHeight
            };
            applyProgress(portalProgress.value);
          };

          measure();
          const handleDemoLayoutChange = () => ScrollTrigger.refresh();
          window.addEventListener(
            LYRA_DEMO_LAYOUT_EVENT,
            handleDemoLayoutChange
          );
          portalTween = gsap.to(portalProgress, {
            value: 1,
            ease: "none",
            onUpdate: () => applyProgress(portalProgress.value),
            scrollTrigger: {
              trigger: scene,
              start: "top top",
              end: () =>
                `+=${
                  geometry.morphDistance
                  + geometry.keywordDistance
                  + geometry.contentDistance
                  + geometry.zoomDistance
                }`,
              scrub: 0.65,
              invalidateOnRefresh: true,
              onRefreshInit: measure
            }
          });

          const sceneAnchors = Array.from(
            workbench.querySelectorAll<HTMLAnchorElement>(
              'a[href="#product"], a[href="#oma"], a[href="#local"]'
            )
          );
          const sceneTarget = (hash: string) => {
            if (hash === "#product") return productSection;
            if (hash === "#oma") return omaSection;
            if (hash === "#local") return finalSection;
            return null;
          };
          const scrollToSceneTarget = (hash: string, immediate = false) => {
            const target = sceneTarget(hash);
            const triggerStart = portalTween?.scrollTrigger?.start;
            if (target === null || typeof triggerStart !== "number") return;
            const contentProgress = Math.max(
              0,
              target.offsetTop - siteHeader.offsetHeight - 16
            );
            const targetScroll =
              triggerStart
              + geometry.morphDistance
              + geometry.keywordDistance
              + contentProgress;

            window.history.replaceState(null, "", hash);
            if (smoothScroll !== null) {
              smoothScroll.scrollTo(targetScroll, {
                duration: immediate ? undefined : 2.2,
                immediate,
                force: true
              });
              return;
            }
            window.scrollTo({
              top: targetScroll,
              behavior: immediate ? "auto" : "smooth"
            });
          };
          const handleSceneAnchor = (event: MouseEvent) => {
            if (event.button !== 0
              || event.metaKey
              || event.ctrlKey
              || event.shiftKey
              || event.altKey) {
              return;
            }
            const anchor = event.currentTarget as HTMLAnchorElement;
            event.preventDefault();
            event.stopPropagation();
            scrollToSceneTarget(anchor.hash);
          };
          sceneAnchors.forEach((anchor) => {
            anchor.addEventListener("click", handleSceneAnchor);
          });
          const initialHashFrame = window.requestAnimationFrame(() => {
            if (sceneTarget(window.location.hash) !== null) {
              scrollToSceneTarget(window.location.hash, true);
            }
          });

          return () => {
            window.removeEventListener(
              LYRA_DEMO_LAYOUT_EVENT,
              handleDemoLayoutChange
            );
            window.cancelAnimationFrame(initialHashFrame);
            sceneAnchors.forEach((anchor) => {
              anchor.removeEventListener("click", handleSceneAnchor);
            });
            portalTween?.scrollTrigger?.kill();
            portalTween?.kill();
            scene.style.removeProperty("height");
            siteHeader.removeAttribute("data-surface");
            surface.removeAttribute("data-surface");
            heroPage.style.removeProperty("--hero-morph-progress");
            clearOmaMotion(omaMotion);
            gsap.set(
              [workbench, frame, siteDocument, ...storyPanels],
              { clearProps: "all" }
            );
          };
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
        demoCopy={copy.demo}
        siteContent={<SiteStory copy={copy} anchored />}
        theme={theme}
        onThemeChange={handleThemeChange}
        onLocaleChange={handleLocaleChange}
      />
      <div className="mobile-site-story">
        <SiteStory copy={copy} />
      </div>
      <PricingSection copy={copy.pricing} />
      <DownloadSection copy={copy.download} />
      <ContactSection copy={copy.contact} />
      <SiteFooter locale={locale} copy={copy.footer} />
      <GradualBlur
        className="site-edge-blur site-edge-blur-bottom"
        position="bottom"
        target="page"
        height="clamp(4.5rem, 10vh, 7.5rem)"
        strength={2.8}
        divCount={8}
        curve="bezier"
        exponential
        opacity={0.92}
        zIndex={15}
      />
    </main>
  );
}
