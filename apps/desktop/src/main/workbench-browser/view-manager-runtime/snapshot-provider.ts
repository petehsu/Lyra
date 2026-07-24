import type { WebContents } from "electron";

import type {
  WorkbenchBrowserNavigateRequest
} from "../../../shared/desktop-bridge";
import type {
  WorkbenchTabExtractTextResult,
  WorkbenchVisualCaptureResult,
  WorkbenchVisualFrame
} from "../../../shared/workbench-observation";
import type {
  BrowserDomSummaryReadOptions,
  BrowserTextExtractOptions
} from "../../workbench-observation/browser/types";
import type { WorkbenchObservationBrowserDomSummary } from "../../workbench-observation/types";
import type {
  WorkbenchBrowserAgentPoint,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserAgentVisualStaleResult,
  BrowserAxNode,
  WorkbenchBrowserDebuggerSession
} from "../types";
import { createPageContentRuntime } from "./page-content-runtime";
import { createRenderedSnapshotRuntime } from "./rendered-snapshot-runtime";
import {
  hashStableString,
  normalizeExecuteScriptTimeoutMs,
  runFrameScriptWithTimeout
} from "./normalizers";
import type {
  BrowserAgentPageTarget,
  BrowserAgentViewportState,
  BrowserPageEntry
} from "./types";

