import type {
  BrowserTabObservation,
  TerminalObservation,
  WorkbenchTabExtractTextRequest,
  WorkbenchTabExtractTextResult,
  WorkbenchObservedTabDescriptor,
  WorkbenchTabObservationResult,
  WorkbenchTabReadRequest,
  WorkbenchTabsListRequest,
  WorkbenchTabsListResult,
  WorkbenchVisualCaptureRequest,
  WorkbenchVisualCaptureResult,
  WorkbenchWorkspaceReadRequest,
  WorkbenchWorkspaceSnapshot
} from "../../shared/workbench-observation";
import type { TerminalIpcBridge } from "../terminal/types";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import type { WorkbenchDocumentsService } from "../workbench-documents/types";
import { captureBrowserVisual } from "./browser/capture_visual";
import { extractBrowserText } from "./browser/extract_text";
import { readBrowserDomSummary } from "./browser/read_dom";
import { readBrowserRuntimeState } from "./browser/read_state";
import { ResultCache } from "./result-cache";
import { WorkbenchObservationTabRegistry } from "./tab-registry";
import { accumulateExtractedText } from "./text/accumulate";
import { createExtractedObservationText } from "./text/flatten";
import type {
  WorkbenchObservationRendererClient,
  WorkbenchObservationService
} from "./types";

const DEFAULT_MAX_CHARS = 12_000;
const DEFAULT_EXTRACT_MAX_CHARS = 28_000;
const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_BYTES = 16_000;
const DEFAULT_MAX_LINKS = 50;
const DEFAULT_MAX_HEADINGS = 40;
const DEFAULT_MAX_FORMS = 20;

type ObservationErrorCode =
  | "tab_not_found"
  | "renderer_timeout"
  | "renderer_bridge_unavailable"
  | "unsupported_tab_kind"
  | "browser_capture_unavailable"
  | "background_visual_capture_unsupported";

const createObservationError = (code: ObservationErrorCode, message: string): Error => {
  const error = new Error(message) as Error & { code: ObservationErrorCode };
  error.code = code;
  return error;
};

