import { JSDOM, type DOMWindow } from "jsdom";
import { describe, expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class FakeBrowserWindow {}
}));

import { buildRenderedSnapshotScript } from "../view-manager-runtime/rendered-snapshot-runtime";

type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const installGeometry = (window: DOMWindow): void => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
  Object.defineProperty(window, "CSS", {
    configurable: true,
    value: {
      escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/gu, "\\$&")
    }
  });
  Object.defineProperty(window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value() {
      const raw = (this as HTMLElement).getAttribute("data-rect");
      const [x = 0, y = 0, width = 0, height = 0] = raw
        ?.split(",")
        .map((part) => Number(part.trim())) ?? [];
      return {
        x,
        y,
        width,
        height,
        top: y,
        left: x,
        right: x + width,
        bottom: y + height,
        toJSON: () => ({ x, y, width, height })
      };
    }
  });
};

const setImageNaturalSize = (
  window: DOMWindow,
  selector: string,
  size: { readonly width: number; readonly height: number }
): void => {
  const image = window.document.querySelector(selector) as HTMLImageElement | null;
  if (image === null) return;
  Object.defineProperty(image, "naturalWidth", { configurable: true, value: size.width });
  Object.defineProperty(image, "naturalHeight", { configurable: true, value: size.height });
};