type SnapshotProviderHost = {
  readonly entries: Map<string, BrowserPageEntry>;
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
  readonly readLiveViewBounds: (
    tabId: string,
    target: BrowserAgentPageTarget
  ) => {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly readIsolatedViewBounds: (
    tabId: string,
    target: BrowserAgentPageTarget
  ) => {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
};

export const createSnapshotProvider = ({
  entries,
  requireEntry,
  navigateInEntry,
  getActiveOrFocusedTabId,
  waitForPageLoad,
  openDebuggerSession,
  readAxNodes,
  readLiveViewBounds,
  readIsolatedViewBounds
}: SnapshotProviderHost) => {
  const liveViewBoundsEpochByTabId = new Map<string, number>();
  const visualFrameByCaptureId = new Map<
    string,
    {
      readonly tabId: string;
      readonly targetMode: WorkbenchBrowserAgentTargetMode;
      readonly frame: WorkbenchVisualFrame;
    }
  >();
  let visualFrameSequence = 0;

  const pageContentRuntime = createPageContentRuntime({ requireEntry });
  const renderedSnapshotRuntime = createRenderedSnapshotRuntime({
    entries,
    requireEntry,
    navigateInEntry,
    getActiveOrFocusedTabId,
    waitForPageLoad,
    openDebuggerSession,
    readAxNodes
  });

  const bumpLiveViewBoundsEpoch = (tabId: string): number => {
    const next = (liveViewBoundsEpochByTabId.get(tabId) ?? 0) + 1;
    liveViewBoundsEpochByTabId.set(tabId, next);
    return next;
  };

  const readLiveViewBoundsEpoch = (tabId: string): number =>
    liveViewBoundsEpochByTabId.get(tabId) ?? 0;

  const clearTab = (tabId: string): void => {
    liveViewBoundsEpochByTabId.delete(tabId);
    for (const [captureId, record] of visualFrameByCaptureId.entries()) {
      if (record.tabId === tabId) {
        visualFrameByCaptureId.delete(captureId);
      }
    }
  };

  const readAgentViewportState = async (
    target: BrowserAgentPageTarget,
    timeoutMs: number | undefined
  ): Promise<BrowserAgentViewportState> => {
    try {
      const raw = await runFrameScriptWithTimeout(
        () => target.webContents.executeJavaScript(`
          (() => {
            const doc = document.documentElement;
            const body = document.body;
            const width = Math.max(1, Number(window.innerWidth || doc?.clientWidth || 1280));
            const height = Math.max(1, Number(window.innerHeight || doc?.clientHeight || 720));
            const scrollX = Math.max(0, Number(window.scrollX || window.pageXOffset || 0));
            const scrollY = Math.max(0, Number(window.scrollY || window.pageYOffset || 0));
            const scrollWidth = Math.max(
              width,
              Number(doc?.scrollWidth || 0),
              Number(body?.scrollWidth || 0)
            );
            const scrollHeight = Math.max(
              height,
              Number(doc?.scrollHeight || 0),
              Number(body?.scrollHeight || 0)
            );
            return {
              width,
              height,
              scrollX,
              scrollY,
              maxScrollX: Math.max(0, scrollWidth - width),
              maxScrollY: Math.max(0, scrollHeight - height)
            };
          })()
        `, true),
        normalizeExecuteScriptTimeoutMs(timeoutMs, 1_500)
      ) as Record<string, unknown>;
      const number = (key: keyof BrowserAgentViewportState, fallback: number): number => {
        const value = raw[key];
        return typeof value === "number" && Number.isFinite(value) ? value : fallback;
      };
      return {
        width: Math.max(1, Math.round(number("width", 1_280))),
        height: Math.max(1, Math.round(number("height", 720))),
        scrollX: Math.max(0, number("scrollX", 0)),
        scrollY: Math.max(0, number("scrollY", 0)),
        maxScrollX: Math.max(0, number("maxScrollX", 0)),
        maxScrollY: Math.max(0, number("maxScrollY", 0))
      };
    } catch {
      return {
        width: 1_280,
        height: 720,
        scrollX: 0,
        scrollY: 0,
        maxScrollX: 0,
        maxScrollY: 0
      };
    }
  };

  const readAgentDevicePixelRatio = async (
    target: BrowserAgentPageTarget,
    timeoutMs: number | undefined
  ): Promise<number> => {
    try {
      const raw = await runFrameScriptWithTimeout(
        () => target.webContents.executeJavaScript(
          "Number(window.devicePixelRatio || 1)",
          true
        ),
        normalizeExecuteScriptTimeoutMs(timeoutMs, 1_000)
      );
      return typeof raw === "number" && Number.isFinite(raw)
        ? Math.max(0.1, raw)
        : 1;
    } catch {
      return 1;
    }
  };

  const visualBoundsForTarget = (
    tabId: string,
    target: BrowserAgentPageTarget
  ): {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } => target.targetMode === "live"
    ? readLiveViewBounds(tabId, target)
    : readIsolatedViewBounds(tabId, target);

  const buildVisualFrameHash = (input: {
    readonly tabId: string;
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly dpr: number;
    readonly cssViewportWidth: number;
    readonly cssViewportHeight: number;
    readonly imageWidth: number;
    readonly imageHeight: number;
    readonly imageScale: number;
    readonly scrollX: number;
    readonly scrollY: number;
    readonly viewBoundsEpoch: number;
    readonly bounds: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
  }): string => hashStableString([
    input.tabId,
    input.targetMode,
    input.dpr.toFixed(4),
    Math.round(input.cssViewportWidth),
    Math.round(input.cssViewportHeight),
    Math.round(input.imageWidth),
    Math.round(input.imageHeight),
    input.imageScale.toFixed(4),
    Math.round(input.scrollX),
    Math.round(input.scrollY),
    input.viewBoundsEpoch,
    input.bounds.x,
    input.bounds.y,
    input.bounds.width,
    input.bounds.height
  ].join("|"));

  const createVisualFrame = async ({
    tabId,
    target,
    imageWidth,
    imageHeight,
    timeoutMs
  }: {
    readonly tabId: string;
    readonly target: BrowserAgentPageTarget;
    readonly imageWidth: number;
    readonly imageHeight: number;
    readonly timeoutMs?: number;
  }): Promise<WorkbenchVisualFrame> => {
    const [viewport, dpr] = await Promise.all([
      readAgentViewportState(target, timeoutMs),
      readAgentDevicePixelRatio(target, timeoutMs)
    ]);
    const bounds = visualBoundsForTarget(tabId, target);
    const viewBoundsEpoch =
      target.targetMode === "live" ? readLiveViewBoundsEpoch(tabId) : 0;
    const base = {
      tabId,
      targetMode: target.targetMode,
      dpr,
      cssViewportWidth: viewport.width,
      cssViewportHeight: viewport.height,
      imageWidth,
      imageHeight,
      imageScale: 1,
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      viewBoundsEpoch,
      bounds
    };
    const viewBoundsHash = buildVisualFrameHash(base);
    visualFrameSequence += 1;
    return {
      captureId: `lumen-visual-${Date.now().toString(36)}-${visualFrameSequence}-${viewBoundsHash}`,
      dpr,
      cssViewportWidth: viewport.width,
      cssViewportHeight: viewport.height,
      imageWidth,
      imageHeight,
      imageScale: 1,
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      viewBoundsHash,
      viewBoundsEpoch
    };
  };

  const rememberVisualFrame = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    frame: WorkbenchVisualFrame
  ): void => {
    visualFrameByCaptureId.set(frame.captureId, { tabId, targetMode, frame });
    while (visualFrameByCaptureId.size > 48) {
      const oldest = visualFrameByCaptureId.keys().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      visualFrameByCaptureId.delete(oldest);
    }
  };

  const readVisualFrame = (
    captureId: string
  ): {
    readonly tabId: string;
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly frame: WorkbenchVisualFrame;
  } | undefined => visualFrameByCaptureId.get(captureId);

  const visualStaleResult = ({
    tabId,
    targetMode,
    captureId,
    reason,
    message
  }: {
    readonly tabId: string;
    readonly targetMode?: WorkbenchBrowserAgentTargetMode;
    readonly captureId: string;
    readonly reason: WorkbenchBrowserAgentVisualStaleResult["reason"];
    readonly message: string;
  }): WorkbenchBrowserAgentVisualStaleResult => ({
    ok: false,
    kind: "lyraLumenVactStale",
    tabId,
    ...(targetMode === undefined ? {} : { targetMode }),
    captureId,
    reason,
    message,
    nextRecommendedAction: "lyra_lumen.see"
  });

  const cssPointFromVisualFrame = (
    point: WorkbenchBrowserAgentPoint,
    frame: WorkbenchVisualFrame
  ): WorkbenchBrowserAgentPoint => {
    const scale = Math.max(0.0001, frame.imageScale || 1);
    const dpr = Math.max(0.0001, frame.dpr || 1);
    return {
      x: point.x / dpr / scale,
      y: point.y / dpr / scale,
      ...(point.reason === undefined ? {} : { reason: point.reason })
    };
  };

  const captureLivePage = async (tabId: string): Promise<WorkbenchVisualCaptureResult> =>
    await pageContentRuntime.capturePage(tabId);

  const captureTargetPage = async (
    tabId: string,
    target: BrowserAgentPageTarget
  ): Promise<WorkbenchVisualCaptureResult> => {
    if (target.targetMode === "live") {
      return await captureLivePage(tabId);
    }
    const image = await target.webContents.capturePage();
    const size = image.getSize();
    return {
      tabId,
      mimeType: "image/png",
      imageBase64: image.toPNG().toString("base64"),
      width: size.width,
      height: size.height,
      visibleOnly: false
    };
  };

  return {
    bumpLiveViewBoundsEpoch,
    capturePage: captureLivePage,
    captureTargetPage,
    clearTab,
    createVisualFrame,
    cssPointFromVisualFrame,
    extractPageText: async (
      tabId: string,
      options?: BrowserTextExtractOptions
    ): Promise<WorkbenchTabExtractTextResult> =>
      await pageContentRuntime.extractPageText(tabId, options),
    readAgentDevicePixelRatio,
    readAgentViewportState,
    readLiveViewBoundsEpoch,
    readPageDomSummary: async (
      tabId: string,
      options?: BrowserDomSummaryReadOptions
    ): Promise<WorkbenchObservationBrowserDomSummary> =>
      await pageContentRuntime.readPageDomSummary(tabId, options),
    readRenderedSnapshot: async (payload: unknown): Promise<unknown> =>
      await renderedSnapshotRuntime.readRenderedSnapshot(payload),
    readVisualFrame,
    rememberVisualFrame,
    visualStaleResult
  };
};
