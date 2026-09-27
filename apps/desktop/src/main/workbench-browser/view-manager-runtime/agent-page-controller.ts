import { observeAgentNavigation } from "./agent-navigation-ready";
import { createBrowserFrameTextReader, type BrowserTextFrameGraphBuilder } from "./agent-frame-text";
import type { WorkbenchLumenFollowAudit } from "../../../shared/desktop-bridge";
import type { WorkbenchBrowserNavigateResult } from "../../../shared/desktop-bridge";
import type { WorkbenchTabExtractTextResult, WorkbenchVisualCaptureResult } from "../../../shared/workbench-observation";
import type { WorkbenchObservationBrowserDomSummary } from "../../workbench-observation/types";
import type { WorkbenchBrowserWaitState, WorkbenchBrowserAgentModeInfo, WorkbenchBrowserAgentModeRequest, WorkbenchBrowserAgentObserveStrategy, WorkbenchBrowserAgentTargetMode, WorkbenchBrowserViewManager } from "../types";
import { agentTargetAddress, agentTargetTitle } from "./agent-target-runtime";
import { VISIBLE_TEXT_RUNTIME, buildVisiblePageReadScript } from "./agent-visible-text";
import { readResponseWatch } from "./agent-response-watch";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import type { BrowserAgentStateStore } from "./agent-state-store";
import {
  buildHighlightRegionsFromElements,
  prepareVisionCapturePng
} from "./lumen-screenshot-highlights";
import { areNavigationAddressesEquivalent, normalizeAddress, normalizeExecuteScriptTimeoutMs, normalizeString, runFrameScriptWithTimeout, tryFrameworkRouterNavigation } from "./normalizers";
import { grantBrowserAuthorizeAct } from "../../open-in-workbench";
import type { BrowserAgentShadowEntry, BrowserAgentPageTarget, BrowserPageEntry } from "./types";

type BrowserAgentPageControllerDeps = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "captureTargetPage"
  | "createVisualFrame"
  | "entries"
  | "navigateInEntry"
  | "publishBrowserAgentActivity"
  | "publishEvent"
  | "readBrowserAgentShadow"
  | "rememberVisualFrame"
  | "requireEntry"
  | "resolveBrowserAgentTarget"
  | "waitForAgentPageLoad"
  | "waitForAgentPageReload"
> & { readonly stateStore: BrowserAgentStateStore; readonly buildFrameGraph?: BrowserTextFrameGraphBuilder };

