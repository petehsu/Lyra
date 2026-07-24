import { BrowserWindow, type WebContents } from "electron";

import type { WorkbenchBrowserNavigateRequest } from "../../../shared/desktop-bridge";
import { WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION } from "../../../shared/workbench-browser";
import {
  normalizeAddress,
  runFrameScriptWithTimeout
} from "./normalizers";
import type { BrowserPageEntry } from "./types";
import type {
  BrowserAxNode,
  WorkbenchBrowserDebuggerSession
} from "../types";

export type SnapshotWarning = {
  readonly code: string;
  readonly message: string;
};

type SnapshotViewport = {
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
};

type SnapshotWaitUntil =
  | "html"
  | "loadIdle"
  | "textStable"
  | "textChanged"
  | "textContains"
  | "networkIdle"
  | "autoSmart";

type SnapshotAxElement = {
  readonly refId: string;
  readonly role: string;
  readonly name?: string;
  readonly url?: string;
  readonly bounds?: readonly [number, number, number, number];
  readonly isInteractive: boolean;
  readonly isContent: boolean;
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
  readonly openDebuggerSession: (
    tabId: string
  ) => Promise<WorkbenchBrowserDebuggerSession>;
  readonly readAxNodes: (
    tabId: string,
    timeoutMs: number
  ) => Promise<readonly BrowserAxNode[]>;
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
): SnapshotWaitUntil => {
  if (request.waitUntil === "html") return "html";
  if (request.waitUntil === "textStable") return "textStable";
  if (request.waitUntil === "textChanged") return "textChanged";
  if (request.waitUntil === "textContains") return "textContains";
  if (request.waitUntil === "networkIdle") return "networkIdle";
  if (request.waitUntil === "autoSmart") return "autoSmart";
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

const ignoredNetworkResourceTypes = new Set(["WebSocket", "EventSource", "Media"]);

export const waitForSnapshotNetworkIdle = async (
  openSession: () => Promise<WorkbenchBrowserDebuggerSession>,
  idleMs: number,
  timeoutMs: number
): Promise<boolean> => {
  let session: WorkbenchBrowserDebuggerSession | null = null;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    let openTimedOut = false;
    const opening = openSession().then((opened) => {
      if (openTimedOut) void opened.close().catch(() => undefined);
      return opened;
    });
    session = await Promise.race([
      opening,
      new Promise<null>((resolve) => {
        openTimer = setTimeout(() => {
          openTimedOut = true;
          resolve(null);
        }, timeoutMs);
      })
    ]);
    if (openTimer !== null) clearTimeout(openTimer);
    if (session === null) {
      return false;
    }
    return await new Promise<boolean>((resolve) => {
      const inFlight = new Set<string>();
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;
      const finish = (matched: boolean): void => {
        if (settled) return;
        settled = true;
        if (idleTimer !== null) clearTimeout(idleTimer);
        clearTimeout(timeoutTimer);
        unsubscribe();
        resolve(matched);
      };
      const scheduleIdle = (): void => {
        if (inFlight.size > 0 || idleTimer !== null) return;
        idleTimer = setTimeout(() => finish(true), idleMs);
      };
      const unsubscribe = session!.subscribe((event) => {
        if (event.kind === "detached") {
          finish(false);
          return;
        }
        const params = snapshotRecord(event.params);
        const requestId = typeof params.requestId === "string" ? params.requestId : "";
        if (event.method === "Network.requestWillBeSent") {
          const resourceType = typeof params.type === "string" ? params.type : "";
          if (requestId.length > 0 && !ignoredNetworkResourceTypes.has(resourceType)) {
            if (idleTimer !== null) {
              clearTimeout(idleTimer);
              idleTimer = null;
            }
            inFlight.add(requestId);
          }
        } else if (
          event.method === "Network.loadingFinished"
          || event.method === "Network.loadingFailed"
        ) {
          inFlight.delete(requestId);
          scheduleIdle();
        }
      });
      const timeoutTimer = setTimeout(() => finish(false), timeoutMs);
      void session!.sendCommand("Network.enable")
        .then(scheduleIdle)
        .catch(() => finish(false));
    });
  } catch {
    return false;
  } finally {
    if (openTimer !== null) clearTimeout(openTimer);
    await session?.close().catch(() => undefined);
  }
};