const evaluateSnapshot = (html: string): Record<string, unknown> => {
  const dom = new JSDOM(html, {
    url: "https://example.test/ref",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  installGeometry(dom.window);
  setImageNaturalSize(dom.window, "img.hero-image", { width: 960, height: 640 });
  const script = buildRenderedSnapshotScript({
    includeDesignReference: true,
    includeMedia: true,
    maxDesignElements: 200
  }, "https://example.test/ref", 500_000);
  return dom.window.eval(script) as Record<string, unknown>;
};

describe("rendered snapshot design reference extraction", () => {
  test("extracts computed tokens, layout bounds, component samples, and assets", () => {
    const snapshot = evaluateSnapshot(`
      <!doctype html>
      <html>
        <head>
          <title>Reference</title>
          <link rel="preconnect" href="https://fonts.googleapis.com">
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap">
          <link rel="icon" href="/favicon.svg" sizes="any">
          <meta property="og:image" content="/og.png">
        </head>
        <body data-rect="0,0,1200,1600" style="margin:0;background:rgb(246, 243, 235);color:rgb(21, 24, 30);font-family:Inter, sans-serif;">
          <header class="site-header" data-rect="0,0,1200,72" style="position:sticky;top:0;background:rgb(21, 24, 30);color:rgb(255,255,255);padding:16px 40px;transition:background-color 200ms ease;z-index:10;">
            <nav data-rect="40,16,1120,40" style="display:flex;gap:24px;align-items:center;">
              <a href="/work" data-rect="64,24,80,28" style="color:rgb(255,255,255);font-size:14px;">Work</a>
              <a href="/about" data-rect="160,24,80,28" style="color:rgb(255,255,255);font-size:14px;">About</a>
            </nav>
          </header>
          <main data-rect="0,72,1200,720" style="max-width:1120px;margin:0 auto;padding:64px 40px;display:grid;grid-template-columns:1.2fr 0.8fr;gap:40px;">
            <section class="hero" data-rect="40,120,620,500" style="padding:48px;border-top-left-radius:24px;border-top-right-radius:24px;border-bottom-right-radius:24px;border-bottom-left-radius:24px;background:rgb(255,255,255);box-shadow:rgba(15, 23, 42, 0.16) 0px 24px 80px;">
              <h1 data-rect="88,168,520,96" style="font-size:56px;line-height:60px;font-weight:700;letter-spacing:0px;color:rgb(21, 24, 30);">Structured reference</h1>
              <p data-rect="88,288,480,64" style="font-size:18px;line-height:28px;color:rgb(79, 87, 99);">Exact CSS values instead of a generic mockup.</p>
              <a class="cta" href="/start" data-rect="88,384,152,48" style="display:inline-flex;align-items:center;background:rgb(20, 112, 99);color:rgb(255,255,255);padding:14px 20px;border-radius:999px;font-weight:700;text-decoration:none;">Start</a>
            </section>
            <article class="feature-card" data-rect="700,140,360,360" style="padding:24px;border:1px solid rgb(214, 205, 190);border-top-left-radius:18px;border-top-right-radius:18px;border-bottom-right-radius:18px;border-bottom-left-radius:18px;background:rgb(252, 250, 245);">
              <img class="hero-image" src="/hero.png" alt="Layered product UI" data-rect="724,164,312,208" style="display:block;width:312px;height:208px;object-fit:cover;border-top-left-radius:12px;border-top-right-radius:12px;border-bottom-right-radius:12px;border-bottom-left-radius:12px;">
              <div class="visual" data-rect="724,396,312,72" style="background-image:url('/pattern.png');background-size:cover;border-top-left-radius:12px;border-top-right-radius:12px;border-bottom-right-radius:12px;border-bottom-left-radius:12px;"></div>
            </article>
          </main>
          <section class="snap" data-rect="0,900,1200,300" style="scroll-snap-type:y mandatory;">
            <button data-rect="40,940,96,40" style="border-radius:8px;padding:10px 16px;background:rgb(21, 24, 30);color:rgb(255,255,255);">Save</button>
            <input data-rect="160,940,180,40" placeholder="Email" style="border:1px solid rgb(214, 205, 190);border-radius:8px;padding:10px 12px;">
            <svg data-rect="360,940,24,24" viewBox="0 0 24 24" aria-label="Mark"><title>Mark</title></svg>
          </section>
        </body>
      </html>
    `);

    const report = snapshot.designReference as Record<string, unknown>;
    const tokens = report.tokens as Partial<Record<string, Array<{ readonly value: string; readonly count: number }>>>;
    const sections = report.sections as Array<Record<string, unknown>>;
    const components = report.components as Partial<Record<string, Array<Record<string, unknown>>>>;
    const assets = report.assets as Record<string, unknown>;
    const foundations = report.foundations as Partial<Record<string, Array<Record<string, unknown>>>>;
    const interactionSignals = report.interactionSignals as Record<string, unknown>;
    const colors = tokens.colors ?? [];
    const fontFamilies = tokens.fontFamilies ?? [];
    const spacing = tokens.spacing ?? [];
    const radius = tokens.radius ?? [];
    const buttons = components.buttons ?? [];
    const cards = components.cards ?? [];
    const images = (assets.images as Array<Record<string, unknown>> | undefined) ?? [];
    const backgroundImages = (assets.backgroundImages as Array<Record<string, unknown>> | undefined) ?? [];
    const fontLinks = foundations.fontLinks ?? [];
    const faviconLinks = foundations.faviconLinks ?? [];
    const stickyOrFixed = (interactionSignals.stickyOrFixed as Array<Record<string, unknown>> | undefined) ?? [];
    const transitionSamples = (interactionSignals.transitionSamples as Array<Record<string, unknown>> | undefined) ?? [];
    const scrollSnap = (interactionSignals.scrollSnap as Array<Record<string, unknown>> | undefined) ?? [];

    expect(report.status).toBe("ok");
    expect(colors.some((entry) => entry.value === "rgb(21, 24, 30)")).toBe(true);
    expect(fontFamilies.some((entry) => entry.value.includes("Inter"))).toBe(true);
    expect(spacing.some((entry) => entry.value === "40px")).toBe(true);
    expect(radius.some((entry) => entry.value.includes("24px"))).toBe(true);
    expect(sections.some((section) => section.tag === "main" && (section.areaRatio as number) > 0.5)).toBe(true);
    expect(buttons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        selector: expect.stringContaining("a.cta"),
        text: "Start"
      })
    ]));
    expect(cards.some((card) => (
      ((card.style as Record<string, unknown>).borderRadius as Record<string, unknown>)?.topLeft === "24px"
    ))).toBe(true);
    expect(images[0]).toMatchObject({
      url: "https://example.test/hero.png",
      alt: "Layered product UI",
      naturalWidth: 960,
      naturalHeight: 640
    });
    expect(backgroundImages[0]).toMatchObject({
      urls: ["https://example.test/pattern.png"]
    });
    expect(assets.inlineSvgCount).toBe(1);
    expect(fontLinks.some((entry) => String(entry.href).includes("fonts.googleapis.com"))).toBe(true);
    expect(faviconLinks[0]).toMatchObject({ href: "https://example.test/favicon.svg" });
    expect(interactionSignals).toMatchObject({
      interactiveCount: expect.any(Number)
    });
    expect(stickyOrFixed[0]).toMatchObject({
      selector: expect.stringContaining("header.site-header")
    });
    expect(transitionSamples[0]).toMatchObject({
      selector: expect.stringContaining("header.site-header")
    });
    expect(scrollSnap[0]).toMatchObject({
      selector: expect.stringContaining("section.snap")
    });
  });
});
