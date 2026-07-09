import { BrowserWindow, type WebContents } from "electron";

import type { WorkbenchBrowserNavigateRequest } from "../../../shared/desktop-bridge";
import { WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION } from "../../../shared/workbench-browser";
import {
  normalizeAddress,
  runFrameScriptWithTimeout
} from "./normalizers";
import type { BrowserPageEntry } from "./types";

type SnapshotWarning = {
  readonly code: string;
  readonly message: string;
};

type SnapshotViewport = {
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
};

type RenderedSnapshotRuntimeHost = {
  readonly entries: ReadonlyMap<string, BrowserPageEntry>;
  readonly requireEntry: (tabId: string) => BrowserPageEntry;
  readonly navigateInEntry: (
    entry: BrowserPageEntry,
    request: WorkbenchBrowserNavigateRequest
  ) => Promise<unknown>;
  readonly getActiveOrFocusedTabId: () => string | null;
  readonly waitForPageLoad: (
    webContents: WebContents,
    url: string,
    timeoutMs: number
  ) => Promise<void>;
};

const snapshotRecord = (payload: unknown): Record<string, unknown> =>
  payload !== null && typeof payload === "object" ? payload as Record<string, unknown> : {};

const readSnapshotString = (
  request: Record<string, unknown>,
  key: string
): string | undefined => {
  const value = request[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const readSnapshotNumber = (
  request: Record<string, unknown>,
  key: string
): number | undefined => {
  const value = request[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const snapshotTimeoutMs = (request: Record<string, unknown>): number =>
  Math.max(250, Math.min(120_000, Math.round(readSnapshotNumber(request, "timeoutMs") ?? 20_000)));

const snapshotDeadlineMs = (request: Record<string, unknown>): number =>
  Date.now() + snapshotTimeoutMs(request);

const readSnapshotEnvFlag = (name: string): boolean => {
  const value = process.env[name];
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
};

const cdpPageshotEnabled = (): boolean =>
  readSnapshotEnvFlag("LYRA_BROWSER_ENABLE_CDP_PAGESHOT");

const temporarySnapshotRendererEnabled = (): boolean =>
  readSnapshotEnvFlag("LYRA_BROWSER_ENABLE_TEMP_SNAPSHOT_RENDERER");

const remainingSnapshotMs = (
  deadlineMs: number,
  label: string,
  floorMs = 250
): number => {
  const remaining = Math.floor(deadlineMs - Date.now());
  if (remaining <= 0) {
    throw new Error(`browser snapshot timed out before ${label}`);
  }
  return Math.max(floorMs, remaining);
};

const runSnapshotStepWithDeadline = async <T>(
  execute: () => Promise<T>,
  deadlineMs: number,
  label: string
): Promise<T> => {
  const timeoutMs = remainingSnapshotMs(deadlineMs, label);
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`browser snapshot timed out during ${label} after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([execute(), timeout]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
};

const snapshotMode = (request: Record<string, unknown>): "matchingOrNewTab" | "activeTab" | "newTab" => {
  if (request.browserMode === "activeTab") return "activeTab";
  if (request.browserMode === "newTab") return "newTab";
  return "matchingOrNewTab";
};

const snapshotWaitUntil = (
  request: Record<string, unknown>
): "html" | "loadIdle" | "textStable" | "textChanged" | "textContains" => {
  if (request.waitUntil === "html") return "html";
  if (request.waitUntil === "textStable") return "textStable";
  if (request.waitUntil === "textChanged") return "textChanged";
  if (request.waitUntil === "textContains") return "textContains";
  return "loadIdle";
};

const snapshotViewport = (
  request: Record<string, unknown>
): SnapshotViewport | null => {
  const raw = request.viewport;
  if (raw === null || typeof raw !== "object") {
    if (request.mobile === true) {
      return { width: 390, height: 844, deviceScaleFactor: 3 };
    }
    return null;
  }
  const record = raw as Record<string, unknown>;
  const width = typeof record.width === "number" && Number.isFinite(record.width)
    ? Math.max(240, Math.min(5_000, Math.round(record.width)))
    : undefined;
  const height = typeof record.height === "number" && Number.isFinite(record.height)
    ? Math.max(240, Math.min(10_000, Math.round(record.height)))
    : undefined;
  if (width === undefined || height === undefined) {
    return request.mobile === true ? { width: 390, height: 844, deviceScaleFactor: 3 } : null;
  }
  const rawScale = typeof record.deviceScaleFactor === "number" && Number.isFinite(record.deviceScaleFactor)
    ? record.deviceScaleFactor
    : request.mobile === true ? 3 : 1;
  return {
    width,
    height,
    deviceScaleFactor: Math.max(0.5, Math.min(4, rawScale))
  };
};

const comparableSnapshotUrl = (value: string): string =>
  value.trim().replace(/\/+$/u, "").toLowerCase();

const runRenderedSnapshotWait = async (
  webContents: WebContents,
  request: Record<string, unknown>,
  warnings: SnapshotWarning[],
  deadlineMs: number
): Promise<void> => {
  const waitForSelector = readSnapshotString(request, "waitForSelector");
  const waitUntil = snapshotWaitUntil(request);
  const waitText = readSnapshotString(request, "waitText");
  const idleMs = Math.max(50, Math.min(5_000, Math.round(readSnapshotNumber(request, "idleMs") ?? 800)));

  if (waitForSelector !== undefined) {
    const timeoutMs = remainingSnapshotMs(deadlineMs, "waitForSelector");
    const selectorResult = await runFrameScriptWithTimeout(
      () => webContents.executeJavaScript(`
        (() => new Promise((resolve) => {
          const selector = ${JSON.stringify(waitForSelector)};
          const startedAt = Date.now();
          const deadline = startedAt + ${timeoutMs};
          const tick = () => {
            let matched = false;
            try { matched = document.querySelector(selector) !== null; } catch {}
            if (matched || Date.now() >= deadline) {
              resolve({ matched, elapsedMs: Date.now() - startedAt });
              return;
            }
            setTimeout(tick, 100);
          };
          tick();
        }))()
      `, true),
      timeoutMs
    ) as Record<string, unknown>;
    if (selectorResult.matched !== true) {
      warnings.push({ code: "browser_wait_timeout", message: `waitForSelector timed out: ${waitForSelector}` });
    }
  }

  if (waitUntil === "html") {
    return;
  }
  if (waitUntil === "textContains" && waitText === undefined) {
    warnings.push({
      code: "browser_wait_text_missing",
      message: "waitUntil=textContains was requested without waitText/queryFocus text"
    });
    return;
  }

  const timeoutMs = remainingSnapshotMs(deadlineMs, `waitUntil=${waitUntil}`);
  const waitResult = await runFrameScriptWithTimeout(
    () => webContents.executeJavaScript(`
      (() => new Promise((resolve) => {
        const until = ${JSON.stringify(waitUntil)};
        const textNeedle = ${JSON.stringify(waitText ?? "")};
        const idleMs = ${idleMs};
        const startedAt = Date.now();
        const deadline = startedAt + ${timeoutMs};
        const readText = () => String(document.body?.innerText ?? document.body?.textContent ?? "");
        let firstText = readText();
        let previousText = firstText;
        let stableSince = Date.now();
        const tick = () => {
          const text = readText();
          if (until === "textContains" && textNeedle.length > 0 && text.includes(textNeedle)) {
            resolve({ matched: true, elapsedMs: Date.now() - startedAt });
            return;
          }
          if (until === "textChanged" && text !== firstText) {
            resolve({ matched: true, elapsedMs: Date.now() - startedAt });
            return;
          }
          if (text !== previousText) {
            previousText = text;
            stableSince = Date.now();
          } else if ((until === "textStable" || until === "loadIdle") && Date.now() - stableSince >= idleMs) {
            resolve({ matched: true, elapsedMs: Date.now() - startedAt });
            return;
          }
          if (Date.now() >= deadline) {
            resolve({ matched: false, elapsedMs: Date.now() - startedAt });
            return;
          }
          setTimeout(tick, 120);
        };
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", tick, { once: true });
        } else {
          tick();
        }
      }))()
    `, true),
    timeoutMs
  ) as Record<string, unknown>;
  if (waitResult.matched !== true) {
    warnings.push({ code: "browser_wait_timeout", message: `browser wait condition timed out: ${waitUntil}` });
  }
};

export const buildRenderedSnapshotScript = (
  request: Record<string, unknown>,
  url: string,
  maxHtmlChars: number
): string => `
  (() => {
    const maxHtmlChars = ${maxHtmlChars};
    const targetSelector = ${JSON.stringify(readSnapshotString(request, "targetSelector") ?? "")};
    const includeIframes = ${request.includeIframes === true};
    const includeShadowDom = ${request.includeShadowDom === true};
    const includeMedia = ${request.includeMedia === true};
    const includeDesignReference = ${request.includeDesignReference === true};
    const maxDesignElements = ${Math.max(
      50,
      Math.min(
        3000,
        Math.round(readSnapshotNumber(request, "maxDesignElements") ?? readSnapshotNumber(request, "maxElements") ?? 1200)
      )
    )};
    const normalizeText = (value) =>
      typeof value === "string"
        ? value.replace(/\\u00a0/g, " ").replace(/\\r/g, "").replace(/[ \\t]+\\n/g, "\\n").replace(/\\n[ \\t]+/g, "\\n").replace(/\\n{3,}/g, "\\n\\n").trim()
        : "";
    const cap = (value, max = 20000) => normalizeText(String(value ?? "")).slice(0, max);
    const abs = (value) => {
      try { return value ? new URL(String(value), location.href).href : ""; } catch { return ""; }
    };
    const cleanClone = (node) => {
      const clone = node.cloneNode(true);
      if (clone.querySelectorAll) {
        clone.querySelectorAll("script,style,noscript,template").forEach((el) => el.remove());
      }
      return clone;
    };
    const selectorPath = (element) => {
      if (!element || element.nodeType !== 1) return "";
      if (element.id) return "#" + CSS.escape(element.id);
      const parts = [];
      let current = element;
      while (current && current.nodeType === 1 && parts.length < 5) {
        let part = current.localName || "element";
        if (current.classList && current.classList.length > 0) {
          part += "." + Array.from(current.classList).slice(0, 2).map((value) => CSS.escape(value)).join(".");
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(" > ");
    };
    const boundsOf = (element) => {
      try {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      } catch {
        return undefined;
      }
    };
    const round = (value, places = 2) => {
      const factor = Math.pow(10, places);
      return Math.round(Number(value || 0) * factor) / factor;
    };
    const visibleElement = (element) => {
      const rect = boundsOf(element);
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0.01;
    };
    const compactBounds = (element) => {
      const rect = boundsOf(element);
      return rect ? { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) } : undefined;
    };
    const addFreq = (map, value) => {
      const text = String(value ?? "").trim();
      if (!text || text === "none" || text === "normal" || text === "auto") return;
      if (text === "rgba(0, 0, 0, 0)" || text === "transparent") return;
      map.set(text, (map.get(text) || 0) + 1);
    };
    const topFreq = (map, limit = 12) =>
      Array.from(map.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, limit)
        .map(([value, count]) => ({ value, count }));
    const edgeStyle = (style, prefix) => ({
      top: style[prefix + "Top"],
      right: style[prefix + "Right"],
      bottom: style[prefix + "Bottom"],
      left: style[prefix + "Left"]
    });
    const backgroundUrls = (value) => {
      const text = String(value ?? "");
      const urls = [];
      const pattern = /url\\((["']?)(.*?)\\1\\)/g;
      let match;
      while ((match = pattern.exec(text)) !== null && urls.length < 8) {
        const url = abs(match[2] || "");
        if (url) urls.push(url);
      }
      return urls;
    };
    const styleSummary = (element) => {
      const style = getComputedStyle(element);
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        background: style.background && style.background !== "none" ? style.background.slice(0, 500) : undefined,
        backgroundImage: style.backgroundImage && style.backgroundImage !== "none" ? style.backgroundImage.slice(0, 500) : undefined,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        textTransform: style.textTransform,
        textDecoration: style.textDecorationLine && style.textDecorationLine !== "none" ? style.textDecoration : undefined,
        margin: edgeStyle(style, "margin"),
        padding: edgeStyle(style, "padding"),
        width: style.width,
        height: style.height,
        maxWidth: style.maxWidth,
        minWidth: style.minWidth,
        gap: style.gap,
        display: style.display,
        flexDirection: style.flexDirection,
        justifyContent: style.justifyContent,
        alignItems: style.alignItems,
        gridTemplateColumns: style.gridTemplateColumns,
        borderRadius: {
          topLeft: style.borderTopLeftRadius,
          topRight: style.borderTopRightRadius,
          bottomRight: style.borderBottomRightRadius,
          bottomLeft: style.borderBottomLeftRadius
        },
        boxShadow: style.boxShadow && style.boxShadow !== "none" ? style.boxShadow.slice(0, 500) : undefined,
        border: style.borderStyle !== "none" ? style.border : undefined,
        position: style.position,
        inset: {
          top: style.top,
          right: style.right,
          bottom: style.bottom,
          left: style.left
        },
        zIndex: style.zIndex,
        overflow: style.overflow,
        opacity: style.opacity,
        transform: style.transform && style.transform !== "none" ? style.transform.slice(0, 300) : undefined,
        transition: style.transition && style.transition !== "all 0s ease 0s" ? style.transition.slice(0, 500) : undefined,
        animation: style.animation && style.animation !== "none 0s ease 0s 1 normal none running" ? style.animation.slice(0, 500) : undefined,
        filter: style.filter && style.filter !== "none" ? style.filter.slice(0, 300) : undefined,
        backdropFilter: style.backdropFilter && style.backdropFilter !== "none" ? style.backdropFilter.slice(0, 300) : undefined,
        objectFit: style.objectFit,
        objectPosition: style.objectPosition,
        whiteSpace: style.whiteSpace
      };
    };
    const componentSample = (elements, limit = 16) =>
      elements
        .filter(visibleElement)
        .slice(0, limit)
        .map((element) => ({
          tag: element.localName || "element",
          selector: selectorPath(element),
          text: cap(element.innerText ?? element.textContent ?? "", 160),
          bounds: compactBounds(element),
          style: styleSummary(element)
        }));
    const extractDesignReference = () => {
      let root = document.body || document.documentElement;
      if (targetSelector.length > 0) {
        try {
          root = document.querySelector(targetSelector) || root;
        } catch {}
      }
      const allElements = [root]
        .concat(Array.from(root.querySelectorAll("*")).slice(0, maxDesignElements))
        .filter((element, index, array) => element && array.indexOf(element) === index);
      const visibleElements = allElements.filter(visibleElement);
      const colors = new Map();
      const gradients = new Map();
      const fontFamilies = new Map();
      const fontSizes = new Map();
      const fontWeights = new Map();
      const lineHeights = new Map();
      const letterSpacings = new Map();
      const spacing = new Map();
      const radii = new Map();
      const shadows = new Map();
      const displays = new Map();
      const positions = new Map();
      const transitions = new Map();
      const animations = new Map();
      const backgroundImages = [];
      visibleElements.forEach((element) => {
        const style = getComputedStyle(element);
        addFreq(colors, style.color);
        addFreq(colors, style.backgroundColor);
        addFreq(fontFamilies, style.fontFamily);
        addFreq(fontSizes, style.fontSize);
        addFreq(fontWeights, style.fontWeight);
        addFreq(lineHeights, style.lineHeight);
        addFreq(letterSpacings, style.letterSpacing);
        [
          style.marginTop, style.marginRight, style.marginBottom, style.marginLeft,
          style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft,
          style.gap, style.columnGap, style.rowGap
        ].forEach((value) => addFreq(spacing, value));
        [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius
        ].forEach((value) => addFreq(radii, value));
        addFreq(shadows, style.boxShadow);
        addFreq(displays, style.display);
        addFreq(positions, style.position);
        addFreq(transitions, style.transition);
        addFreq(animations, style.animation);
        if (style.backgroundImage && style.backgroundImage !== "none") {
          const image = style.backgroundImage.slice(0, 700);
          if (image.includes("gradient(")) addFreq(gradients, image);
          if (backgroundImages.length < 40 && !backgroundImages.some((entry) => entry.image === image)) {
            backgroundImages.push({
              selector: selectorPath(element),
              image,
              urls: backgroundUrls(image),
              bounds: compactBounds(element)
            });
          }
        }
      });
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      const sections = Array.from(root.querySelectorAll("header,nav,main,section,footer,article,aside,[role='banner'],[role='navigation'],[role='main'],[role='contentinfo']"))
        .filter(visibleElement)
        .slice(0, 40)
        .map((element) => {
          const rect = boundsOf(element) || { width: 0, height: 0 };
          return {
            tag: element.localName || "section",
            role: element.getAttribute("role") || undefined,
            selector: selectorPath(element),
            text: cap(element.innerText ?? element.textContent ?? "", 240),
            bounds: compactBounds(element),
            areaRatio: round((rect.width * rect.height) / viewportArea, 4),
            style: styleSummary(element)
          };
        });
      const cardCandidates = visibleElements.filter((element) => {
        const className = String(element.className || "").toLowerCase();
        const style = getComputedStyle(element);
        const rect = boundsOf(element) || { width: 0, height: 0 };
        return element.localName === "article"
          || className.includes("card")
          || className.includes("tile")
          || className.includes("panel")
          || ((rect.width * rect.height) > 12000 && (style.boxShadow !== "none" || style.borderStyle !== "none" || style.borderTopLeftRadius !== "0px"));
      });
      const stickyOrFixed = visibleElements
        .filter((element) => {
          const position = getComputedStyle(element).position;
          return position === "sticky" || position === "fixed";
        })
        .slice(0, 16)
        .map((element) => ({
          tag: element.localName || "element",
          selector: selectorPath(element),
          text: cap(element.innerText ?? element.textContent ?? "", 120),
          bounds: compactBounds(element),
          style: styleSummary(element)
        }));
      const transitionSamples = visibleElements
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.transition && style.transition !== "all 0s ease 0s";
        })
        .slice(0, 16)
        .map((element) => ({
          selector: selectorPath(element),
          transition: getComputedStyle(element).transition,
          bounds: compactBounds(element)
        }));
      const animationSamples = visibleElements
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.animationName && style.animationName !== "none";
        })
        .slice(0, 16)
        .map((element) => ({
          selector: selectorPath(element),
          animation: getComputedStyle(element).animation,
          bounds: compactBounds(element)
        }));
      const scrollSnap = visibleElements
        .filter((element) => {
          const style = getComputedStyle(element);
          return style.scrollSnapType && style.scrollSnapType !== "none";
        })
        .slice(0, 12)
        .map((element) => ({
          selector: selectorPath(element),
          scrollSnapType: getComputedStyle(element).scrollSnapType,
          bounds: compactBounds(element)
        }));
      const inlineSvgs = Array.from(root.querySelectorAll("svg"))
        .slice(0, 30)
        .map((element) => ({
          selector: selectorPath(element),
          viewBox: element.getAttribute("viewBox") || undefined,
          width: element.getAttribute("width") || undefined,
          height: element.getAttribute("height") || undefined,
          ariaLabel: element.getAttribute("aria-label") || element.querySelector("title")?.textContent || undefined,
          bounds: compactBounds(element)
        }));
      const imageAssets = Array.from(root.querySelectorAll("img"))
        .filter(visibleElement)
        .slice(0, 80)
        .map((element) => ({
          url: abs(element.currentSrc || element.src || element.getAttribute("src") || ""),
          alt: element.getAttribute("alt") || undefined,
          title: element.getAttribute("title") || undefined,
          naturalWidth: Number(element.naturalWidth || 0) || undefined,
          naturalHeight: Number(element.naturalHeight || 0) || undefined,
          bounds: compactBounds(element)
        }))
        .filter((entry) => entry.url);
      const pageText = cap(document.body?.innerText ?? document.body?.textContent ?? "", 4000).toLowerCase();
      const faviconLinks = Array.from(document.querySelectorAll("link[rel*='icon']")).slice(0, 20).map((element) => ({
        rel: element.getAttribute("rel") || undefined,
        href: abs(element.getAttribute("href") || ""),
        sizes: element.getAttribute("sizes") || undefined,
        type: element.getAttribute("type") || undefined
      })).filter((entry) => entry.href);
      const fontLinks = Array.from(document.querySelectorAll("link[href],style")).slice(0, 200).flatMap((element) => {
        const href = element.getAttribute?.("href") || "";
        const text = element.textContent || "";
        const records = [];
        if (/fonts\\.(googleapis|gstatic)\\.com|font|typekit|use\\.typekit|cloud\\.typography/i.test(href)) {
          records.push({ kind: "link", href: abs(href), rel: element.getAttribute("rel") || undefined });
        }
        if (/@font-face/i.test(text)) {
          records.push({ kind: "style", text: text.slice(0, 600) });
        }
        return records;
      }).slice(0, 24);
      const metaImages = Array.from(document.querySelectorAll("meta[property='og:image'],meta[name='twitter:image']")).slice(0, 12).map((element) => ({
        name: element.getAttribute("property") || element.getAttribute("name") || undefined,
        content: abs(element.getAttribute("content") || "")
      })).filter((entry) => entry.content);
      const warnings = [];
      let status = "ok";
      let recommendedNextAction = "Use these DOM/CSS tokens as the visual reference evidence before planning or implementation.";
      if (/cloudflare|checking your browser|enable javascript|enable cookies|access denied|verify you are human/.test(pageText)) {
        status = "blocked";
        warnings.push({ code: "protected_or_blocked_page", message: "The rendered page looks blocked by bot protection, auth, cookies, or JavaScript gate text." });
        recommendedNextAction = "Use another public reference, read a curated DESIGN.md, or ask the user for a better reference.";
      } else if (visibleElements.length < 8 || sections.length === 0 || topFreq(colors, 4).length < 2) {
        status = "degraded";
        warnings.push({ code: "weak_design_signal", message: "The page produced too little visible structure, color, or section evidence for confident visual matching." });
        recommendedNextAction = "Try a more complete reference page, targetSelector, curated DESIGN.md, or blocking clarification before implementing.";
      }
      const assetCount = imageAssets.length + backgroundImages.length + inlineSvgs.length;
      if (assetCount === 0) {
        warnings.push({ code: "sparse_assets", message: "No visible img, CSS background-image, or inline SVG assets were found; verify the page is fully loaded or choose a richer reference." });
        if (status === "ok") status = "degraded";
      }
      return {
        status,
        warnings,
        recommendedNextAction,
        source: {
          url: String(location.href || ${JSON.stringify(url)}),
          title: normalizeText(document.title ?? ""),
          targetSelector: targetSelector || undefined
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          deviceScaleFactor: window.devicePixelRatio || 1
        },
        document: {
          width: Math.max(document.documentElement?.scrollWidth || 0, document.body?.scrollWidth || 0, window.innerWidth),
          height: Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0, window.innerHeight),
          visibleElementCount: visibleElements.length,
          sampledElementCount: allElements.length
        },
        tokens: {
          colors: topFreq(colors, 18),
          gradients: topFreq(gradients, 8),
          fontFamilies: topFreq(fontFamilies, 8),
          fontSizes: topFreq(fontSizes, 12),
          fontWeights: topFreq(fontWeights, 8),
          lineHeights: topFreq(lineHeights, 8),
          letterSpacings: topFreq(letterSpacings, 8),
          spacing: topFreq(spacing, 14),
          radius: topFreq(radii, 10),
          shadow: topFreq(shadows, 8),
          display: topFreq(displays, 8),
          position: topFreq(positions, 8),
          transitions: topFreq(transitions, 8),
          animations: topFreq(animations, 8)
        },
        foundations: {
          faviconLinks,
          fontLinks,
          metaImages
        },
        interactionSignals: {
          stickyOrFixed,
          transitionSamples,
          animationSamples,
          scrollSnap,
          interactiveCount: root.querySelectorAll("a[href],button,input,textarea,select,[role='button'],[role='link'],[tabindex]").length
        },
        sections,
        components: {
          buttons: componentSample(Array.from(root.querySelectorAll("button,a[href],[role='button']")), 18),
          cards: componentSample(cardCandidates, 18),
          inputs: componentSample(Array.from(root.querySelectorAll("input,textarea,select,[role='textbox'],[contenteditable='true']")), 12),
          navItems: componentSample(Array.from(root.querySelectorAll("nav a,header a,[role='navigation'] a")), 24)
        },
        assets: {
          images: imageAssets,
          backgroundImages,
          inlineSvgCount: root.querySelectorAll("svg").length,
          inlineSvgs,
          mediaCount: root.querySelectorAll("video,audio,iframe,embed,object").length
        }
      };
    };

    let selectedElement;
    if (targetSelector.length > 0) {
      try {
        const selected = document.querySelector(targetSelector);
        if (selected) {
          selectedElement = {
            selector: targetSelector,
            html: String(cleanClone(selected).outerHTML ?? "").slice(0, 20000),
            text: cap(selected.innerText ?? selected.textContent ?? "", 12000),
            bounds: boundsOf(selected)
          };
        }
      } catch (error) {
        selectedElement = { selector: targetSelector, text: "selector error: " + String(error?.message ?? error) };
      }
    }

    const docClone = document.documentElement ? cleanClone(document.documentElement) : document.createElement("html");
    const cloneBody = docClone.querySelector("body") || docClone.appendChild(document.createElement("body"));
    const frames = [];
    if (includeIframes) {
      Array.from(document.querySelectorAll("iframe")).slice(0, 40).forEach((frame, index) => {
        const src = abs(frame.getAttribute("src") || frame.src || "");
        try {
          const frameDocument = frame.contentDocument;
          if (!frameDocument) throw new Error("frame document unavailable");
          const frameHtml = String(cleanClone(frameDocument.documentElement).outerHTML ?? "").slice(0, 40000);
          const frameText = cap(frameDocument.body?.innerText ?? frameDocument.body?.textContent ?? "", 12000);
          const title = cap(frameDocument.title ?? frame.getAttribute("title") ?? "", 1000);
          frames.push({ url: frameDocument.location?.href || src, title, text: frameText, html: frameHtml });
          const section = document.createElement("section");
          section.setAttribute("data-lyra-iframe", String(index + 1));
          section.innerHTML = "<h2>Embedded Frame</h2>" + frameHtml;
          cloneBody.appendChild(section);
        } catch (error) {
          frames.push({ url: src || undefined, title: frame.getAttribute("title") || undefined, blockedReason: String(error?.message ?? error) });
        }
      });
    }

    const shadowRoots = [];
    if (includeShadowDom) {
      Array.from(document.querySelectorAll("*")).slice(0, 5000).forEach((element) => {
        if (shadowRoots.length >= 40) return;
        if (!element.shadowRoot) return;
        try {
          const html = String(cleanClone(element.shadowRoot).innerHTML ?? "").slice(0, 40000);
          const text = cap(element.shadowRoot.textContent ?? "", 12000);
          const selector = selectorPath(element);
          shadowRoots.push({ selector, text, html });
          const section = document.createElement("section");
          section.setAttribute("data-lyra-shadow-root", selector);
          section.innerHTML = "<h2>Shadow DOM</h2>" + html;
          cloneBody.appendChild(section);
        } catch (error) {
          shadowRoots.push({ selector: selectorPath(element), blockedReason: String(error?.message ?? error) });
        }
      });
    }

    const media = includeMedia
      ? Array.from(document.querySelectorAll("video,audio,iframe,embed,object")).slice(0, 500).map((element) => {
          const tag = element.localName || "media";
          const source = element.currentSrc || element.src || element.data || element.getAttribute("src") || element.getAttribute("data") || "";
          const nestedSource = element.querySelector?.("source[src]")?.getAttribute("src") || "";
          const rect = boundsOf(element);
          return {
            kind: tag,
            url: abs(source || nestedSource) || undefined,
            title: cap(element.getAttribute("title") || element.getAttribute("aria-label") || "", 1000) || undefined,
            text: cap(element.textContent || "", 2000) || undefined,
            poster: abs(element.getAttribute("poster") || "") || undefined,
            mimeType: element.getAttribute("type") || element.querySelector?.("source[type]")?.getAttribute("type") || undefined,
            width: Math.round(Number(element.getAttribute("width")) || rect?.width || 0) || undefined,
            height: Math.round(Number(element.getAttribute("height")) || rect?.height || 0) || undefined
          };
        }).filter((entry) => entry.url || entry.title || entry.text)
      : [];
    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((element) => ({
        text: cap(element.textContent ?? "", 1000),
        url: typeof element.href === "string" ? element.href : "",
        title: element.getAttribute("title") ?? undefined
      }))
      .filter((entry) => entry.url.length > 0)
      .slice(0, 500);
    const images = Array.from(document.querySelectorAll("img[src]"))
      .map((element) => {
        const entry = {
          url: typeof element.src === "string" ? element.src : "",
          alt: element.getAttribute("alt") ?? undefined,
          title: element.getAttribute("title") ?? undefined
        };
        if (!includeDesignReference) return entry;
        return {
          ...entry,
          currentSrc: abs(element.currentSrc || element.src || ""),
          naturalWidth: Number(element.naturalWidth || 0) || undefined,
          naturalHeight: Number(element.naturalHeight || 0) || undefined,
          bounds: compactBounds(element)
        };
      })
      .filter((entry) => entry.url.length > 0)
      .slice(0, 500);
    const designReference = includeDesignReference ? extractDesignReference() : undefined;
    const html = String(docClone.outerHTML ?? "");
    return {
      html: html.slice(0, maxHtmlChars),
      htmlTruncated: html.length > maxHtmlChars,
      bodyText: normalizeText(document.body?.innerText ?? document.body?.textContent ?? ""),
      title: normalizeText(document.title ?? ""),
      finalUrl: String(location.href || ${JSON.stringify(url)}),
      selectedElement,
      frames,
      shadowRoots,
      media,
      links,
      images,
      designReference,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        deviceScaleFactor: window.devicePixelRatio || 1
      }
    };
  })()
`;

const captureFullPagePng = async (
  webContents: WebContents,
  deadlineMs: number
): Promise<{ readonly imageBase64: string; readonly width: number; readonly height: number }> => {
  const maxPageshotPixels = 18_000_000;
  const maxPageshotDimension = 16_000;
  const attached = webContents.debugger.isAttached();
  if (!attached) {
    webContents.debugger.attach("1.3");
  }
  try {
    await runSnapshotStepWithDeadline(
      () => webContents.debugger.sendCommand("Page.enable") as Promise<unknown>,
      deadlineMs,
      "pageshot Page.enable"
    );
    const metrics = await runSnapshotStepWithDeadline(
      () => webContents.debugger.sendCommand("Page.getLayoutMetrics") as Promise<{
        readonly contentSize?: { readonly width?: number; readonly height?: number };
      }>,
      deadlineMs,
      "pageshot layout metrics"
    );
    const width = Math.max(1, Math.ceil(metrics.contentSize?.width ?? 0));
    const height = Math.max(1, Math.ceil(metrics.contentSize?.height ?? 0));
    if (
      width > maxPageshotDimension
      || height > maxPageshotDimension
      || width * height > maxPageshotPixels
    ) {
      throw new Error(`pageshot_too_large: ${width}x${height}`);
    }
    const shot = await runSnapshotStepWithDeadline(
      () => webContents.debugger.sendCommand("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: true
      }) as Promise<{ readonly data?: string }>,
      deadlineMs,
      "pageshot capture"
    );
    if (typeof shot.data !== "string" || shot.data.length === 0) {
      throw new Error("empty_pageshot");
    }
    return { imageBase64: shot.data, width, height };
  } finally {
    if (!attached && webContents.debugger.isAttached()) {
      webContents.debugger.detach();
    }
  }
};

export const createRenderedSnapshotRuntime = ({
  entries,
  requireEntry,
  navigateInEntry,
  getActiveOrFocusedTabId,
  waitForPageLoad
}: RenderedSnapshotRuntimeHost) => {
  const resolveRenderedSnapshotEntry = async (
    request: Record<string, unknown>,
    url: string
  ): Promise<BrowserPageEntry> => {
    const requestedTabId = readSnapshotString(request, "tabId");
    if (requestedTabId !== undefined) {
      const entry = requireEntry(requestedTabId);
      if (normalizeAddress(entry.webContents.getURL()) !== url && entry.requestedAddress !== url) {
        await navigateInEntry(entry, { address: url, tabId: requestedTabId });
      }
      return entry;
    }

    const activeTabId = getActiveOrFocusedTabId();
    if (snapshotMode(request) === "activeTab") {
      if (activeTabId === null) throw new Error("browser_tab_not_found");
      const entry = requireEntry(activeTabId);
      if (normalizeAddress(entry.webContents.getURL()) !== url && entry.requestedAddress !== url) {
        await navigateInEntry(entry, { address: url, tabId: activeTabId });
      }
      return entry;
    }

    if (snapshotMode(request) === "matchingOrNewTab") {
      const wanted = comparableSnapshotUrl(url);
      const match = Array.from(entries.values()).find((entry) => {
        if (entry.isDestroyed) return false;
        const current = normalizeAddress(entry.webContents.getURL()) ?? entry.requestedAddress;
        return comparableSnapshotUrl(current) === wanted;
      });
      if (match !== undefined) {
        return match;
      }
    }

    if (activeTabId !== null && snapshotMode(request) !== "newTab") {
      const entry = requireEntry(activeTabId);
      await navigateInEntry(entry, { address: url, tabId: activeTabId });
      return entry;
    }

    throw new Error("browser_tab_not_found");
  };

  const readRenderedSnapshotFromWebContents = async (
    tabId: string,
    webContents: WebContents,
    request: Record<string, unknown>,
    url: string,
    warnings: SnapshotWarning[],
    visibleOnly: boolean,
    deadlineMs: number
  ): Promise<unknown> => {
    await runRenderedSnapshotWait(webContents, request, warnings, deadlineMs);
    const maxHtmlChars = Math.max(
      4_096,
      Math.min(8 * 1024 * 1024, Math.round(readSnapshotNumber(request, "maxHtmlChars") ?? 2 * 1024 * 1024))
    );
    const snapshot = await runFrameScriptWithTimeout(
      () => webContents.executeJavaScript(buildRenderedSnapshotScript(request, url, maxHtmlChars), true),
      remainingSnapshotMs(deadlineMs, "rendered HTML extraction")
    ) as Record<string, unknown>;
    if (snapshot.htmlTruncated === true) {
      warnings.push({
        code: "browser_snapshot_truncated",
        message: `rendered HTML was truncated to ${maxHtmlChars} characters`
      });
    }

    let screenshot: unknown;
    if (request.includeScreenshot === true) {
      try {
        const image = await runSnapshotStepWithDeadline(
          () => webContents.capturePage(),
          deadlineMs,
          "visible screenshot"
        );
        const size = image.getSize();
        screenshot = {
          mimeType: "image/png",
          imageBase64: image.toPNG().toString("base64"),
          width: size.width,
          height: size.height,
          visibleOnly
        };
      } catch (error) {
        warnings.push({
          code: "browser_screenshot_failed",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    let pageshot: unknown;
    if (request.includePageshot === true) {
      if (cdpPageshotEnabled()) {
        try {
          const shot = await captureFullPagePng(webContents, deadlineMs);
          pageshot = {
            mimeType: "image/png",
            imageBase64: shot.imageBase64,
            width: shot.width,
            height: shot.height,
            visibleOnly: false
          };
        } catch (error) {
          warnings.push({
            code: "browser_pageshot_failed",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      } else {
        warnings.push({
          code: "browser_pageshot_degraded",
          message:
            "Full-page CDP pageshot is disabled for stability; captured a visible snapshot instead."
        });
      }
      if (pageshot === undefined) {
        if (screenshot !== undefined) {
          pageshot = screenshot;
        } else {
          const image = await runSnapshotStepWithDeadline(
            () => webContents.capturePage(),
            deadlineMs,
            "pageshot fallback screenshot"
          );
          const size = image.getSize();
          pageshot = {
            mimeType: "image/png",
            imageBase64: image.toPNG().toString("base64"),
            width: size.width,
            height: size.height,
            visibleOnly: true
          };
        }
      }
    }

    return {
      ok: true,
      kind: "workbenchBrowserRenderedSnapshot",
      tabId,
      requestedUrl: url,
      finalUrl: typeof snapshot.finalUrl === "string" ? snapshot.finalUrl : url,
      title: typeof snapshot.title === "string" ? snapshot.title : "",
      html: typeof snapshot.html === "string" ? snapshot.html : "",
      bodyText: typeof snapshot.bodyText === "string" ? snapshot.bodyText : "",
      selectedElement: snapshot.selectedElement ?? undefined,
      frames: Array.isArray(snapshot.frames) ? snapshot.frames : [],
      shadowRoots: Array.isArray(snapshot.shadowRoots) ? snapshot.shadowRoots : [],
      media: Array.isArray(snapshot.media) ? snapshot.media : [],
      viewport: snapshot.viewport,
      links: Array.isArray(snapshot.links) ? snapshot.links : [],
      images: Array.isArray(snapshot.images) ? snapshot.images : [],
      ...(snapshot.designReference === undefined ? {} : { designReference: snapshot.designReference }),
      warnings,
      debug: {
        snapshotMode: visibleOnly ? "tabRenderer" : "temporaryRenderer"
      },
      ...(screenshot === undefined ? {} : { screenshot }),
      ...(pageshot === undefined ? {} : { pageshot })
    };
  };

  const readRenderedSnapshotWithTemporaryRenderer = async (
    request: Record<string, unknown>,
    url: string,
    warnings: SnapshotWarning[]
  ): Promise<unknown> => {
    const deadlineMs = snapshotDeadlineMs(request);
    const viewport = snapshotViewport(request) ?? { width: 1366, height: 900, deviceScaleFactor: 1 };
    const window = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      paintWhenInitiallyHidden: true,
      width: viewport.width,
      height: viewport.height,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION,
        offscreen: true,
        sandbox: true,
        spellcheck: true
      }
    });
    window.setMenuBarVisibility(false);
    const { webContents } = window;
    try {
      webContents.debugger.attach("1.3");
      await runSnapshotStepWithDeadline(
        () => webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: viewport.deviceScaleFactor,
          mobile: request.mobile === true
        }) as Promise<unknown>,
        deadlineMs,
        "viewport emulation"
      );
      if (request.mobile === true) {
        await runSnapshotStepWithDeadline(
          () => webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {
            enabled: true,
            maxTouchPoints: 5
          }) as Promise<unknown>,
          deadlineMs,
          "touch emulation"
        );
        await runSnapshotStepWithDeadline(
          () => webContents.debugger.sendCommand("Network.setUserAgentOverride", {
            userAgent:
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
          }) as Promise<unknown>,
          deadlineMs,
          "mobile user agent"
        );
      }
      await waitForPageLoad(webContents, url, remainingSnapshotMs(deadlineMs, "browser navigation"));
      return await readRenderedSnapshotFromWebContents(
        "lyra-reader-snapshot",
        webContents,
        request,
        url,
        warnings,
        false,
        deadlineMs
      );
    } finally {
      if (webContents.isDestroyed() === false && webContents.debugger.isAttached()) {
        try {
          webContents.debugger.detach();
        } catch {
          // Ignore cleanup races.
        }
      }
      if (webContents.isDestroyed() === false) {
        try {
          webContents.stop();
        } catch {
          // Ignore cleanup races.
        }
      }
      if (window.isDestroyed() === false) {
        window.destroy();
      }
    }
  };

  const readRenderedSnapshot = async (payload: unknown): Promise<unknown> => {
    const request = snapshotRecord(payload);
    const url = normalizeAddress(readSnapshotString(request, "url") ?? "");
    if (url === null) {
      throw new Error("url is required");
    }
    const warnings: SnapshotWarning[] = [];
    const requestedTemporaryRenderer = request.viewport !== undefined || request.mobile === true;
    const useTemporaryRenderer = requestedTemporaryRenderer && temporarySnapshotRendererEnabled();
    if (requestedTemporaryRenderer && !useTemporaryRenderer) {
      warnings.push({
        code: "browser_temporary_renderer_disabled",
        message:
          "Temporary browser renderer is disabled for stability; viewport/mobile options were ignored."
      });
    }
    if (useTemporaryRenderer) {
      return await readRenderedSnapshotWithTemporaryRenderer(request, url, warnings);
    }
    const deadlineMs = snapshotDeadlineMs(request);
    const entry = await resolveRenderedSnapshotEntry(request, url);
    return await readRenderedSnapshotFromWebContents(
      entry.tabId,
      entry.webContents,
      request,
      url,
      warnings,
      true,
      deadlineMs
    );
  };

  return {
    readRenderedSnapshot
  };
};