const runRenderedTextWait = async (
  webContents: WebContents,
  waitUntil: Exclude<SnapshotWaitUntil, "html" | "networkIdle" | "autoSmart">,
  waitText: string | undefined,
  idleMs: number,
  timeoutMs: number
): Promise<boolean> => {
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
        let previousHtmlLength = document.documentElement?.outerHTML.length ?? 0;
        let stableSince = Date.now();
        const tick = () => {
          const text = readText();
          const htmlLength = document.documentElement?.outerHTML.length ?? 0;
          if (until === "textContains" && textNeedle.length > 0 && text.includes(textNeedle)) {
            resolve({ matched: true, elapsedMs: Date.now() - startedAt });
            return;
          }
          if (until === "textChanged" && text !== firstText) {
            resolve({ matched: true, elapsedMs: Date.now() - startedAt });
            return;
          }
          if (text !== previousText || htmlLength !== previousHtmlLength) {
            previousText = text;
            previousHtmlLength = htmlLength;
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
  return waitResult.matched === true;
};

const waitForDocumentReady = async (
  webContents: WebContents,
  timeoutMs: number
): Promise<boolean> => {
  const result = await runFrameScriptWithTimeout(
    () => webContents.executeJavaScript(`
      (() => new Promise((resolve) => {
        const deadline = Date.now() + ${timeoutMs};
        const tick = () => {
          if (document.readyState !== "loading") return resolve(true);
          if (Date.now() >= deadline) return resolve(false);
          setTimeout(tick, 50);
        };
        tick();
      }))()
    `, true),
    timeoutMs
  );
  return result === true;
};

export const runRenderedSnapshotWait = async (
  tabId: string,
  webContents: WebContents,
  request: Record<string, unknown>,
  warnings: SnapshotWarning[],
  deadlineMs: number,
  openDebuggerSession?: (tabId: string) => Promise<WorkbenchBrowserDebuggerSession>
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

  if (waitUntil === "networkIdle" || waitUntil === "autoSmart") {
    const readyBudget = Math.min(2_500, remainingSnapshotMs(deadlineMs, "document ready"));
    try {
      if (!await waitForDocumentReady(webContents, readyBudget)) {
        warnings.push({
          code: "browser_wait_degraded",
          message: "document readiness timed out; continuing with stability fallback"
        });
      }
    } catch {
      warnings.push({
        code: "browser_wait_degraded",
        message: "document readiness check failed; continuing with stability fallback"
      });
    }
    const remaining = Math.max(250, deadlineMs - Date.now());
    const networkBudget = Math.max(250, Math.floor(remaining * 0.7));
    const networkIdle = openDebuggerSession === undefined
      ? false
      : await waitForSnapshotNetworkIdle(
          () => openDebuggerSession(tabId),
          idleMs,
          networkBudget
        );
    if (networkIdle && waitUntil === "networkIdle") {
      return;
    }
    if (!networkIdle) {
      warnings.push({
        code: "browser_network_idle_degraded",
        message: "CDP network-idle wait was unavailable or timed out; used DOM/text stability instead"
      });
    }
    if (Date.now() >= deadlineMs) return;
    const fallbackTimeoutMs = remainingSnapshotMs(deadlineMs, "DOM stability fallback");
    try {
      if (!await runRenderedTextWait(webContents, "textStable", waitText, idleMs, fallbackTimeoutMs)) {
        warnings.push({
          code: "browser_wait_timeout",
          message: `browser wait condition timed out: ${waitUntil}`
        });
      }
    } catch {
      warnings.push({
        code: "browser_wait_timeout",
        message: `browser wait condition timed out: ${waitUntil}`
      });
    }
    return;
  }

  const timeoutMs = remainingSnapshotMs(deadlineMs, `waitUntil=${waitUntil}`);
  if (!await runRenderedTextWait(webContents, waitUntil, waitText, idleMs, timeoutMs)) {
    warnings.push({ code: "browser_wait_timeout", message: `browser wait condition timed out: ${waitUntil}` });
  }
};

const contentAxRoles = new Set(["main", "article", "region"]);

export const mapSnapshotAxElements = (
  nodes: readonly BrowserAxNode[]
): readonly SnapshotAxElement[] =>
  nodes.map((node) => ({
    refId: node.axRef,
    role: node.role,
    ...(node.name.trim().length === 0 ? {} : { name: node.name }),
    ...(node.role.toLowerCase() === "link" && node.value?.trim()
      ? { url: node.value.trim() }
      : {}),
    ...(node.bounds === undefined
      ? {}
      : {
          bounds: [
            Math.round(node.bounds.x),
            Math.round(node.bounds.y),
            Math.round(node.bounds.width),
            Math.round(node.bounds.height)
          ] as const
        }),
    isInteractive: node.actionCapabilities.length > 0,
    isContent: contentAxRoles.has(node.role.toLowerCase())
  }));

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
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        opacity: style.opacity,
        colorScheme: style.colorScheme,
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
    const accessibleName = (element) => {
      const ariaLabel = normalizeText(element.getAttribute?.("aria-label") || "");
      if (ariaLabel) return ariaLabel;
      const labelledBy = normalizeText(element.getAttribute?.("aria-labelledby") || "");
      if (labelledBy) {
        const text = labelledBy
          .split(/\\s+/)
          .map((id) => document.getElementById(id)?.textContent || "")
          .join(" ");
        if (normalizeText(text)) return normalizeText(text);
      }
      const labels = Array.from(element.labels || [])
        .map((label) => label.textContent || "")
        .join(" ");
      if (normalizeText(labels)) return normalizeText(labels);
      const nestedTitle = normalizeText(element.querySelector?.("svg title")?.textContent || "");
      if (nestedTitle) return nestedTitle;
      const nestedImageAlt = normalizeText(element.querySelector?.("img[alt]")?.getAttribute("alt") || "");
      if (nestedImageAlt) return nestedImageAlt;
      const tag = String(element.localName || "").toLowerCase();
      const explicitRole = normalizeText(element.getAttribute?.("role") || "");
      const inputType = tag === "input"
        ? String(element.getAttribute?.("type") || "text").toLowerCase()
        : "";
      const valueName = tag === "input" && ["button", "submit", "reset"].includes(inputType)
        ? element.value
        : "";
      const contentName = tag === "button"
        || tag === "a"
        || explicitRole.length > 0
        ? element.innerText || element.textContent
        : "";
      return normalizeText(
        element.getAttribute?.("alt")
        || element.getAttribute?.("title")
        || valueName
        || contentName
        || ""
      );
    };
    const roleOf = (element) => {
      const explicit = normalizeText(element.getAttribute?.("role") || "");
      if (explicit) return explicit;
      const tag = element.localName || "";
      if (tag === "button") return "button";
      if (tag === "a" && element.hasAttribute("href")) return "link";
      if (tag === "select") return "combobox";
      if (tag === "textarea") return "textbox";
      if (tag === "input") {
        const type = String(element.getAttribute("type") || "text").toLowerCase();
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "range") return "slider";
        return type === "button" || type === "submit" || type === "reset" ? "button" : "textbox";
      }
      return tag || "element";
    };
    const parseColor = (value) => {
      const match = String(value || "").match(/rgba?\\(([^)]+)\\)/i);
      if (!match) return null;
      const parts = match[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);
      if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null;
      return {
        red: Math.max(0, Math.min(255, parts[0])),
        green: Math.max(0, Math.min(255, parts[1])),
        blue: Math.max(0, Math.min(255, parts[2])),
        alpha: Number.isFinite(parts[3]) ? Math.max(0, Math.min(1, parts[3])) : 1
      };
    };
    const relativeLuminance = (color) => {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue);
    };
    const contrastRatio = (foreground, background) => {
      const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
      const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
      return (light + 0.05) / (dark + 0.05);
    };
    const solidBackgroundFor = (element) => {
      let current = element;
      while (current) {
        const style = getComputedStyle(current);
        if (style.backgroundImage && style.backgroundImage !== "none") {
          return { resolved: false, reason: "image_or_gradient_background" };
        }
        const color = parseColor(style.backgroundColor);
        if (color && color.alpha >= 0.98) {
          return { resolved: true, color, value: style.backgroundColor, selector: selectorPath(current) };
        }
        if (color && color.alpha > 0.01) {
          return { resolved: false, reason: "translucent_background" };
        }
        current = current.parentElement;
      }
      return { resolved: false, reason: "no_solid_background" };
    };
    const directText = (element) =>
      normalizeText(Array.from(element.childNodes || [])
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent || "")
        .join(" "));
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
      const headings = componentSample(
        Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")),
        32
      ).map((entry, index) => {
        const element = Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']"))
          .filter(visibleElement)[index];
        const implicitLevel = element?.localName?.match(/^h([1-6])$/)?.[1];
        return {
          ...entry,
          level: Number(element?.getAttribute?.("aria-level") || implicitLevel || 0) || undefined
        };
      });
      const controlElements = Array.from(root.querySelectorAll(
        "button,a[href],input:not([type='hidden']),textarea,select,[role='button'],[role='link'],[role='checkbox'],[role='radio'],[role='switch'],[role='tab'],[role='textbox'],[tabindex]"
      )).filter(visibleElement);
      const controlSamples = controlElements.slice(0, 80).map((element) => ({
        tag: element.localName || "control",
        role: roleOf(element),
        name: accessibleName(element) || undefined,
        selector: selectorPath(element),
        bounds: compactBounds(element),
        disabled: element.disabled === true || element.getAttribute("aria-disabled") === "true",
        selected: element.selected === true || element.getAttribute("aria-selected") === "true",
        busy: element.getAttribute("aria-busy") === "true",
        checked: typeof element.checked === "boolean" ? element.checked : element.getAttribute("aria-checked") || undefined,
        pressed: element.getAttribute("aria-pressed") || undefined,
        expanded: element.getAttribute("aria-expanded") || undefined
      }));
      const unlabelledControls = controlSamples
        .filter((entry) => !entry.name && entry.role !== "presentation" && entry.role !== "none")
        .slice(0, 24);
      const missingAltImages = Array.from(root.querySelectorAll("img"))
        .filter((element) => visibleElement(element) && !element.hasAttribute("alt"))
        .slice(0, 24)
        .map((element) => ({
          selector: selectorPath(element),
          url: abs(element.currentSrc || element.src || element.getAttribute("src") || ""),
          bounds: compactBounds(element)
        }));
      const horizontalOverflow = visibleElements
        .filter((element) => {
          const rect = boundsOf(element);
          return rect && (rect.x < -1 || rect.x + rect.width > window.innerWidth + 1);
        })
        .slice(0, 24)
        .map((element) => ({
          selector: selectorPath(element),
          bounds: compactBounds(element),
          viewportWidth: window.innerWidth
        }));
      const textClipping = visibleElements
        .filter((element) => {
          if (!normalizeText(element.innerText ?? element.textContent ?? "")) return false;
          const style = getComputedStyle(element);
          const clips = style.overflow === "hidden"
            || style.overflow === "clip"
            || style.overflowX === "hidden"
            || style.overflowX === "clip"
            || style.overflowY === "hidden"
            || style.overflowY === "clip";
          return clips && (
            element.scrollWidth > element.clientWidth + 1
            || element.scrollHeight > element.clientHeight + 1
          );
        })
        .slice(0, 24)
        .map((element) => ({
          selector: selectorPath(element),
          text: cap(element.innerText ?? element.textContent ?? "", 160),
          bounds: compactBounds(element),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          overflow: getComputedStyle(element).overflow
        }));
      const surfaceSet = new Set(cardCandidates);
      const nestedSurfaces = cardCandidates
        .filter((element) => {
          let parent = element.parentElement;
          while (parent && parent !== root) {
            if (surfaceSet.has(parent)) return true;
            parent = parent.parentElement;
          }
          return false;
        })
        .slice(0, 20)
        .map((element) => ({
          selector: selectorPath(element),
          parentSelector: selectorPath(Array.from(surfaceSet).find((parent) => parent !== element && parent.contains(element))),
          bounds: compactBounds(element)
        }));
      const transitionAll = visibleElements
        .filter((element) => {
          const style = getComputedStyle(element);
          const transition = String(style.transition || "");
          const duration = String(style.transitionDuration || "");
          const transitionsAll = String(style.transitionProperty || "")
            .split(",")
            .some((value) => value.trim() === "all")
            || /(^|,)\\s*all(?:\\s|$)/i.test(transition);
          const hasDuration = duration.length > 0
            ? !duration.split(",").every((value) => value.trim() === "0s")
            : /\\b(?:\\d*\\.)?\\d+(?:ms|s)\\b/i.test(transition)
              && !/(^|,)\\s*all\\s+0s\\b/i.test(transition);
          return transitionsAll && hasDuration;
        })
        .slice(0, 24)
        .map((element) => ({
          selector: selectorPath(element),
          transition: getComputedStyle(element).transition,
          bounds: compactBounds(element)
        }));
      const backdropFilterElements = visibleElements.filter((element) => {
        const style = getComputedStyle(element);
        return (style.backdropFilter && style.backdropFilter !== "none")
          || (style.webkitBackdropFilter && style.webkitBackdropFilter !== "none");
      });
      const backdropFilterSamples = backdropFilterElements
        .slice(0, 24)
        .map((element) => ({
          selector: selectorPath(element),
          backdropFilter: getComputedStyle(element).backdropFilter || getComputedStyle(element).webkitBackdropFilter,
          bounds: compactBounds(element)
        }));
      const reducedMotionSupported = Array.from(document.styleSheets || []).some((sheet) => {
        try {
          return Array.from(sheet.cssRules || []).some((rule) =>
            /prefers-reduced-motion\\s*:\\s*reduce/i.test(String(rule.cssText || ""))
          );
        } catch {
          return false;
        }
      });
      const lowContrastText = [];
      let unresolvedContrastCount = 0;
      visibleElements.forEach((element) => {
        if (lowContrastText.length >= 24) return;
        const text = directText(element);
        if (!text) return;
        const style = getComputedStyle(element);
        const foreground = parseColor(style.color);
        const background = solidBackgroundFor(element);
        if (!foreground || foreground.alpha < 0.98 || background.resolved !== true) {
          unresolvedContrastCount += 1;
          return;
        }
        const fontSize = Number.parseFloat(style.fontSize || "0") || 0;
        const fontWeight = Number.parseInt(style.fontWeight || "400", 10) || 400;
        const threshold = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
        const ratio = contrastRatio(foreground, background.color);
        if (ratio + 0.01 < threshold) {
          lowContrastText.push({
            selector: selectorPath(element),
            text: cap(text, 160),
            color: style.color,
            backgroundColor: background.value,
            backgroundSelector: background.selector,
            ratio: round(ratio),
            requiredRatio: threshold,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight
          });
        }
      });
      const theme = {
        colorScheme: getComputedStyle(document.documentElement).colorScheme || undefined,
        htmlTheme: document.documentElement.getAttribute("data-theme") || undefined,
        bodyTheme: document.body?.getAttribute("data-theme") || undefined,
        htmlClasses: Array.from(document.documentElement.classList || []).slice(0, 12),
        bodyClasses: Array.from(document.body?.classList || []).slice(0, 12),
        prefersDark: typeof window.matchMedia === "function"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
          : undefined
      };
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
          sampledElementCount: allElements.length,
          viewportAreaRatio: round((() => {
            const rect = boundsOf(root) || { width: 0, height: 0 };
            return Math.min(window.innerWidth, Math.max(0, rect.width))
              * Math.min(window.innerHeight, Math.max(0, rect.height))
              / viewportArea;
          })(), 4)
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
          navItems: componentSample(Array.from(root.querySelectorAll("nav a,header a,[role='navigation'] a")), 24),
          headings
        },
        qualitySignals: {
          unlabelledControls,
          missingAltImages,
          horizontalOverflow,
          textClipping,
          nestedSurfaces,
          transitionAll,
          backdropFilterCount: backdropFilterElements.length,
          backdropFilterSamples,
          reducedMotionSupported,
          lowContrastText,
          unresolvedContrastCount,
          controlStates: {
            total: controlElements.length,
            disabled: controlSamples.filter((entry) => entry.disabled).length,
            selected: controlSamples.filter((entry) => entry.selected).length,
            busy: controlSamples.filter((entry) => entry.busy).length,
            samples: controlSamples.slice(0, 32)
          },
          theme
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
  waitForPageLoad,
  openDebuggerSession,
  readAxNodes
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
    await runRenderedSnapshotWait(
      tabId,
      webContents,
      request,
      warnings,
      deadlineMs,
      visibleOnly ? openDebuggerSession : undefined
    );
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

    let axElements: readonly SnapshotAxElement[] | undefined;
    if (request.includeAxTree === true) {
      if (!visibleOnly) {
        axElements = [];
        warnings.push({
          code: "browser_ax_tree_degraded",
          message: "AX tree requires a normal browser tab; temporary renderer returned no AX elements"
        });
      } else {
        try {
          axElements = mapSnapshotAxElements(
            await readAxNodes(tabId, remainingSnapshotMs(deadlineMs, "AX tree"))
          );
        } catch (error) {
          axElements = [];
          warnings.push({
            code: "browser_ax_tree_failed",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
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
      ...(axElements === undefined ? {} : { axElements }),
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
