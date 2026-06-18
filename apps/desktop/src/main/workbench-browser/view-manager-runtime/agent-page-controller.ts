import type { WorkbenchLumenFollowAudit } from "../../../shared/desktop-bridge";
import type { WorkbenchBrowserNavigateResult } from "../../../shared/desktop-bridge";
import type { WorkbenchTabExtractTextResult, WorkbenchVisualCaptureResult } from "../../../shared/workbench-observation";
import type { WorkbenchObservationBrowserDomSummary } from "../../workbench-observation/types";
import type { WorkbenchBrowserAgentModeInfo, WorkbenchBrowserAgentModeRequest, WorkbenchBrowserAgentObserveStrategy, WorkbenchBrowserAgentTargetMode, WorkbenchBrowserViewManager } from "../types";
import { agentTargetAddress, agentTargetTitle } from "./agent-target-runtime";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import type { BrowserAgentStateStore } from "./agent-state-store";
import {
  buildHighlightRegionsFromElements,
  prepareVisionCapturePng
} from "./lumen-screenshot-highlights";
import { isScriptExecutionTimeout, normalizeAddress, normalizeExecuteScriptTimeoutMs, normalizeString, runFrameScriptWithTimeout } from "./normalizers";
import type { BrowserAgentShadowEntry, BrowserAgentPageTarget } from "./types";

type BrowserAgentPageControllerDeps = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "captureTargetPage"
  | "createVisualFrame"
  | "entries"
  | "navigateInEntry"
  | "publishBrowserAgentActivity"
  | "readBrowserAgentShadow"
  | "rememberVisualFrame"
  | "requireEntry"
  | "resolveBrowserAgentTarget"
  | "waitForAgentPageLoad"
> & { readonly stateStore: BrowserAgentStateStore };

