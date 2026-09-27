"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import Lenis from "lenis";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { SiteCopy, SiteLocale } from "@/lib/i18n";
import { getDictionary, isSiteLocale } from "@/lib/i18n";
import type { SiteTheme } from "@/lib/site-preferences";
import { getWorkbenchCameraFrame, getWorkbenchFlowLayout, getWorkbenchFlowOffset, getWorkbenchFrameSize, getWorkbenchRevealState } from "@/lib/workbench-reveal";
import { clampSiteScrollTarget, createSiteWheelMotion, getSiteWheelDelta, rebaseWorkbenchScroll, SITE_SCROLL_DURATION, siteScrollEase } from "@/lib/site-scroll";
import { ContactSection } from "./contact-section";
import { DownloadSection } from "./download-section";
import { HeroSection } from "./hero-section";
import { SiteAgentCursor } from "./site-agent-cursor";
import { PricingSection } from "./pricing-section";
import { SiteFooter } from "./site-footer";

gsap.registerPlugin(ScrollTrigger, useGSAP);

type SiteHomeProps = {
  readonly locale: SiteLocale;
  readonly copy: SiteCopy;
};

export function SiteHome({ locale: routeLocale }: SiteHomeProps) {
  const root = useRef<HTMLElement>(null);
  const hiddenStoryDistance = useRef(0);
  const [locale, setLocale] = useState(routeLocale);
  const copy = getDictionary(locale);
  const [theme, setTheme] = useState<SiteTheme | null>(null);

  useEffect(() => {
    const current =
      document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(current);
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  useEffect(() => {
    const navigate = () => {
      const language = location.pathname.split("/")[1];
      if (isSiteLocale(language)) setLocale(language);
    };
    window.addEventListener("popstate", navigate);
    return () => window.removeEventListener("popstate", navigate);
  }, []);

  useEffect(() => {
    let smoother: Lenis | null = null;
    const wheelMotion = createSiteWheelMotion();
    const motion = window.matchMedia("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)");
    const tick = () => smoother?.raf(performance.now());
    const syncScroll = () => ScrollTrigger.update();
    const configureSmoothing = () => {
      gsap.ticker.remove(tick);
      smoother?.destroy();
      smoother = null;
      wheelMotion.reset();
      if (!motion.matches) return;
      smoother = new Lenis({
        autoRaf: false,
        smoothWheel: true,
        syncTouch: false,
        lerp: 0,
        duration: SITE_SCROLL_DURATION,
        easing: siteScrollEase,
        // Do not take over controls, dialogs or the embedded desktop's scroll.
        prevent: node => node.matches("input, textarea, select, [role='dialog'], [data-native-scroll]"),
        virtualScroll: data => {
          if (data.event.defaultPrevented || data.event.ctrlKey) return false;
          if (data.event.type === "wheel" && smoother && data.deltaY !== 0) {
            const delta = getSiteWheelDelta(smoother.animatedScroll, smoother.targetScroll, data.deltaY, null);
            if (delta === 0 && data.deltaY < 0) {
              data.event.preventDefault();
              return false;
            }
            const motion = wheelMotion.sample(data.deltaY, performance.now());
            smoother.options.duration = motion.duration;
            smoother.options.easing = motion.easing;
            data.deltaY = delta;
          }
          return true;
        }
      });
      smoother.on("scroll", syncScroll);
      // One clock for scrolling and the camera, with no second scrub delay.
      // Wall time also keeps the tail finite after a background-tab pause.
      gsap.ticker.add(tick);
    };
    const cancelMomentum = () => {
      wheelMotion.reset();
      if (smoother?.isScrolling === "smooth") {
        smoother.scrollTo(window.scrollY, { immediate: true });
      }
    };
    const blockOuterScrollKeys = (event: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Space"].includes(event.code)) {
        cancelMomentum();
      }
    };
    const handleStoryAnchor = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>('a[href^="#"]');
      const hash = anchor?.getAttribute("href") ?? "";
      if (hash.length < 2) return;

      const story = root.current?.querySelector<HTMLElement>(".hero-site-story");
      const destination = document.getElementById(hash.slice(1));
      const scene = root.current?.querySelector<HTMLElement>(".hero-section");
      if (
        story === null || story === undefined
        || scene === null || scene === undefined
        || destination === null
      ) {
        return;
      }
      const inStory = story.contains(destination);
      if (!inStory && !smoother) return;

      event.preventDefault();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}${hash}`
      );
      const targetTop = clampSiteScrollTarget(
        inStory ? scene.offsetTop + destination.offsetTop : window.scrollY + destination.getBoundingClientRect().top,
        null
      );
      if (smoother) smoother.scrollTo(targetTop, { duration: SITE_SCROLL_DURATION, easing: siteScrollEase });
      else window.scrollTo({
        top: targetTop,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
      });
    };
    const handleWorkbenchSiteActive = (event: Event) => {
      const active = (event as CustomEvent<{ readonly active: boolean }>).detail.active;
      const shell = root.current;
      if (!shell) return;
      cancelMomentum();
      // Remove the preceding scroll range, not the input. The browser's real
      // scrollTop=0 is now the workspace boundary, including iframe wheel
      // chaining, touch, keyboard and scrollbar dragging. No snap-back loop.
      const { prefix: nextDistance, scroll: nextScroll } = rebaseWorkbenchScroll(
        window.scrollY, hiddenStoryDistance.current, active
      );
      hiddenStoryDistance.current = nextDistance;
      shell.style.marginTop = `${-nextDistance}px`;
      window.scrollTo({ top: nextScroll, behavior: "instant" });
      smoother?.resize();
      smoother?.scrollTo(nextScroll, { immediate: true, force: true });
      ScrollTrigger.refresh();
      ScrollTrigger.update();
      document.documentElement.dataset.workbenchSiteActive = active ? "true" : "false";
    };

    window.addEventListener("lyra:workbench-site-active", handleWorkbenchSiteActive);
    window.addEventListener("keydown", blockOuterScrollKeys);
    root.current?.addEventListener("click", handleStoryAnchor);
    window.addEventListener("pointerdown", cancelMomentum, { passive: true });
    window.addEventListener("blur", cancelMomentum);
    motion.addEventListener("change", configureSmoothing);
    configureSmoothing();
    return () => {
      motion.removeEventListener("change", configureSmoothing);
      window.removeEventListener("pointerdown", cancelMomentum);
      window.removeEventListener("blur", cancelMomentum);
      gsap.ticker.remove(tick);
      smoother?.destroy();
      window.removeEventListener("lyra:workbench-site-active", handleWorkbenchSiteActive);
      window.removeEventListener("keydown", blockOuterScrollKeys);
      root.current?.removeEventListener("click", handleStoryAnchor);
      root.current?.style.removeProperty("margin-top");
      hiddenStoryDistance.current = 0;
      delete document.documentElement.dataset.workbenchSiteActive;
    };
  }, []);

  const handleThemeChange = useCallback((nextTheme: SiteTheme) => {
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    localStorage.setItem("lyra-site-theme", nextTheme);
    setTheme(nextTheme);
  }, []);

  const handleLocaleChange = useCallback(
    (nextLocale: SiteLocale) => {
      setLocale(nextLocale);
      // A language preference is not a new workspace. Keep the iframe, tabs,
      // panel geometry, scroll boundary and film clock mounted.
      window.history.replaceState(window.history.state, "", `/${nextLocale}${window.location.search}${window.location.hash}`);
      document.title = getDictionary(nextLocale).metadata.title;
    },
    []
  );

  useGSAP(
    () => {
      const media = gsap.matchMedia();

      media.add(
        "(min-width: 1081px) and (prefers-reduced-motion: no-preference)",
        () => {
          const scene = root.current?.querySelector<HTMLElement>(".hero-section");
          const sticky = scene?.querySelector<HTMLElement>(".hero-portal-sticky");
          const flow = scene?.querySelector<HTMLElement>(".hero-scene-flow");
          const camera = root.current?.querySelector<HTMLElement>(".hero-workbench-camera");
          const caption = root.current?.querySelector<HTMLElement>(".hero-reveal-caption");
          const story = root.current?.querySelector<HTMLElement>(".hero-site-story");
          const productSection = story?.querySelector<HTMLElement>(".product-section");
          const localSection = story?.querySelector<HTMLElement>(".local-section");
          if (scene === null || scene === undefined
            || !sticky || !flow
            || camera === null || camera === undefined
            || caption === null || caption === undefined
            || story === null || story === undefined
            || productSection === null || productSection === undefined
            || localSection === null || localSection === undefined) {
            return;
          }

          const readInset = (property: string, fallback: number) => {
            const frame = camera.querySelector<HTMLElement>(".real-workbench-frame");
            if (frame === null) return fallback;
            const parsed = Number.parseFloat(
              getComputedStyle(frame).getPropertyValue(property)
            );
            return Number.isFinite(parsed) ? parsed : fallback;
          };
          const measureCamera = () => {
            const viewportWidth = document.documentElement.clientWidth;
            const viewportHeight = window.innerHeight;
            const contentLeft = readInset("--workbench-site-left", 420);
            const contentTop = readInset("--workbench-site-top", 34);
            const contentRight = readInset("--workbench-site-right", 0);
            const contentBottom = readInset("--workbench-site-bottom", 62);
            // Keep a desktop-width renderer even on shorter screens. Forcing
            // a fixed aspect ratio pushed it below the app's 980px breakpoint.
            const { width: finalWidth, height: finalHeight } = getWorkbenchFrameSize(viewportWidth, viewportHeight);
            return {
              width: finalWidth,
              height: finalHeight,
              viewportWidth,
              viewportHeight,
              contentLeft,
              contentTop,
              contentWidth: Math.max(1, finalWidth - contentLeft - contentRight),
              contentHeight: Math.max(1, finalHeight - contentTop - contentBottom)
            };
          };
          type RevealMetrics = ReturnType<typeof measureCamera> & {
            readonly storyDistance: number;
            readonly revealStart: number;
            readonly revealDistance: number;
            readonly totalDistance: number;
          };
          const readLocalTop = () => localSection.offsetTop;
          const readMetrics = (): RevealMetrics => {
            const cameraMetrics = measureCamera();
            camera.style.width = `${cameraMetrics.width}px`;
            camera.style.height = `${cameraMetrics.height}px`;
            story.style.width = `${getWorkbenchCameraFrame(cameraMetrics, 0, 0).storyWidth}px`;
            // Measure in layout pixels, independent of the compositor scale.
            productSection.style.removeProperty("height");
            const productHeight = productSection.offsetHeight;
            productSection.style.height = `${productHeight}px`;
            const viewportHeight = window.innerHeight;
            const localRestTop = viewportHeight * 0.16;
            const localTop = readLocalTop();
            const storyDistance = Math.max(0, localTop - localRestTop);
            const revealStart = Math.max(0, storyDistance - viewportHeight * 0.54);
            const revealDistance = viewportHeight * 1.18;
            return {
              ...cameraMetrics,
              storyDistance,
              revealStart,
              revealDistance,
              totalDistance: Math.max(
                storyDistance,
                revealStart + revealDistance
              )
            };
          };
          let metrics = readMetrics();
          const readFlowHeight = () => flow.getBoundingClientRect().height;
          let flowLayout = getWorkbenchFlowLayout(window.innerHeight, readFlowHeight(), metrics.totalDistance);
          const syncMetrics = () => {
            metrics = readMetrics();
            flowLayout = getWorkbenchFlowLayout(window.innerHeight, readFlowHeight(), metrics.totalDistance);
            sticky.style.height = `${flowLayout.stickyHeight}px`;
            scene.style.height = `${flowLayout.sceneHeight}px`;
            camera.style.width = `${metrics.width}px`;
            camera.style.height = `${metrics.height}px`;
          };
          const animationState = { progress: 0 };
          const readRevealState = () => getWorkbenchRevealState(
            animationState.progress * flowLayout.release / metrics.totalDistance, metrics
          );
          const renderReveal = () => {
            const {
              cameraProgress: revealProgress,
              captionProgress,
              storyTravel
            } = readRevealState();
            const frame = getWorkbenchCameraFrame(metrics, revealProgress, storyTravel);
            const flowY = getWorkbenchFlowOffset(animationState.progress * flowLayout.release, flowLayout.release, flowLayout.handoffDistance);
            flow.style.transform = `translate3d(0, ${flowY}px, 0)`;
            camera.style.transform = `translate3d(${frame.x}px, ${frame.y}px, 0) scale(${frame.scale})`;
            story.style.width = `${frame.storyWidth}px`;
            story.style.transform = `translate3d(0, ${frame.storyY}px, 0) scale(${frame.storyScale})`;
            caption.style.opacity = String(captionProgress);
            caption.style.visibility = captionProgress > 0 ? "visible" : "hidden";
          };

          syncMetrics();
          renderReveal();
          const revealTween = gsap.to(animationState, {
            progress: 1,
            duration: 1,
            ease: "none",
            onUpdate: renderReveal,
            scrollTrigger: {
              trigger: scene,
              start: "top top",
              // The film belongs to this scene but not to the pinned reading range.
              end: () => `+=${flowLayout.release}`,
              scrub: true,
              onRefreshInit: syncMetrics,
              onRefresh: renderReveal,
              refreshPriority: -10
            }
          });

          const refreshGeometry = () => {
            // Actual panel drags still update the live overlay. Unlike camera
            // zooming, these are real workspace geometry changes.
            metrics = { ...metrics, ...measureCamera() };
            renderReveal();
          };
          window.addEventListener("lyra:workbench-geometry", refreshGeometry);

          let lastFlowHeight = readFlowHeight();
          let sizeFrame = 0;
          const flowObserver = new ResizeObserver(() => {
            const height = readFlowHeight();
            if (height === lastFlowHeight) return;
            lastFlowHeight = height;
            cancelAnimationFrame(sizeFrame);
            sizeFrame = requestAnimationFrame(() => ScrollTrigger.refresh());
          });
          flowObserver.observe(flow);

          return () => {
            flowObserver.disconnect();
            cancelAnimationFrame(sizeFrame);
            window.removeEventListener("lyra:workbench-geometry", refreshGeometry);
            scene.style.removeProperty("height");
            sticky.style.removeProperty("height");
            flow.style.removeProperty("transform");
            story.style.removeProperty("transform");
            story.style.removeProperty("width");
            productSection.style.removeProperty("height");
            camera.style.removeProperty("left");
            camera.style.removeProperty("top");
            camera.style.removeProperty("width");
            camera.style.removeProperty("height");
            camera.style.removeProperty("transform");
            caption.style.removeProperty("opacity");
            caption.style.removeProperty("visibility");
            revealTween.scrollTrigger?.kill();
            revealTween.kill();
          };
        }
      );

      return () => media.revert();
    },
    { scope: root }
  );

  return (
    <main ref={root} className="site-shell" lang={locale === "zh" ? "zh-CN" : "en"}>
      <SiteAgentCursor scope={root} />
      <HeroSection
        locale={locale}
        nav={copy.nav}
        copy={copy.hero}
        product={copy.product}
        local={copy.local}
        video={copy.video}
        theme={theme}
        onThemeChange={handleThemeChange}
        onLocaleChange={handleLocaleChange}
      />
      <PricingSection copy={copy.pricing} />
      <DownloadSection copy={copy.download} />
      <ContactSection copy={copy.contact} />
      <SiteFooter locale={locale} copy={copy.footer} />
    </main>
  );
}