export const createBrowserAgentPageController = (deps: BrowserAgentPageControllerDeps) => {
  const {
    captureTargetPage,
    createVisualFrame,
    entries,
    navigateInEntry,
    publishBrowserAgentActivity,
    publishEvent,
    readBrowserAgentShadow,
    rememberVisualFrame,
    requireEntry,
    resolveBrowserAgentTarget,
    stateStore,
    waitForAgentPageLoad,
    waitForAgentPageReload
  } = deps;
  const { invalidateBrowserAgentTargets, readBrowserAgentCacheEntry } = stateStore;
  const readFrameText = createBrowserFrameTextReader(deps.buildFrameGraph);

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
    const raw = await runFrameScriptWithTimeout(
      () => target.webContents.executeJavaScript(`
        (() => {
          const normalizeText = (value) =>
            typeof value === "string" ? value.replace(/\\s+/g, " ").trim() : "";
          const visibleText = ${VISIBLE_TEXT_RUNTIME};
          const rendered = visibleText.read(document.body, { limit: ${limit} });
          const bodyText = rendered.text;
          const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
            .filter(visibleText.exposed)
            .map((element) => visibleText.read(element, { limit: 240 }).text)
            .filter(Boolean)
            .slice(0, 40);
          const links = Array.from(document.querySelectorAll("a[href]"))
            .filter(visibleText.exposed)
            .map((element) => ({
              text: visibleText.read(element, { limit: 240 }).text,
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
            truncated: rendered.truncated
          };
        })()
      `, true),
      timeoutMs
    ) as Record<string, unknown>;
    if (raw === null || typeof raw !== "object" || typeof raw.mainTextExcerpt !== "string") {
      throw new Error("Browser text extraction returned an invalid DOM summary");
    }
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
    const rendered = await readFrameText(target, "full", limit, timeoutMs);
    const content = rendered.text;
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
      truncated: rendered.truncated
    };
  };

  const readAgentRecentTextFromTarget = async (
    target: BrowserAgentPageTarget,
    maxChars: number | undefined,
    timeoutMs: number,
    scope: "viewport" | "full",
    waitTargetRef?: string,
    textTail?: boolean,
    waitText?: string
  ): Promise<WorkbenchTabExtractTextResult & {
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly browserMode?: WorkbenchBrowserAgentModeInfo;
    readonly content: string;
    readonly waitState?: WorkbenchBrowserWaitState;
  }> => {
    const limit = Math.max(512, Math.min(6_000, Math.round(maxChars ?? 4_000)));
    const raw = await readFrameText(target, scope, limit, timeoutMs, textTail, waitText) as Record<string, unknown> & { text: string };
    const text = raw.text;
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
      ...(raw.waitState === undefined ? {} : {
        waitState: { ...raw.waitState as WorkbenchBrowserWaitState,
          ...(target.isLoading ? { readyState: "loading" } : {}) }
      }),
      startChar,
      endChar,
      totalChars,
      truncated: raw.truncated === true,
      hasMore: raw.hasMore === true,
      extractionMethod: `lumen:rendered-${scope}`
    };
  };

  const ensureLiveWorkbenchPageEntry = async (
    tabId: string,
    address: string
  ): Promise<BrowserPageEntry | undefined> => {
    const existing = entries.get(tabId);
    if (existing !== undefined && existing.isDestroyed === false) {
      return existing;
    }
    publishEvent({
      kind: "request-open-tab",
      address,
      tabId,
      embedded: true
    });
    // ponytail: poll until renderer parks the page into topology. 3s ceiling;
    // upgrade is making request-open-tab return a tabId promise directly.
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const entry = entries.get(tabId);
      if (entry !== undefined && entry.isDestroyed === false) {
        return entry;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const timedOut = entries.get(tabId);
    return timedOut !== undefined && timedOut.isDestroyed === false ? timedOut : undefined;
  };

  const navigateAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly url: string;
      readonly timeoutMs?: number;
      readonly useFrameworkRouter?: boolean;
    }
  ): Promise<WorkbenchBrowserNavigateResult & {
    readonly alreadyOpen?: true;
    readonly navigationState?: "ready" | "pending" | "failed";
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly browserMode?: WorkbenchBrowserAgentModeInfo;
  }> => {
    const address = normalizeAddress(request.url);
    if (address === null) {
      throw new Error("url is required");
    }
    if (request.targetMode === "live") {
      await ensureLiveWorkbenchPageEntry(tabId, "about:blank");
    }
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    grantBrowserAuthorizeAct(address, tabId);
    const openAddress = normalizeAddress(target.webContents.getURL()) ?? agentTargetAddress(target);
    if (areNavigationAddressesEquivalent(openAddress, address)) {
      return {
        address: openAddress,
        tabId,
        title: agentTargetTitle(target),
        targetMode: target.targetMode,
        browserMode: target.browserMode,
        navigationState: target.isLoading ? "pending" : "ready",
        alreadyOpen: true
      };
    }
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "navigate",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: Math.max(1_800, Math.min(5_000, request.timeoutMs ?? 2_400))
    });
    if (target.liveEntry !== undefined) {
      const completion = observeAgentNavigation(target.webContents, request.timeoutMs ?? 8_000, address);
      try {
        const result = await navigateInEntry(target.liveEntry, {
          address,
          ...(request.useFrameworkRouter === undefined ? {} : {useFrameworkRouter:request.useFrameworkRouter})
        });
        const navigationState = await completion.done;
        return { ...result, address:target.webContents.getURL() || address,
          navigationState, targetMode:"live",browserMode:target.browserMode };
      } finally { completion.cancel(); }
    }
    const shadow = target as BrowserAgentShadowEntry;
    shadow.detached = true;
    if (
      request.useFrameworkRouter === true
      && await tryFrameworkRouterNavigation(
        shadow.webContents,
        address,
        Math.min(1_000, request.timeoutMs ?? 1_000)
      )
    ) {
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
    }
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

  const reloadAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly ignoreCache?: boolean;
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserNavigateResult & {
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly browserMode?: WorkbenchBrowserAgentModeInfo;
    readonly reloaded: true;
    readonly ignoreCache: boolean;
  }> => {
    const timeoutMs = request.timeoutMs ?? 12_000;
    const ignoreCache = request.ignoreCache === true;
    const target = await resolveBrowserAgentTarget(tabId, request, timeoutMs);
    const addressBeforeReload = agentTargetAddress(target);
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "navigate",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: Math.max(1_800, Math.min(5_000, timeoutMs))
    });
    await waitForAgentPageReload(target.webContents, timeoutMs, {
      ignoreCache,
      waitForReady: true
    });
    if (target.liveEntry !== undefined) {
      const entry = target.liveEntry;
      const address = normalizeAddress(entry.webContents.getURL()) ?? addressBeforeReload;
      const title = normalizeString(entry.webContents.getTitle()) ?? entry.runtime.title ?? address;
      entry.requestedAddress = address;
      invalidateBrowserAgentTargets(tabId, target.targetMode, "frameReload");
      return {
        address,
        tabId,
        title,
        targetMode: "live",
        browserMode: target.browserMode,
        reloaded: true,
        ignoreCache
      };
    }
    const shadow = target as BrowserAgentShadowEntry;
    shadow.detached = true;
    shadow.address = normalizeAddress(shadow.webContents.getURL()) ?? shadow.address;
    shadow.title = normalizeString(shadow.webContents.getTitle()) ?? shadow.title;
    invalidateBrowserAgentTargets(tabId, shadow.targetMode, "frameReload");
    return {
      address: shadow.address,
      tabId,
      title: shadow.title,
      targetMode: shadow.targetMode,
      browserMode: target.browserMode,
      reloaded: true,
      ignoreCache
    };
  };

  const readAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly strategy?: WorkbenchBrowserAgentObserveStrategy;
      readonly scope?: "viewport" | "full";
      readonly maxChars?: number;
      readonly timeoutMs?: number;
      readonly waitTargetRef?: string;
      readonly waitOperationId?: string;
      readonly responseStateOnly?: boolean;
      readonly textTail?: boolean;
      readonly waitText?: string;
    }
  ) => {
    const timeoutMs = normalizeExecuteScriptTimeoutMs(request.timeoutMs, 8_000);
    const target = await resolveBrowserAgentTarget(tabId, request, timeoutMs);
    if (request.waitOperationId) {
      const response = await readResponseWatch(target, request.waitOperationId, Math.min(timeoutMs, 1000));
      const stateOnly = request.responseStateOnly && response.status !== "complete";
      const read = stateOnly ? { content: "", text: "", truncated: false }
        : await readAgentRecentTextFromTarget(target, request.maxChars, timeoutMs, request.scope ?? "full", undefined, true);
      return { ...read, tabId, targetMode: target.targetMode, browserMode: target.browserMode,
        url: agentTargetAddress(target), title: target.webContents.getTitle?.() ?? target.title,
        waitState: { ...("waitState" in read ? read.waitState : undefined), readyState: target.isLoading ? "loading" : "complete", busy: response.status === "streaming", response } };
    }
    if (request.waitTargetRef !== undefined) {
      const cached = readBrowserAgentCacheEntry(tabId, target.targetMode);
      const element = cached?.elements.find(element => element.targetRef === request.waitTargetRef);
      if (!element) {
        throw new Error("Wait targetRef must come from the current page map");
      }
      const frame = target.webContents.mainFrame.framesInSubtree.find(frame => frame.frameTreeNodeId === element.frameTreeNodeId);
      if (!frame || frame.isDestroyed()) throw new Error("Wait target frame is unavailable; refresh the map");
      const limit = Math.max(512, Math.min(6000, Math.round(request.maxChars ?? 4000)));
      const raw = await runFrameScriptWithTimeout(
        () => frame.executeJavaScript(buildVisiblePageReadScript(request.scope ?? "viewport", limit, request.waitTargetRef, undefined, undefined, request.textTail, request.waitText), true), timeoutMs
      ) as { text?: unknown; truncated?: boolean; waitState?: WorkbenchBrowserWaitState };
      if (typeof raw?.text !== "string" || !raw.waitState?.target) throw new Error("Invalid target wait observation");
      return { tabId, targetMode: target.targetMode, browserMode: target.browserMode,
        url: agentTargetAddress(target), title: target.webContents.getTitle?.() ?? target.title,
        scope: "main" as const, text: raw.text, content: raw.text, startChar: 0, endChar: raw.text.length,
        totalChars: raw.text.length, truncated: raw.truncated === true, hasMore: raw.truncated === true,
        waitState: { ...raw.waitState, ...(raw.waitState.coverage === undefined ? {} : { coverage: { ...raw.waitState.coverage, frameRef: element.frameRef } }) }, extractionMethod: "lumen:target-wait" };
    }
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "read",
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: Math.max(900, Math.min(3_200, timeoutMs))
    });
    if (request.strategy === "domFallback" && request.scope !== "viewport") {
      return { ...await readAgentDomSummaryFromTarget(target, request.maxChars, timeoutMs),
        url: agentTargetAddress(target), title: target.webContents.getTitle?.() ?? target.title };
    }
    return { ...await readAgentRecentTextFromTarget(target, request.maxChars, timeoutMs, request.scope ?? "viewport", request.waitTargetRef, request.textTail, request.waitText),
      url: agentTargetAddress(target), title: target.webContents.getTitle?.() ?? target.title };
  };

  const captureAgentPage = async (
    tabId: string,
    request?: WorkbenchBrowserAgentModeRequest & {
      readonly highlightTargets?: boolean;
      readonly highlightTargetRefs?: readonly string[];
      readonly downsampleForVision?: boolean;
      readonly prebuiltHighlightRegions?: readonly import("../types").LumenScreenshotHighlightRegion[];
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
    // When the caller supplies pre-built highlight regions (e.g. AX-derived
    // annotations for browser.see annotate mode), use them directly instead of
    // rebuilding from the Lumen DOM cache entry.
    const highlightRegions = Array.isArray(request?.prebuiltHighlightRegions)
      ? request!.prebuiltHighlightRegions
      : shouldHighlight
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

  // The composer only needs identity. Reading it must not capture a page or
  // resolve/create a browser target just because the indicator is visible.
  const readAgentPreviewPage: WorkbenchBrowserViewManager["readAgentPreviewPage"] = async (
    tabId,
    targetMode
  ) => {
    if (targetMode === "live") {
      const entry = entries.get(tabId);
      if (entry === undefined || entry.isDestroyed || entry.webContents.isDestroyed()) {
        return null;
      }
      const faviconUrl = normalizeString(entry.runtime.faviconUrl);
      return {
        tabId,
        targetMode,
        url: entry.runtime.address,
        title: entry.runtime.title,
        ...(faviconUrl === null ? {} : { faviconUrl })
      };
    }
    const shadow = readBrowserAgentShadow(tabId);
    if (shadow === undefined || shadow.webContents.isDestroyed()) {
      return null;
    }
    const faviconUrl = normalizeString(shadow.faviconUrl);
    return {
      tabId,
      targetMode,
      url: normalizeAddress(shadow.webContents.getURL()) ?? shadow.address,
      title: normalizeString(shadow.webContents.getTitle()) ?? shadow.title,
      ...(faviconUrl === null ? {} : { faviconUrl })
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
    readAgentPreviewPage,
    navigateAgentPage,
    reloadAgentPage,
    readAgentFollowFinalPageState,
    readAgentPage,
    showAgentActivity
  };
};