export const createBrowserAgentPageController = (deps: BrowserAgentPageControllerDeps) => {
  const {
    captureTargetPage,
    createVisualFrame,
    entries,
    navigateInEntry,
    publishBrowserAgentActivity,
    readBrowserAgentShadow,
    rememberVisualFrame,
    requireEntry,
    resolveBrowserAgentTarget,
    stateStore,
    waitForAgentPageLoad
  } = deps;
  const { invalidateBrowserAgentTargets, readBrowserAgentCacheEntry } = stateStore;

  const readAgentDomSummaryFromTarget = async (
    target: BrowserAgentPageTarget,
    maxChars: number | undefined,
    timeoutMs: number
  ): Promise<WorkbenchObservationBrowserDomSummary & {
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly browserMode?: WorkbenchBrowserAgentModeInfo;
    readonly content: string;
  }> => {
    const limit = Math.max(256, Math.min(24_000, Math.round(maxChars ?? 12_000)));
    try {
      const raw = await runFrameScriptWithTimeout(
        () => target.webContents.executeJavaScript(`
          (() => {
            const normalizeText = (value) =>
              typeof value === "string" ? value.replace(/\\s+/g, " ").trim() : "";
            const bodyText = normalizeText(document.body?.innerText ?? "");
            const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
              .map((element) => normalizeText(element.textContent ?? ""))
              .filter(Boolean)
              .slice(0, 40);
            const links = Array.from(document.querySelectorAll("a[href]"))
              .map((element) => ({
                text: normalizeText(element.textContent ?? ""),
                href: typeof element.href === "string" ? element.href : ""
              }))
              .filter((entry) => entry.href.length > 0)
              .slice(0, 50);
            return {
              domTitle: normalizeText(document.title ?? ""),
              documentLanguage: normalizeText(document.documentElement?.lang ?? ""),
              selectionText: normalizeText(String(window.getSelection?.() ?? "")),
              headings,
              links,
              forms: [],
              mainTextExcerpt: bodyText.slice(0, ${limit}),
              truncated: bodyText.length > ${limit}
            };
          })()
        `, true),
        timeoutMs
      ) as Record<string, unknown>;
      const headings = Array.isArray(raw.headings)
        ? raw.headings.filter((value): value is string => typeof value === "string")
        : [];
      const links = Array.isArray(raw.links)
        ? raw.links
            .map((value) => {
              if (value === null || typeof value !== "object") {
                return null;
              }
              const record = value as Record<string, unknown>;
              return typeof record.href === "string"
                ? { text: typeof record.text === "string" ? record.text : "", href: record.href }
                : null;
            })
            .filter((value): value is { text: string; href: string } => value !== null)
        : [];
      const content = typeof raw.mainTextExcerpt === "string" ? raw.mainTextExcerpt : "";
      return {
        targetMode: target.targetMode,
        browserMode: target.browserMode,
        content,
        ...(typeof raw.domTitle === "string" && raw.domTitle.length > 0 ? { domTitle: raw.domTitle } : {}),
        ...(typeof raw.documentLanguage === "string" && raw.documentLanguage.length > 0
          ? { documentLanguage: raw.documentLanguage }
          : {}),
        ...(typeof raw.selectionText === "string" && raw.selectionText.length > 0
          ? { selectionText: raw.selectionText }
          : {}),
        headings,
        mainTextExcerpt: content,
        links,
        forms: [],
        truncated: raw.truncated === true
      };
    } catch (error) {
      if (isScriptExecutionTimeout(error)) {
        throw error;
      }
      return {
        targetMode: target.targetMode,
        browserMode: target.browserMode,
        content: "",
        headings: [],
        mainTextExcerpt: "",
        links: [],
        forms: [],
        truncated: false
      };
    }
  };

  const readAgentRecentTextFromTarget = async (
    target: BrowserAgentPageTarget,
    maxChars: number | undefined,
    timeoutMs: number
  ): Promise<WorkbenchTabExtractTextResult & {
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly browserMode?: WorkbenchBrowserAgentModeInfo;
    readonly content: string;
  }> => {
    const limit = Math.max(512, Math.min(6_000, Math.round(maxChars ?? 4_000)));
    try {
      const raw = await runFrameScriptWithTimeout(
        () => target.webContents.executeJavaScript(`
          (() => {
            const normalizeText = (value) => {
              if (typeof value !== "string") return "";
              return value
                .replace(/\\u00a0/g, " ")
                .replace(/\\r/g, "")
                .replace(/[ \\t]+\\n/g, "\\n")
                .replace(/\\n[ \\t]+/g, "\\n")
                .replace(/\\n{3,}/g, "\\n\\n")
                .trim();
            };
            const text = normalizeText(document.body?.innerText ?? document.body?.textContent ?? "");
            const totalChars = text.length;
            const startChar = Math.max(0, totalChars - ${limit});
            const slice = text.slice(startChar);
            return {
              text: slice,
              startChar,
              endChar: totalChars,
              totalChars,
              truncated: startChar > 0,
              hasMore: startChar > 0
            };
          })()
        `, true),
        timeoutMs
      ) as Record<string, unknown>;
      const text = typeof raw.text === "string" ? raw.text : "";
      const startChar = typeof raw.startChar === "number" && Number.isFinite(raw.startChar)
        ? Math.max(0, Math.round(raw.startChar))
        : 0;
      const endChar = typeof raw.endChar === "number" && Number.isFinite(raw.endChar)
        ? Math.max(startChar, Math.round(raw.endChar))
        : startChar + text.length;
      const totalChars = typeof raw.totalChars === "number" && Number.isFinite(raw.totalChars)
        ? Math.max(endChar, Math.round(raw.totalChars))
        : endChar;
      return {
        tabId: target.tabId,
        targetMode: target.targetMode,
        browserMode: target.browserMode,
        scope: "main",
        text,
        content: text,
        startChar,
        endChar,
        totalChars,
        truncated: raw.truncated === true,
        hasMore: raw.hasMore === true,
        extractionMethod: "lumen:recent-text-tail"
      };
    } catch (error) {
      if (isScriptExecutionTimeout(error)) {
        throw error;
      }
      return {
        tabId: target.tabId,
        targetMode: target.targetMode,
        browserMode: target.browserMode,
        scope: "main",
        text: "",
        content: "",
        startChar: 0,
        endChar: 0,
        totalChars: 0,
        truncated: false,
        hasMore: false,
        extractionMethod: "lumen:recent-text-tail-error"
      };
    }
  };

  const navigateAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly url: string;
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserNavigateResult & {
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly browserMode?: WorkbenchBrowserAgentModeInfo;
  }> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const address = normalizeAddress(request.url);
    if (address === null) {
      throw new Error("url is required");
    }
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "navigate",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: Math.max(1_800, Math.min(5_000, request.timeoutMs ?? 2_400))
    });
    if (target.targetMode === "live") {
      return {
        ...(await navigateInEntry(requireEntry(tabId), { address })),
        targetMode: "live",
        browserMode: target.browserMode
      };
    }
    const shadow = target as BrowserAgentShadowEntry;
    shadow.detached = true;
    await waitForAgentPageLoad(shadow.webContents, address, request.timeoutMs ?? 8_000, {
      waitForReady: true
    });
    shadow.address = normalizeAddress(shadow.webContents.getURL()) ?? address;
    shadow.title = normalizeString(shadow.webContents.getTitle()) ?? shadow.address;
    invalidateBrowserAgentTargets(tabId, shadow.targetMode, "navigation");
    return {
      address: shadow.address,
      tabId,
      title: shadow.title,
      targetMode: shadow.targetMode,
      browserMode: target.browserMode
    };
  };

  const readAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly strategy?: WorkbenchBrowserAgentObserveStrategy;
      readonly maxChars?: number;
      readonly timeoutMs?: number;
    }
  ) => {
    const timeoutMs = normalizeExecuteScriptTimeoutMs(request.timeoutMs, 8_000);
    const target = await resolveBrowserAgentTarget(tabId, request, timeoutMs);
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "read",
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: Math.max(900, Math.min(3_200, timeoutMs))
    });
    if (request.strategy === "domFallback") {
      return await readAgentDomSummaryFromTarget(target, request.maxChars, timeoutMs);
    }
    return await readAgentRecentTextFromTarget(target, request.maxChars, timeoutMs);
  };

  const captureAgentPage = async (
    tabId: string,
    request?: WorkbenchBrowserAgentModeRequest & {
      readonly highlightTargets?: boolean;
      readonly highlightTargetRefs?: readonly string[];
      readonly downsampleForVision?: boolean;
    }
  ): Promise<WorkbenchVisualCaptureResult & {
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly browserMode?: WorkbenchBrowserAgentModeInfo;
    readonly highlightRegions?: readonly import("../types").LumenScreenshotHighlightRegion[];
    readonly highlighted?: boolean;
    readonly downsampled?: boolean;
  }> => {
    const target = await resolveBrowserAgentTarget(tabId, request, undefined);
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "capture",
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: 1_500
    });
    let capture = await captureTargetPage(tabId, target);
    const visualFrame = await createVisualFrame({
      tabId,
      target,
      imageWidth: capture.width,
      imageHeight: capture.height
    });
    rememberVisualFrame(tabId, target.targetMode, visualFrame);

    const shouldHighlight = request?.highlightTargets !== false;
    const cacheEntry = readBrowserAgentCacheEntry(tabId, target.targetMode);
    const highlightRegions = shouldHighlight
      ? buildHighlightRegionsFromElements(cacheEntry?.elements ?? [], {
        dpr: visualFrame.dpr,
        scrollX: visualFrame.scrollX,
        scrollY: visualFrame.scrollY,
        viewOffsetX: 0,
        viewOffsetY: 0,
        ...(request?.highlightTargetRefs === undefined
          ? {}
          : { targetRefs: request.highlightTargetRefs })
      })
      : [];

    let highlighted = false;
    let downsampled = false;
    if (
      highlightRegions.length > 0
      || request?.downsampleForVision !== false
    ) {
      try {
        const prepared = prepareVisionCapturePng(capture.imageBase64, {
          highlightRegions,
          ...(request?.downsampleForVision === false ? { maxDimension: Number.MAX_SAFE_INTEGER } : {})
        });
        capture = {
          ...capture,
          imageBase64: prepared.imageBase64,
          width: prepared.width,
          height: prepared.height
        };
        highlighted = prepared.highlighted;
        downsampled = prepared.downsampled;
      } catch {
        // Keep the raw capture when native image processing is unavailable.
      }
    }

    return {
      ...capture,
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      visualFrame,
      ...(highlightRegions.length === 0 ? {} : { highlightRegions }),
      ...(highlighted ? { highlighted: true } : {}),
      ...(downsampled ? { downsampled: true } : {})
    };
  };

  const showAgentActivity: WorkbenchBrowserViewManager["showAgentActivity"] = async (
    tabId,
    request
  ) => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.durationMs);
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: request.action,
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      ...(request.durationMs === undefined ? {} : { durationMs: request.durationMs })
    });
    return {
      tabId,
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      action: request.action
    };
  };

  const readAgentFollowFinalPageState = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): WorkbenchLumenFollowAudit["finalPageState"] => {
    if (targetMode === "live") {
      const entry = entries.get(tabId);
      if (entry === undefined || entry.isDestroyed) {
        return null;
      }
      return {
        address: entry.runtime.address,
        title: entry.runtime.title,
        isLoading: entry.runtime.isLoading
      };
    }
    const shadow = readBrowserAgentShadow(tabId);
    if (shadow === undefined || shadow.webContents.isDestroyed()) {
      return null;
    }
    return {
      address: normalizeAddress(shadow.webContents.getURL()) ?? shadow.address,
      title: normalizeString(shadow.webContents.getTitle()) ?? shadow.title,
      isLoading: shadow.isLoading
    };
  };

  return {
    captureAgentPage,
    navigateAgentPage,
    readAgentFollowFinalPageState,
    readAgentPage,
    showAgentActivity
  };
};