const mapRendererError = (error: unknown): Error => {
  if (
    error !== null
    && typeof error === "object"
    && typeof (error as { code?: unknown }).code === "string"
    && typeof (error as { message?: unknown }).message === "string"
  ) {
    return createObservationError(
      (error as { code: ObservationErrorCode }).code,
      (error as { message: string }).message
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes("timed out")) {
    return createObservationError("renderer_timeout", message);
  }
  return createObservationError("renderer_bridge_unavailable", message);
};

const normalizeReadRequest = (
  request: WorkbenchTabReadRequest
): Required<Pick<WorkbenchTabReadRequest, "tabId">> & {
  readonly detail: "summary" | "full";
  readonly maxChars: number;
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly paneId?: string;
  readonly includeVisual: boolean;
} => ({
  tabId: request.tabId,
  detail: request.detail ?? "summary",
  maxChars: Math.max(1, request.maxChars ?? DEFAULT_MAX_CHARS),
  maxEntries: Math.max(1, request.maxEntries ?? DEFAULT_MAX_ENTRIES),
  maxBytes: Math.max(1, request.maxBytes ?? DEFAULT_MAX_BYTES),
  ...(typeof request.paneId === "string" && request.paneId.trim().length > 0
    ? { paneId: request.paneId.trim() }
    : {}),
  includeVisual: request.includeVisual === true
});

const createReadCacheKey = (
  request: ReturnType<typeof normalizeReadRequest>
): string => JSON.stringify(request);

const normalizeExtractTextRequest = (
  request: WorkbenchTabExtractTextRequest
): Required<Pick<WorkbenchTabExtractTextRequest, "tabId">> & {
  readonly scope: "main" | "full";
  readonly cursor: number;
  readonly maxChars: number;
  readonly maxEntries: number;
  readonly maxBytes: number;
  readonly paneId?: string;
} => {
  const cursor = Math.max(0, Math.round(request.cursor ?? 0));
  const rawMaxChars = Math.max(1, request.maxChars ?? DEFAULT_EXTRACT_MAX_CHARS);
  return {
    tabId: request.tabId,
    scope: request.scope === "full" ? "full" : "main",
    cursor,
    maxChars:
      cursor > 0
        ? rawMaxChars
        : Math.max(DEFAULT_EXTRACT_MAX_CHARS, rawMaxChars),
    maxEntries: Math.max(1, request.maxEntries ?? DEFAULT_MAX_ENTRIES),
    maxBytes: Math.max(1, request.maxBytes ?? DEFAULT_MAX_BYTES),
    ...(typeof request.paneId === "string" && request.paneId.trim().length > 0
      ? { paneId: request.paneId.trim() }
      : {})
  };
};

const createExtractCacheKey = (
  request: ReturnType<typeof normalizeExtractTextRequest>
): string => JSON.stringify(request);

const isBrowserDescriptor = (tab: WorkbenchObservedTabDescriptor): boolean =>
  tab.observationKind === "page";

const buildBrowserObservation = async (
  browserBridge: WorkbenchBrowserIpcBridge,
  documentsService: WorkbenchDocumentsService,
  tab: WorkbenchObservedTabDescriptor,
  request: ReturnType<typeof normalizeReadRequest>
): Promise<WorkbenchTabObservationResult> => {
  const runtimeState = readBrowserRuntimeState(browserBridge, tab.tabId);
  if (runtimeState === null) {
    throw createObservationError("tab_not_found", `Unknown browser tab: ${tab.tabId}`);
  }

  const domSummary = await readBrowserDomSummary(browserBridge, tab.tabId, {
    maxChars: request.maxChars,
    maxLinks: request.detail === "full" ? request.maxEntries : DEFAULT_MAX_LINKS,
    maxHeadings: request.detail === "full" ? DEFAULT_MAX_HEADINGS * 2 : DEFAULT_MAX_HEADINGS,
    maxForms: request.detail === "full" ? DEFAULT_MAX_FORMS * 2 : DEFAULT_MAX_FORMS
  });

  const observation: BrowserTabObservation = {
    kind: "page",
    title: runtimeState.title,
    address: runtimeState.address,
    ...(runtimeState.faviconUrl === undefined ? {} : { faviconUrl: runtimeState.faviconUrl }),
    isLoading: runtimeState.isLoading,
    canGoBack: runtimeState.canGoBack,
    canGoForward: runtimeState.canGoForward,
    ...(domSummary.domTitle === undefined ? {} : { domTitle: domSummary.domTitle }),
    ...(domSummary.documentLanguage === undefined
      ? {}
      : { documentLanguage: domSummary.documentLanguage }),
    ...(domSummary.selectionText === undefined ? {} : { selectionText: domSummary.selectionText }),
    headings: domSummary.headings,
    mainTextExcerpt: domSummary.mainTextExcerpt,
    links: domSummary.links,
    forms: domSummary.forms,
    truncated: domSummary.truncated,
    ...(await documentsService.detectActiveDocument(tab.tabId).then((document) =>
      document === null
        ? {}
        : {
            activeDocument: {
              detected: true as const,
              format: document.formatHint,
              sourceKind: document.sourceKind,
              ...(document.titleHint === undefined ? {} : { title: document.titleHint }),
              ...(document.currentPageIndex === undefined
                ? {}
                : { currentPageIndex: document.currentPageIndex }),
              ...(document.pageCountHint === undefined ? {} : { pageCount: document.pageCountHint }),
              preferredTool: "workbench.document.inspect" as const
            }
          }
    ))
  };

  let visual: WorkbenchVisualCaptureResult | undefined;
  if (request.includeVisual && runtimeState.isVisible) {
    try {
      visual = await captureBrowserVisual(browserBridge, tab.tabId);
    } catch {
      visual = undefined;
    }
  }

  return {
    tab,
    observation,
    ...(visual === undefined ? {} : { visual })
  };
};

const enrichTerminalObservation = async (
  terminalBridge: TerminalIpcBridge,
  result: WorkbenchTabObservationResult,
  request: ReturnType<typeof normalizeReadRequest>
): Promise<WorkbenchTabObservationResult> => {
  if (result.observation.kind !== "terminal") {
    return result;
  }

  const paneId = request.paneId ?? result.observation.activePaneId;
  const pane = result.observation.panes.find((entry) => entry.paneId === paneId);
  if (pane === undefined) {
    throw createObservationError("tab_not_found", `Unknown terminal pane: ${paneId}`);
  }

  const session = await terminalBridge.readCapabilitySession({
    sessionId: pane.sessionId,
    maxBytes: request.maxBytes,
    waitMs: 50
  });

  const observation: TerminalObservation = {
    ...result.observation,
    activePaneId: pane.paneId,
    activeOutput: session.output,
    running: session.running,
    exitCode: session.exitCode,
    truncated: result.observation.truncated || session.truncated
  };

  return {
    ...result,
    observation
  };
};

const readVisibleTabs = async (
  service: Pick<WorkbenchObservationService, "readTab" | "listTabs">,
  request?: WorkbenchWorkspaceReadRequest
): Promise<WorkbenchWorkspaceSnapshot> => {
  const listed = await service.listTabs({
    scope: "visible",
    includeUnsupported: false
  });
  const visibleTabs = await Promise.all(
    listed.tabs.map(async (tab) => {
      const tabReadRequest: WorkbenchTabReadRequest = {
        tabId: tab.tabId,
        maxChars: DEFAULT_MAX_CHARS,
        maxEntries: DEFAULT_MAX_ENTRIES,
        maxBytes: DEFAULT_MAX_BYTES,
        ...(request?.detail === undefined ? {} : { detail: request.detail }),
        ...(request?.includeVisual === true ? { includeVisual: true } : {})
      };
      return await service.readTab(tabReadRequest);
    })
  );

  return {
    layoutMode: visibleTabs.length > 1 ? "split" : "single",
    activeTabId: listed.activeTabId,
    focusedTabId: listed.tabs.find((tab) => tab.focusedPane)?.tabId ?? listed.activeTabId,
    visibleTabs
  };
};

export const createWorkbenchObservationService = ({
  browserBridge,
  documentsService,
  rendererClient,
  terminalBridge
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly documentsService: WorkbenchDocumentsService;
  readonly rendererClient: WorkbenchObservationRendererClient;
  readonly terminalBridge: TerminalIpcBridge;
}): WorkbenchObservationService => {
  const registry = new WorkbenchObservationTabRegistry(rendererClient.listLocalTabs);
  const readCache = new ResultCache<WorkbenchTabObservationResult>(750);
  const extractCache = new ResultCache<WorkbenchTabExtractTextResult>(750);

  const readTab = async (request: WorkbenchTabReadRequest): Promise<WorkbenchTabObservationResult> => {
    const normalizedRequest = normalizeReadRequest(request);
    const cacheKey = createReadCacheKey(normalizedRequest);
    const cached = readCache.read(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const tab = await registry.get(normalizedRequest.tabId);
    if (tab === null) {
      throw createObservationError("tab_not_found", `Unknown tab: ${normalizedRequest.tabId}`);
    }
    if (!tab.observable || tab.observationKind === undefined) {
      throw createObservationError(
        "unsupported_tab_kind",
        `Observation is unsupported for ${tab.pageKind}.`
      );
    }

    const result = isBrowserDescriptor(tab)
      ? await buildBrowserObservation(browserBridge, documentsService, tab, normalizedRequest)
      : await rendererClient.readLocalTab(normalizedRequest).catch((error: unknown) => {
          throw mapRendererError(error);
        });

    const enriched = await enrichTerminalObservation(terminalBridge, result, normalizedRequest);
    readCache.write(cacheKey, enriched);
    return enriched;
  };

  const extractTabText = async (
    request: WorkbenchTabExtractTextRequest
  ): Promise<WorkbenchTabExtractTextResult> => {
    const normalizedRequest = normalizeExtractTextRequest(request);
    const cacheKey = createExtractCacheKey(normalizedRequest);
    const cached = extractCache.read(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const tab = await registry.get(normalizedRequest.tabId);
    if (tab === null) {
      throw createObservationError("tab_not_found", `Unknown tab: ${normalizedRequest.tabId}`);
    }
    if (!tab.observable || tab.observationKind === undefined) {
      throw createObservationError(
        "unsupported_tab_kind",
        `Text extraction is unsupported for ${tab.pageKind}.`
      );
    }

    const result = isBrowserDescriptor(tab)
      ? await accumulateExtractedText({
          initial: await extractBrowserText(browserBridge, normalizedRequest.tabId, {
            scope: normalizedRequest.scope,
            cursor: normalizedRequest.cursor,
            maxChars: normalizedRequest.maxChars
          }),
          maxCharsPerFetch: normalizedRequest.maxChars,
          fetchChunk: async (cursor, maxChars) =>
            await extractBrowserText(browserBridge, normalizedRequest.tabId, {
              scope: normalizedRequest.scope,
              cursor,
              maxChars
            })
        })
      : await accumulateExtractedText({
          initial: createExtractedObservationText({
            tabId: normalizedRequest.tabId,
            scope: normalizedRequest.scope,
            cursor: normalizedRequest.cursor,
            observation: (
              await readTab({
                tabId: normalizedRequest.tabId,
                detail: "full",
                maxChars: normalizedRequest.cursor + normalizedRequest.maxChars,
                maxEntries: normalizedRequest.maxEntries,
                maxBytes: normalizedRequest.cursor + normalizedRequest.maxBytes,
                ...(normalizedRequest.paneId === undefined
                  ? {}
                  : { paneId: normalizedRequest.paneId })
              })
            ).observation,
            maxChars: normalizedRequest.maxChars
          }),
          maxCharsPerFetch: normalizedRequest.maxChars,
          fetchChunk: async (cursor, maxChars) =>
            createExtractedObservationText({
              tabId: normalizedRequest.tabId,
              scope: normalizedRequest.scope,
              cursor,
              observation: (
                await readTab({
                  tabId: normalizedRequest.tabId,
                  detail: "full",
                  maxChars: cursor + maxChars,
                  maxEntries: normalizedRequest.maxEntries,
                  maxBytes: cursor + normalizedRequest.maxBytes,
                  ...(normalizedRequest.paneId === undefined
                    ? {}
                    : { paneId: normalizedRequest.paneId })
                })
              ).observation,
              maxChars
            })
        });

    extractCache.write(cacheKey, result);
    return result;
  };

  const service: WorkbenchObservationService = {
    dispose: () => {
      registry.clear();
      readCache.clear();
      extractCache.clear();
    },
    listTabs: async (request?: WorkbenchTabsListRequest): Promise<WorkbenchTabsListResult> =>
      await registry.list(request),
    readWorkspace: async (
      request?: WorkbenchWorkspaceReadRequest
    ): Promise<WorkbenchWorkspaceSnapshot> => await readVisibleTabs(service, request),
    extractTabText,
    readTab,
    captureVisual: async (
      request: WorkbenchVisualCaptureRequest
    ): Promise<WorkbenchVisualCaptureResult> => {
      const tab = await registry.get(request.tabId);
      if (tab === null) {
        throw createObservationError("tab_not_found", `Unknown tab: ${request.tabId}`);
      }
      if (!isBrowserDescriptor(tab)) {
        throw createObservationError(
          "browser_capture_unavailable",
          `Visual capture is unsupported for ${tab.pageKind}.`
        );
      }
      try {
        return await captureBrowserVisual(browserBridge, request.tabId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("background_visual_capture_unsupported")) {
          throw createObservationError("background_visual_capture_unsupported", message);
        }
        throw createObservationError("browser_capture_unavailable", message);
      }
    }
  };

  return service;
};
