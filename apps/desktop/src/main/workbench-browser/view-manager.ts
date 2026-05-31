import {
  BrowserWindow,
  View,
  WebContentsView,
  shell,
  type Rectangle,
  type WebContents,
  type WebFrameMain
} from "electron";

import type {
  WorkbenchBrowserEvent,
  WorkbenchBrowserChromePopoverRequest,
  WorkbenchBrowserLayoutSnapshot,
  WorkbenchBrowserNavigateRequest,
  WorkbenchBrowserNavigateResult,
  WorkbenchBrowserPageDiagnosticEntry,
  WorkbenchBrowserPageLayout,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserPageSpec,
  WorkbenchBrowserReadPageStateRequest,
  WorkbenchBrowserSearchInPageMatch,
  WorkbenchBrowserSearchInPageRequest,
  WorkbenchBrowserSearchInPageResult,
  WorkbenchBrowserTopologySnapshot,
  WorkbenchBrowserWebThemeSnapshot
} from "../../shared/desktop-bridge";
import type {
  WorkbenchTabExtractTextResult,
  WorkbenchVisualCaptureResult
} from "../../shared/workbench-observation";
import type {
  BrowserDomSummaryReadOptions,
  BrowserTextExtractOptions
} from "../workbench-observation/browser/types";
import type { WorkbenchObservationBrowserDomSummary } from "../workbench-observation/types";
import {
  buildAgentCursorOverlayScript,
  type BrowserAgentCursorOverlayAction,
  type BrowserAgentCursorOverlayPhase
} from "./agent-cursor-overlay";
import {
  buildBrowserChromePopoverDocument,
  resolveBrowserChromePopoverHeight
} from "./chrome-popover-overlay";
import {
  buildFrameDomProbeScript,
  normalizeFrameDomProbeResult
} from "./frame-probe";
import { createWorkbenchBrowserSharedDebuggerSession } from "./debugger";
import { createWorkbenchBrowserElementPickerController } from "./element-picker/controller";
import { extractTextFromPage } from "./page-text-extractor";
import { createWebThemeInjector } from "./web-theme";
import { WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID } from "./types";
import type {
  WorkbenchBrowserAgentActionResult,
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentFocusDirection,
  WorkbenchBrowserAgentFocusResult,
  WorkbenchBrowserAgentFocusTrailEntry,
  WorkbenchBrowserAgentInteraction,
  WorkbenchBrowserAgentObservation,
  WorkbenchBrowserAgentObserveStrategy,
  WorkbenchBrowserAgentPoint,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserDebuggerSession,
  WorkbenchBrowserElementPickerController,
  WorkbenchBrowserFrameGlobalBounds,
  WorkbenchBrowserNativeInputEvent,
  WorkbenchBrowserPublishEvent,
  WorkbenchBrowserViewManager
} from "./types";

type BrowserPageEntry = {
  readonly tabId: string;
  readonly view: WebContentsView;
  readonly webContents: WebContents;
  requestedAddress: string;
  titleHint: string | null;
  attached: boolean;
  viewVisible: boolean;
  isDestroyed: boolean;
  layout: WorkbenchBrowserPageLayout | null;
  runtime: WorkbenchBrowserPageRuntimeState;
  readonly disposeListeners: () => void;
};

type BrowserAgentPageTarget = {
  readonly tabId: string;
  readonly webContents: WebContents;
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly liveEntry?: BrowserPageEntry;
  address: string;
  title: string;
  isLoading: boolean;
};

type BrowserAgentShadowEntry = BrowserAgentPageTarget & {
  readonly window: BrowserWindow;
  readonly sourceTabId: string;
  detached: boolean;
};

type BrowserPageTombstone = {
  readonly tabId: string;
  requestedAddress: string;
  titleHint: string | null;
  runtime: WorkbenchBrowserPageRuntimeState;
  readonly tombstonedAt: number;
};

type BrowserAgentCacheEntry = {
  readonly observationId: string;
  readonly elements: readonly WorkbenchBrowserAgentElement[];
  readonly elementsByTargetRef: ReadonlyMap<string, WorkbenchBrowserAgentElement>;
  readonly url: string;
  readonly title: string;
};

type BrowserAgentFollowSession = {
  readonly sessionId: string;
  readonly tabId: string;
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly startedAt: number;
  updatedAt: number;
  totalActions: number;
  interruptedCount: number;
  readonly actions: Array<{
    readonly id: string;
    readonly at: number;
    readonly tabId: string;
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly action: BrowserAgentCursorOverlayAction;
    readonly interaction?: WorkbenchBrowserAgentInteraction;
    readonly cursorPhase?: BrowserAgentCursorOverlayPhase;
    readonly inputActive: boolean;
    readonly cursor?: { readonly x: number; readonly y: number };
  }>;
};

const DEFAULT_PAGE_TITLE = "New Tab";
const HIDDEN_PAGE_TOMBSTONE_DELAY_MS = 45_000;
const MAX_BROWSER_AGENT_FOLLOW_ACTIONS = 240;
const MAX_BROWSER_PAGE_DIAGNOSTICS = 180;

const hashStableString = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const browserAgentTargetFingerprint = (
  pageUrl: string,
  element: Pick<
    WorkbenchBrowserAgentElement,
    | "frameTreeNodeId"
    | "tagName"
    | "role"
    | "label"
    | "selectorPreview"
    | "bounds"
    | "href"
    | "inputType"
    | "frameUrl"
    | "discoveryScope"
  >
): string => [
  element.frameUrl ?? pageUrl,
  element.frameTreeNodeId,
  element.tagName,
  element.role,
  element.label,
  element.selectorPreview,
  element.href ?? "",
  element.inputType ?? "",
  element.discoveryScope ?? "document",
  Math.round(element.bounds.x / 8),
  Math.round(element.bounds.y / 8),
  Math.round(element.bounds.width / 8),
  Math.round(element.bounds.height / 8)
].join("|");

const createBrowserAgentTargetRef = (
  pageUrl: string,
  element: Pick<
    WorkbenchBrowserAgentElement,
    | "frameTreeNodeId"
    | "tagName"
    | "role"
    | "label"
    | "selectorPreview"
    | "bounds"
    | "href"
    | "inputType"
    | "frameUrl"
    | "discoveryScope"
  >
): { readonly stableId: string; readonly targetRef: string } => {
  const stableId = hashStableString(browserAgentTargetFingerprint(pageUrl, element));
  return {
    stableId,
    targetRef: `lumen:${stableId}`
  };
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeSearchText = (value: string, caseSensitive: boolean): string =>
  caseSensitive ? value : value.toLocaleLowerCase();

const buildSearchSnippet = (
  text: string,
  startChar: number,
  endChar: number
): string => {
  const snippetStart = Math.max(0, startChar - 90);
  const snippetEnd = Math.min(text.length, endChar + 90);
  const prefix = snippetStart > 0 ? "..." : "";
  const suffix = snippetEnd < text.length ? "..." : "";
  return `${prefix}${text.slice(snippetStart, snippetEnd)}${suffix}`
    .replace(/\s+/gu, " ")
    .trim();
};

const findSearchInPageMatches = (
  text: string,
  query: string,
  request: Pick<WorkbenchBrowserSearchInPageRequest, "caseSensitive" | "maxMatches">
): {
  readonly matches: readonly WorkbenchBrowserSearchInPageMatch[];
  readonly totalMatches: number;
  readonly truncated: boolean;
} => {
  const caseSensitive = request.caseSensitive === true;
  const maxMatches = Math.max(1, Math.min(100, Math.round(request.maxMatches ?? 20)));
  const haystack = normalizeSearchText(text, caseSensitive);
  const needle = normalizeSearchText(query, caseSensitive);
  const matches: WorkbenchBrowserSearchInPageMatch[] = [];
  let totalMatches = 0;
  let cursor = 0;
  while (needle.length > 0 && cursor <= haystack.length) {
    const index = haystack.indexOf(needle, cursor);
    if (index < 0) break;
    totalMatches += 1;
    const endChar = index + query.length;
    if (matches.length < maxMatches) {
      matches.push({
        index: totalMatches,
        startChar: index,
        endChar,
        snippet: buildSearchSnippet(text, index, endChar)
      });
    }
    cursor = Math.max(index + needle.length, index + 1);
  }
  return {
    matches,
    totalMatches,
    truncated: totalMatches > matches.length
  };
};

const normalizeNumber = (value: unknown, fallback = 0): number => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return fallback;
  }
  return Math.round(value);
};

const normalizeAddress = (value: unknown): string | null => {
  let next = normalizeString(value);
  if (next === null) {
    return null;
  }
  if (next === "about:blank") {
    return "about:blank";
  }
  // Automatically prepend "http://" if a protocol/scheme is missing
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(next)) {
    next = "http://" + next;
  }
  try {
    const parsed = new URL(next);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "file:") {
      return null;
    }
    return parsed.toString();
  } catch (_error) {
    return null;
  }
};

const normalizePageSpec = (value: unknown): WorkbenchBrowserPageSpec | null => {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const tabId = normalizeString(record.tabId);
  const address = normalizeAddress(record.address);
  if (tabId === null || address === null) {
    return null;
  }
  const restoreRecord = record.restoreState !== null && typeof record.restoreState === "object"
    ? record.restoreState as Record<string, unknown>
    : null;
  const restoreCapturedAt = Number(restoreRecord?.capturedAt);
  const scrollX = Number(restoreRecord?.scrollX);
  const scrollY = Number(restoreRecord?.scrollY);
  const restoreState = restoreRecord !== null && Number.isFinite(restoreCapturedAt)
    ? {
        ...(Number.isFinite(scrollX) ? { scrollX: Math.max(0, Math.round(scrollX)) } : {}),
        ...(Number.isFinite(scrollY) ? { scrollY: Math.max(0, Math.round(scrollY)) } : {}),
        capturedAt: Math.round(restoreCapturedAt)
      }
    : undefined;
  return {
    tabId,
    address,
    ...(normalizeString(record.titleHint) === null
      ? {}
      : { titleHint: normalizeString(record.titleHint)! }),
    ...(restoreState === undefined ? {} : { restoreState }),
    isActive: record.isActive === true
  };
};

const normalizeTopology = (value: unknown): WorkbenchBrowserTopologySnapshot => {
  if (value === null || typeof value !== "object") {
    return {
      activeTabId: null,
      pages: []
    };
  }
  const record = value as Record<string, unknown>;
  const pages = Array.isArray(record.pages)
    ? record.pages
        .map(normalizePageSpec)
        .filter((entry): entry is WorkbenchBrowserPageSpec => entry !== null)
    : [];
  const explicitActiveTabId = normalizeString(record.activeTabId);
  const activeTabId =
    explicitActiveTabId !== null && pages.some((page) => page.tabId === explicitActiveTabId)
      ? explicitActiveTabId
      : pages.find((page) => page.isActive)?.tabId ?? null;
  return {
    activeTabId,
    pages
  };
};

const normalizePageLayout = (value: unknown): WorkbenchBrowserPageLayout | null => {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const tabId = normalizeString(record.tabId);
  if (tabId === null) {
    return null;
  }
  const width = Math.max(0, normalizeNumber(record.width));
  const height = Math.max(0, normalizeNumber(record.height));
  return {
    tabId,
    x: normalizeNumber(record.x),
    y: normalizeNumber(record.y),
    width,
    height,
    visible: record.visible === true && width > 0 && height > 0,
    zIndex: normalizeNumber(record.zIndex),
    isFocusedPane: record.isFocusedPane === true
  };
};

const normalizeLayout = (value: unknown): WorkbenchBrowserLayoutSnapshot => {
  if (value === null || typeof value !== "object") {
    return {
      windowWidth: 0,
      windowHeight: 0,
      layouts: []
    };
  }
  const record = value as Record<string, unknown>;
  const layouts = Array.isArray(record.layouts)
    ? record.layouts
        .map(normalizePageLayout)
        .filter((entry): entry is WorkbenchBrowserPageLayout => entry !== null)
    : [];
  return {
    windowWidth: Math.max(0, normalizeNumber(record.windowWidth)),
    windowHeight: Math.max(0, normalizeNumber(record.windowHeight)),
    layouts
  };
};

const resolveBrowserCoreKey = (address: string): string => {
  try {
    const parsed = new URL(address);
    return `${parsed.protocol}//${parsed.host}`;
  } catch (_error) {
    return address;
  }
};

const toInitialRuntimeState = (spec: WorkbenchBrowserPageSpec): WorkbenchBrowserPageRuntimeState => ({
  tabId: spec.tabId,
  address: spec.address,
  title: spec.titleHint ?? DEFAULT_PAGE_TITLE,
  lifecycleState: spec.isActive ? "foreground" : "hot-hidden",
  coreKey: resolveBrowserCoreKey(spec.address),
  stateKey: `web-state:${spec.tabId}`,
  isTombstoned: false,
  isActive: spec.isActive,
  isVisible: false,
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  isHtmlFullscreen: false,
  ...(spec.restoreState === undefined ? {} : { restoreState: spec.restoreState }),
  updatedAt: Date.now()
});

const runtimeStateEquals = (
  left: WorkbenchBrowserPageRuntimeState,
  right: WorkbenchBrowserPageRuntimeState
): boolean =>
  left.tabId === right.tabId
  && left.address === right.address
  && left.title === right.title
  && left.faviconUrl === right.faviconUrl
  && left.lifecycleState === right.lifecycleState
  && left.coreKey === right.coreKey
  && left.stateKey === right.stateKey
  && left.isTombstoned === right.isTombstoned
  && left.restoreReason === right.restoreReason
  && left.isActive === right.isActive
  && left.isVisible === right.isVisible
  && left.isLoading === right.isLoading
  && left.canGoBack === right.canGoBack
  && left.canGoForward === right.canGoForward
  && left.isHtmlFullscreen === right.isHtmlFullscreen
  && left.restoreState?.scrollX === right.restoreState?.scrollX
  && left.restoreState?.scrollY === right.restoreState?.scrollY
  && left.restoreState?.capturedAt === right.restoreState?.capturedAt;

const isSupportedWebUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_error) {
    return false;
  }
};

const toBounds = (layout: WorkbenchBrowserPageLayout): Rectangle => ({
  x: layout.x,
  y: layout.y,
  width: Math.max(1, layout.width),
  height: Math.max(1, layout.height)
});

const delay = async (ms: number): Promise<void> => {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const normalizeExecuteScriptTimeoutMs = (value: unknown, fallback = 8_000): number => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return fallback;
  }
  return Math.max(250, Math.min(30_000, Math.round(value)));
};

const runFrameScriptWithTimeout = async <T>(
  execute: () => Promise<T>,
  timeoutMs: number
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new Error(`frame script timed out after ${timeoutMs}ms`) as Error & {
        readonly code?: string;
      };
      (error as { code: string }).code = "script_execution_timeout";
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([execute(), timeoutPromise]);
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
};

const isScriptExecutionTimeout = (error: unknown): boolean =>
  error !== null
  && typeof error === "object"
  && (error as { readonly code?: unknown }).code === "script_execution_timeout";

const toNativeInputEvent = (event: WorkbenchBrowserNativeInputEvent):
  | Electron.MouseInputEvent
  | Electron.MouseWheelInputEvent
  | Electron.KeyboardInputEvent => {
  switch (event.type) {
    case "mouseMove":
    case "mouseDown":
    case "mouseUp":
      return {
        type: event.type,
        x: Math.round(event.x),
        y: Math.round(event.y),
        button: event.button ?? "left",
        clickCount: Math.max(1, Math.round(event.clickCount ?? 1))
      };
    case "keyDown":
    case "keyUp":
    case "char":
      return {
        type: event.type,
        keyCode: event.keyCode,
        modifiers: event.modifiers === undefined ? [] : [...event.modifiers]
      };
  }
};

export const createWorkbenchBrowserViewManager = ({
  getWindow,
  publishEvent,
  onWebContentsCreated
}: {
  readonly getWindow: () => BrowserWindow | null;
  readonly publishEvent: WorkbenchBrowserPublishEvent;
  readonly onWebContentsCreated?: (tabId: string, webContents: WebContents) => () => void;
}): WorkbenchBrowserViewManager => {
  const entries = new Map<string, BrowserPageEntry>();
  const browserAgentShadows = new Map<string, BrowserAgentShadowEntry>();
  const browserAgentCache = new Map<string, BrowserAgentCacheEntry>();
  const browserAgentInputTargets = new Map<
    string,
    {
      readonly observationId?: string;
      readonly element: WorkbenchBrowserAgentElement;
      readonly url: string;
      readonly updatedAt: number;
    }
  >();
  const tombstones = new Map<string, BrowserPageTombstone>();
  const browserSessionSnapshots = new Map<string, WorkbenchBrowserPageRuntimeState["restoreState"]>();
  const followSessions = new Map<string, BrowserAgentFollowSession>();
  const agentControlLocks = new Map<string, number>();
  const agentSyntheticInputUntil = new Map<string, number>();
  const agentControlInterruptions = new Map<string, number>();
  const pageDiagnostics = new Map<string, WorkbenchBrowserPageDiagnosticEntry[]>();
  const activeChromePopovers = new Map<string, WorkbenchBrowserChromePopoverRequest>();
  const tombstoneTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const debuggerSessions = new Map<
    string,
    ReturnType<typeof createWorkbenchBrowserSharedDebuggerSession>
  >();
  const webThemeInjector = createWebThemeInjector({
    onStageFallback: ({ tabId, stage, cause }) => {
      console.warn(
        `[lyra-browser] web-theme stage=${stage} tab=${tabId} fallback engaged:`,
        cause
      );
    }
  });
  const overlayView = new View();
  let overlayAttached = false;
  let overlayVisible = false;
  let topology: WorkbenchBrowserTopologySnapshot = {
    activeTabId: null,
    pages: []
  };
  let layoutSnapshot: WorkbenchBrowserLayoutSnapshot = {
    windowWidth: 0,
    windowHeight: 0,
    layouts: []
  };
  let chromePopoverView: WebContentsView | null = null;
  let chromePopoverViewAttached = false;

  const updateRuntimeState = (
    entry: BrowserPageEntry,
    patch: Partial<WorkbenchBrowserPageRuntimeState>
  ): void => {
    if (entry.isDestroyed) {
      return;
    }
    const nextRuntime: WorkbenchBrowserPageRuntimeState = {
      ...entry.runtime,
      ...patch,
      updatedAt: Date.now()
    };
    if (runtimeStateEquals(entry.runtime, nextRuntime)) {
      return;
    }
    entry.runtime = nextRuntime;
    publishEvent({
      kind: "page-runtime-state",
      page: nextRuntime
    });
  };

  const publishRuntimeState = (runtime: WorkbenchBrowserPageRuntimeState): void => {
    publishEvent({
      kind: "page-runtime-state",
      page: runtime
    });
  };

  const captureBrowserRestoreState = async (
    entry: BrowserPageEntry
  ): Promise<WorkbenchBrowserPageRuntimeState["restoreState"] | undefined> => {
    if (entry.isDestroyed || entry.webContents.isDestroyed()) {
      return entry.runtime.restoreState;
    }
    try {
      const scroll = await entry.webContents.executeJavaScript(`
        (() => ({
          scrollX: Math.max(0, Math.round(window.scrollX || document.documentElement.scrollLeft || 0)),
          scrollY: Math.max(0, Math.round(window.scrollY || document.documentElement.scrollTop || 0))
        }))()
      `, true) as { readonly scrollX?: unknown; readonly scrollY?: unknown };
      const scrollX = Number(scroll.scrollX);
      const scrollY = Number(scroll.scrollY);
      const restoreState = {
        ...(Number.isFinite(scrollX) ? { scrollX: Math.max(0, Math.round(scrollX)) } : {}),
        ...(Number.isFinite(scrollY) ? { scrollY: Math.max(0, Math.round(scrollY)) } : {}),
        capturedAt: Date.now()
      };
      browserSessionSnapshots.set(entry.tabId, restoreState);
      updateRuntimeState(entry, { restoreState });
      return restoreState;
    } catch {
      return entry.runtime.restoreState;
    }
  };

  const applyBrowserRestoreState = async (
    entry: BrowserPageEntry,
    restoreState: WorkbenchBrowserPageRuntimeState["restoreState"] | undefined
  ): Promise<void> => {
    if (
      restoreState === undefined
      || entry.isDestroyed
      || entry.webContents.isDestroyed()
    ) {
      return;
    }
    const scrollX = Number(restoreState.scrollX ?? 0);
    const scrollY = Number(restoreState.scrollY ?? 0);
    if (Number.isFinite(scrollX) === false || Number.isFinite(scrollY) === false) {
      return;
    }
    try {
      await entry.webContents.executeJavaScript(
        `window.scrollTo(${Math.max(0, Math.round(scrollX))}, ${Math.max(0, Math.round(scrollY))});`,
        true
      );
    } catch {
      // Best-effort restoration should not block tab materialization.
    }
  };

  const cancelTombstoneTimer = (tabId: string): void => {
    const timer = tombstoneTimers.get(tabId);
    if (timer === undefined) {
      return;
    }
    clearTimeout(timer);
    tombstoneTimers.delete(tabId);
  };

  const canMaterializePage = (spec: WorkbenchBrowserPageSpec): boolean => {
    if (spec.isActive) {
      return true;
    }
    const layout = findLayout(spec.tabId);
    return layout?.visible === true;
  };

  const readTombstoneSafety = async (entry: BrowserPageEntry): Promise<boolean> => {
    if (entry.isDestroyed || entry.webContents.isDestroyed()) {
      return false;
    }
    if (
      entry.runtime.isActive
      || entry.runtime.isVisible
      || entry.runtime.isLoading
      || entry.runtime.isHtmlFullscreen
      || debuggerSessions.has(entry.tabId)
    ) {
      return false;
    }
    try {
      const result = await entry.webContents.executeJavaScript(
        `(() => {
          const fields = Array.from(document.querySelectorAll("input, textarea, select"));
          const hasEditedField = fields.some((field) => {
            if (field instanceof HTMLInputElement) {
              const type = field.type.toLowerCase();
              if (type === "checkbox" || type === "radio") {
                return field.checked !== field.defaultChecked;
              }
              return field.value !== field.defaultValue;
            }
            if (field instanceof HTMLTextAreaElement) {
              return field.value !== field.defaultValue;
            }
            if (field instanceof HTMLSelectElement) {
              return Array.from(field.options).some((option) => option.selected !== option.defaultSelected);
            }
            return false;
          });
          const hasActiveMedia = Array.from(document.querySelectorAll("audio, video"))
            .some((media) => media instanceof HTMLMediaElement && !media.paused && !media.ended);
          return { hasEditedField, hasActiveMedia };
        })()`,
        true
      );
      if (result === null || typeof result !== "object") {
        return false;
      }
      const record = result as Record<string, unknown>;
      return record.hasEditedField !== true && record.hasActiveMedia !== true;
    } catch {
      return false;
    }
  };

  const tombstoneEntry = async (entry: BrowserPageEntry): Promise<void> => {
    if (entry.isDestroyed || entry.runtime.isVisible || entry.runtime.isActive) {
      return;
    }
    cancelTombstoneTimer(entry.tabId);
    const restoreState = await captureBrowserRestoreState(entry);
    const runtime: WorkbenchBrowserPageRuntimeState = {
      ...entry.runtime,
      lifecycleState: "tombstoned",
      isTombstoned: true,
      isVisible: false,
      isLoading: false,
      ...(restoreState === undefined ? {} : { restoreState }),
      updatedAt: Date.now()
    };
    tombstones.set(entry.tabId, {
      tabId: entry.tabId,
      requestedAddress: entry.requestedAddress,
      titleHint: entry.titleHint,
      runtime,
      tombstonedAt: Date.now()
    });
    destroyEntry(entry, false);
    entries.delete(entry.tabId);
    publishRuntimeState(runtime);
  };

  const scheduleTombstone = (entry: BrowserPageEntry): void => {
    if (
      entry.runtime.isActive
      || entry.runtime.isVisible
      || entry.runtime.isTombstoned === true
      || tombstoneTimers.has(entry.tabId)
    ) {
      return;
    }
    const timer = setTimeout(() => {
      tombstoneTimers.delete(entry.tabId);
      void readTombstoneSafety(entry).then((safe) => {
        if (safe) {
          void tombstoneEntry(entry);
        }
      });
    }, HIDDEN_PAGE_TOMBSTONE_DELAY_MS);
    tombstoneTimers.set(entry.tabId, timer);
  };

  const findLayout = (tabId: string): WorkbenchBrowserPageLayout | null =>
    layoutSnapshot.layouts.find((layout) => layout.tabId === tabId) ?? null;

  const targetTabIdForRead = (request?: WorkbenchBrowserReadPageStateRequest): string | null => {
    const requested = normalizeString(request?.tabId);
    if (requested !== null && (entries.has(requested) || tombstones.has(requested))) {
      return requested;
    }
    if (
      topology.activeTabId !== null
      && (entries.has(topology.activeTabId) || tombstones.has(topology.activeTabId))
    ) {
      return topology.activeTabId;
    }
    return topology.pages[0]?.tabId ?? null;
  };

  const getActiveOrFocusedTabId = (): string | null => {
    const focusedLayout = layoutSnapshot.layouts.find(
      (layout) => layout.visible && layout.isFocusedPane
    );
    if (focusedLayout !== undefined && entries.has(focusedLayout.tabId)) {
      return focusedLayout.tabId;
    }
    if (topology.activeTabId !== null && entries.has(topology.activeTabId)) {
      return topology.activeTabId;
    }
    return topology.pages[0]?.tabId ?? null;
  };

  const readChromePopoverAnchor = (
    request: WorkbenchBrowserChromePopoverRequest
  ): WorkbenchBrowserChromePopoverRequest["anchorRect"] | null => {
    const rect = request.anchorRect;
    if (rect === undefined) {
      return null;
    }
    const values = [rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height];
    if (values.every((value) => typeof value === "number" && Number.isFinite(value))) {
      return rect;
    }
    return null;
  };

  const ensureChromePopoverView = (): WebContentsView => {
    if (
      chromePopoverView !== null
      && chromePopoverView.webContents.isDestroyed() === false
    ) {
      return chromePopoverView;
    }
    chromePopoverView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    });
    chromePopoverView.setVisible(false);
    chromePopoverView.setBackgroundColor("#00000000");
    chromePopoverView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    return chromePopoverView;
  };

  const attachChromePopoverView = (view: WebContentsView): void => {
    if (!chromePopoverViewAttached) {
      overlayView.addChildView(view);
      chromePopoverViewAttached = true;
      return;
    }
    // Re-adding keeps the popover above page WebContentsViews after layout updates.
    overlayView.removeChildView(view);
    overlayView.addChildView(view);
  };

  const detachChromePopoverView = (): void => {
    const view = chromePopoverView;
    if (view === null) {
      chromePopoverViewAttached = false;
      return;
    }
    if (chromePopoverViewAttached) {
      overlayView.removeChildView(view);
      chromePopoverViewAttached = false;
    }
    if (view.webContents.isDestroyed() === false) {
      view.setVisible(false);
      void view.webContents.loadURL("about:blank").catch(() => undefined);
    }
  };

  const hideChromePopover = (entry: BrowserPageEntry): void => {
    const hadPopover = activeChromePopovers.delete(entry.tabId);
    if (activeChromePopovers.size === 0) {
      detachChromePopoverView();
    }
    if (hadPopover) {
      publishEvent({
        kind: "chrome-popover-state",
        tabId: entry.tabId,
        popoverKind: "security",
        visible: false
      });
    }
  };

  const setChromePopover = async (
    request: WorkbenchBrowserChromePopoverRequest
  ): Promise<void> => {
    const tabId = normalizeString(request.tabId) ?? getActiveOrFocusedTabId();
    if (tabId === null) {
      return;
    }
    const entry = requireEntry(tabId);
    if (request.visible !== true) {
      const hadPopover = activeChromePopovers.delete(tabId);
      if (activeChromePopovers.size === 0) {
        detachChromePopoverView();
      }
      if (hadPopover) {
        publishEvent({
          kind: "chrome-popover-state",
          tabId,
          popoverKind: "security",
          visible: false
        });
      }
      return;
    }
    if (request.kind !== "security" || request.security === undefined) {
      throw new Error("chrome_popover_payload_required");
    }
    activeChromePopovers.clear();
    const layout = entry.layout ?? findLayout(tabId);
    const pageBounds =
      layout === null
        ? { x: 0, y: 0, width: 800, height: 600 }
        : toBounds(layout);
    const anchor = readChromePopoverAnchor(request);
    const popoverWidth = 340;
    const boundaryPadding = 8;
    const maxPopoverHeight = Math.max(160, Math.min(520, pageBounds.height - boundaryPadding * 2));
    const popoverHeight = resolveBrowserChromePopoverHeight({
      level: request.security.level,
      maxHeight: maxPopoverHeight
    });
    const anchorLeft = anchor?.left ?? pageBounds.x + boundaryPadding;
    const anchorBottom = anchor?.bottom ?? pageBounds.y + boundaryPadding;
    const anchorTop = anchor?.top ?? pageBounds.y + boundaryPadding;
    const pageRelativeLeft = anchorLeft - pageBounds.x;
    const pageRelativeBottom = anchorBottom - pageBounds.y;
    const pageRelativeTop = anchorTop - pageBounds.y;
    const x = Math.max(
      boundaryPadding,
      Math.min(
        Math.round(pageRelativeLeft),
        Math.max(boundaryPadding, pageBounds.width - popoverWidth - boundaryPadding)
      )
    );
    const spaceBelow = pageBounds.height - pageRelativeBottom - boundaryPadding - 6;
    const preferredY =
      spaceBelow >= popoverHeight
        ? pageRelativeBottom + 6
        : pageRelativeTop - popoverHeight - 6;
    const y = Math.max(
      boundaryPadding,
      Math.min(
        Math.round(preferredY),
        Math.max(boundaryPadding, pageBounds.height - popoverHeight - boundaryPadding)
      )
    );
    const view = ensureChromePopoverView();
    view.setBounds({
      x: pageBounds.x + x,
      y: pageBounds.y + y,
      width: popoverWidth,
      height: popoverHeight
    });
    attachChromePopoverView(view);
    view.setVisible(true);
    const html = buildBrowserChromePopoverDocument({
      kind: request.kind,
      width: popoverWidth,
      height: popoverHeight,
      security: request.security,
      theme: webThemeInjector.readCurrentSnapshot()
    });
    await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    activeChromePopovers.set(tabId, request);
    publishEvent({
      kind: "chrome-popover-state",
      tabId,
      popoverKind: "security",
      visible: true
    });
  };

  const syncNavigationFlags = (entry: BrowserPageEntry): void => {
    try {
      updateRuntimeState(entry, {
        canGoBack: entry.webContents.navigationHistory.canGoBack(),
        canGoForward: entry.webContents.navigationHistory.canGoForward()
      });
    } catch (_error) {
      updateRuntimeState(entry, {
        canGoBack: false,
        canGoForward: false
      });
    }
  };

  const applyLayout = (): void => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }

    const rootView = window.contentView;
    const contentBounds = window.getContentBounds();
    const nextOverlayBounds = {
      x: 0,
      y: 0,
      width: Math.max(contentBounds.width, layoutSnapshot.windowWidth, 1),
      height: Math.max(contentBounds.height, layoutSnapshot.windowHeight, 1)
    };
    const currentOverlayBounds = overlayView.getBounds();
    if (
      currentOverlayBounds.x !== nextOverlayBounds.x
      || currentOverlayBounds.y !== nextOverlayBounds.y
      || currentOverlayBounds.width !== nextOverlayBounds.width
      || currentOverlayBounds.height !== nextOverlayBounds.height
    ) {
      overlayView.setBounds(nextOverlayBounds);
    }
    const visibleEntries = layoutSnapshot.layouts
      .filter((layout) => layout.visible)
      .map((layout) => {
        const entry = entries.get(layout.tabId);
        if (entry === undefined || entry.isDestroyed) {
          return null;
        }
        return { entry, layout };
      })
      .filter((value): value is { entry: BrowserPageEntry; layout: WorkbenchBrowserPageLayout } => value !== null)
      .sort((left, right) => {
        const leftOrder = left.layout.zIndex + (left.entry.runtime.isHtmlFullscreen ? 10000 : 0);
        const rightOrder = right.layout.zIndex + (right.entry.runtime.isHtmlFullscreen ? 10000 : 0);
        if (leftOrder === rightOrder) {
          return left.entry.tabId.localeCompare(right.entry.tabId);
        }
        return leftOrder - rightOrder;
      });
    if (visibleEntries.length > 0) {
      if (!overlayAttached) {
        rootView.addChildView(overlayView);
        overlayAttached = true;
      }
      if (!overlayVisible) {
        overlayView.setVisible(true);
        overlayVisible = true;
      }
    }
    if (visibleEntries.length === 0 && overlayVisible) {
      overlayView.setVisible(false);
      overlayVisible = false;
    }

    for (const entry of entries.values()) {
      const layout = findLayout(entry.tabId);
      const isVisible = layout?.visible === true;
      entry.layout = layout;
      updateRuntimeState(entry, {
        isActive: topology.activeTabId === entry.tabId,
        isVisible,
        lifecycleState:
          topology.activeTabId === entry.tabId
            ? "foreground"
            : isVisible
              ? "visible"
              : "hot-hidden",
        isTombstoned: false
      });

      if (!isVisible) {
        if (entry.attached) {
          overlayView.removeChildView(entry.view);
          entry.attached = false;
        }
        if (entry.viewVisible) {
          entry.view.setVisible(false);
          entry.viewVisible = false;
        }
        scheduleTombstone(entry);
      } else {
        cancelTombstoneTimer(entry.tabId);
      }
    }

    for (const { entry, layout } of visibleEntries) {
      const nextBounds = toBounds(layout);
      const currentBounds = entry.view.getBounds();
      if (
        currentBounds.x !== nextBounds.x
        || currentBounds.y !== nextBounds.y
        || currentBounds.width !== nextBounds.width
        || currentBounds.height !== nextBounds.height
      ) {
        entry.view.setBounds(nextBounds);
      }
      if (!entry.viewVisible) {
        entry.view.setVisible(true);
        entry.viewVisible = true;
      }
      if (!entry.attached) {
        overlayView.addChildView(entry.view);
        entry.attached = true;
      }
    }
    if (
      chromePopoverView !== null
      && chromePopoverViewAttached
      && chromePopoverView.webContents.isDestroyed() === false
    ) {
      attachChromePopoverView(chromePopoverView);
    }
  };

  const destroyEntry = (entry: BrowserPageEntry, emitClosedEvent: boolean): void => {
    if (entry.isDestroyed) {
      return;
    }
    cancelTombstoneTimer(entry.tabId);
    entry.isDestroyed = true;
    destroyBrowserAgentShadow(entry.tabId);
    hideChromePopover(entry);
    void debuggerSessions.get(entry.tabId)?.dispose().catch(() => undefined);
    debuggerSessions.delete(entry.tabId);
    browserAgentCache.delete(browserAgentCacheKey(entry.tabId, "live"));
    browserAgentCache.delete(browserAgentCacheKey(entry.tabId, "isolated"));
    browserAgentInputTargets.delete(browserAgentCacheKey(entry.tabId, "live"));
    browserAgentInputTargets.delete(browserAgentCacheKey(entry.tabId, "isolated"));
    webThemeInjector.detach(entry.tabId);
    elementPickerController.handlePageClosed(entry.tabId);
    const window = getWindow();
    if (window !== null && window.isDestroyed() === false && entry.attached) {
      overlayView.removeChildView(entry.view);
      entry.attached = false;
      entry.viewVisible = false;
    }
    entry.disposeListeners();
    if (entry.webContents.isDestroyed() === false) {
      entry.webContents.close({ waitForBeforeUnload: false });
    }
    if (emitClosedEvent) {
      tombstones.delete(entry.tabId);
      publishEvent({
        kind: "page-closed",
        tabId: entry.tabId
      });
    }
  };

  const loadRequestedAddress = (entry: BrowserPageEntry): void => {
    if (entry.webContents.isDestroyed()) {
      return;
    }
    const target = entry.requestedAddress;
    const currentUrl = normalizeAddress(entry.webContents.getURL());
    if (currentUrl === target) {
      updateRuntimeState(entry, {
        address: currentUrl,
        title: entry.runtime.title.length > 0 ? entry.runtime.title : entry.titleHint ?? target
      });
      return;
    }
    updateRuntimeState(entry, {
      address: target,
      isLoading: true,
      title: entry.runtime.title.length > 0 ? entry.runtime.title : entry.titleHint ?? target
    });
    void entry.webContents.loadURL(target).catch((error: unknown) => {
      console.error(`[lyra-browser] loadURL failed tab=${entry.tabId} url=${target} error=${String(error)}`);
      updateRuntimeState(entry, { isLoading: false });
    });
  };

  const agentTargetAddress = (target: BrowserAgentPageTarget): string =>
    target.liveEntry?.runtime.address ?? target.address;

  const agentTargetTitle = (target: BrowserAgentPageTarget): string =>
    target.liveEntry?.runtime.title ?? target.title;

  const agentTargetIsLoading = (target: BrowserAgentPageTarget): boolean =>
    target.liveEntry?.runtime.isLoading ?? target.isLoading;

  const liveAgentTarget = (entry: BrowserPageEntry): BrowserAgentPageTarget => ({
    tabId: entry.tabId,
    webContents: entry.webContents,
    targetMode: "live",
    liveEntry: entry,
    address: entry.runtime.address,
    title: entry.runtime.title,
    isLoading: entry.runtime.isLoading
  });

  const diagnosticsForTab = (tabId: string): WorkbenchBrowserPageDiagnosticEntry[] => {
    const existing = pageDiagnostics.get(tabId);
    if (existing !== undefined) {
      return existing;
    }
    const created: WorkbenchBrowserPageDiagnosticEntry[] = [];
    pageDiagnostics.set(tabId, created);
    return created;
  };

  const recordPageDiagnostic = (
    tabId: string,
    entry: Omit<WorkbenchBrowserPageDiagnosticEntry, "id" | "at">
  ): void => {
    const diagnostics = diagnosticsForTab(tabId);
    diagnostics.push({
      id: `diag-${tabId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: Date.now(),
      ...entry
    });
    if (diagnostics.length > MAX_BROWSER_PAGE_DIAGNOSTICS) {
      diagnostics.splice(0, diagnostics.length - MAX_BROWSER_PAGE_DIAGNOSTICS);
    }
  };

  const followSessionKey = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): string => browserAgentCacheKey(tabId, targetMode);

  const ensureFollowSession = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): BrowserAgentFollowSession => {
    const key = followSessionKey(tabId, targetMode);
    const existing = followSessions.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created: BrowserAgentFollowSession = {
      sessionId: `follow-${tabId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      tabId,
      targetMode,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      totalActions: 0,
      interruptedCount: 0,
      actions: []
    };
    followSessions.set(key, created);
    return created;
  };

  const recordFollowAction = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    action: BrowserAgentCursorOverlayAction,
    request: {
      readonly interaction?: WorkbenchBrowserAgentInteraction;
      readonly cursorPhase?: BrowserAgentCursorOverlayPhase;
      readonly inputActive: boolean;
      readonly cursor?: { readonly x: number; readonly y: number };
    }
  ): BrowserAgentFollowSession => {
    const session = ensureFollowSession(tabId, targetMode);
    const at = Date.now();
    session.updatedAt = at;
    session.totalActions += 1;
    session.actions.push({
      id: `follow-action-${session.totalActions}`,
      at,
      tabId,
      targetMode,
      action,
      ...(request.interaction === undefined ? {} : { interaction: request.interaction }),
      ...(request.cursorPhase === undefined ? {} : { cursorPhase: request.cursorPhase }),
      inputActive: request.inputActive,
      ...(request.cursor === undefined ? {} : { cursor: request.cursor })
    });
    if (session.actions.length > MAX_BROWSER_AGENT_FOLLOW_ACTIONS) {
      session.actions.splice(0, session.actions.length - MAX_BROWSER_AGENT_FOLLOW_ACTIONS);
    }
    return session;
  };

  const markAgentControlLock = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    durationMs: number
  ): void => {
    if (targetMode !== "live") {
      return;
    }
    agentControlLocks.set(tabId, Date.now() + Math.max(800, Math.min(6_000, durationMs)));
  };

  const markSyntheticInput = (tabId: string): void => {
    agentSyntheticInputUntil.set(tabId, Date.now() + 350);
  };

  const isSyntheticInput = (tabId: string): boolean =>
    (agentSyntheticInputUntil.get(tabId) ?? 0) >= Date.now();

  const handleSharedControlInput = (
    tabId: string,
    inputType: "mouse" | "keyboard",
    event?: { readonly preventDefault?: () => void }
  ): void => {
    const lockUntil = agentControlLocks.get(tabId) ?? 0;
    if (lockUntil < Date.now() || isSyntheticInput(tabId)) {
      return;
    }
    event?.preventDefault?.();
    const session = ensureFollowSession(tabId, "live");
    session.interruptedCount += 1;
    session.updatedAt = Date.now();
    agentControlInterruptions.set(tabId, (agentControlInterruptions.get(tabId) ?? 0) + 1);
    publishEvent({
      kind: "browser-shared-control-interrupted",
      tabId,
      targetMode: "live",
      sessionId: session.sessionId,
      inputType,
      at: Date.now()
    });
  };

  const sendAgentInputEvent = (
    target: BrowserAgentPageTarget,
    event: Parameters<WebContents["sendInputEvent"]>[0]
  ): void => {
    markSyntheticInput(target.tabId);
    target.webContents.sendInputEvent(event);
  };

  const publishBrowserAgentActivity = ({
    tabId,
    targetMode,
    action,
    interaction,
    cursorPhase = "idle",
    inputActive = false,
    durationMs = inputActive ? 1_800 : 1_250,
    cursor
  }: {
    readonly tabId: string;
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly action: BrowserAgentCursorOverlayAction;
    readonly interaction?: WorkbenchBrowserAgentInteraction;
    readonly cursorPhase?: BrowserAgentCursorOverlayPhase;
    readonly inputActive?: boolean;
    readonly durationMs?: number;
    readonly cursor?: { readonly x: number; readonly y: number };
  }): void => {
    const followSession = recordFollowAction(tabId, targetMode, action, {
      ...(interaction === undefined ? {} : { interaction }),
      cursorPhase,
      inputActive,
      ...(cursor === undefined ? {} : { cursor })
    });
    markAgentControlLock(tabId, targetMode, durationMs);
    if (inputActive && targetMode === "live") {
      const entry = entries.get(tabId);
      if (entry !== undefined && entry.webContents.isDestroyed() === false) {
        void entry.webContents.executeJavaScript(
          buildAgentCursorOverlayScript({
            action,
            phase: cursorPhase,
            durationMs,
            ...(cursor === undefined ? {} : { cursor })
          }),
          true
        ).catch((error: unknown) => {
          console.warn(
            `[lyra-browser] agent cursor overlay failed tab=${tabId} action=${action} error=${String(error)}`
          );
        });
      }
    }
    publishEvent({
      kind: "lumen-browser-activity",
      source: "lyra_lumen",
      tabId,
      targetMode,
      action,
      ...(interaction === undefined ? {} : { interaction }),
      sessionId: followSession.sessionId,
      cursorPhase,
      inputActive,
      durationMs,
      ...(cursor === undefined ? {} : { cursor })
    });
  };

  const performAgentPointerInteraction = async ({
    tabId,
    target,
    x,
    y,
    interaction
  }: {
    readonly tabId: string;
    readonly target: BrowserAgentPageTarget;
    readonly x: number;
    readonly y: number;
    readonly interaction: WorkbenchBrowserAgentInteraction;
  }): Promise<void> => {
    const button = interaction === "rightClick" ? "right" : "left";
    const clickCount = interaction === "doubleClick" ? 2 : 1;
    const cursor = { x, y };
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "act",
      interaction,
      cursorPhase: "move",
      inputActive: true,
      cursor,
      durationMs: interaction === "hover" ? 2_400 : 2_800
    });
    await delay(180);

    target.webContents.focus();
    sendAgentInputEvent(target, { type: "mouseMove", x, y, button: "left", clickCount: 1 });
    if (interaction === "hover") {
      publishBrowserAgentActivity({
        tabId,
        targetMode: target.targetMode,
        action: "act",
        interaction,
        cursorPhase: "idle",
        inputActive: true,
        cursor,
        durationMs: 2_400
      });
      await delay(90);
      return;
    }

    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "act",
      interaction,
      cursorPhase: "down",
      inputActive: true,
      cursor,
      durationMs: 2_400
    });
    sendAgentInputEvent(target, { type: "mouseDown", x, y, button, clickCount });
    await delay(80);

    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "act",
      interaction,
      cursorPhase: "up",
      inputActive: true,
      cursor,
      durationMs: 2_400
    });
    sendAgentInputEvent(target, { type: "mouseUp", x, y, button, clickCount });
    await delay(110);

    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "act",
      interaction,
      cursorPhase: "idle",
      inputActive: true,
      cursor,
      durationMs: 2_400
    });
  };

  const waitForAgentPageLoad = async (
    webContents: WebContents,
    url: string,
    timeoutMs: number
  ): Promise<void> => {
    if (webContents.isDestroyed()) {
      return;
    }
    await new Promise<void>((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== null) {
          clearTimeout(timer);
        }
        webContents.off("did-stop-loading", finish);
        webContents.off("did-fail-load", finish);
        resolve();
      };
      timer = setTimeout(finish, timeoutMs);
      webContents.once("did-stop-loading", finish);
      webContents.once("did-fail-load", finish);
      void webContents.loadURL(url).catch(finish);
    });
  };

  const destroyBrowserAgentShadow = (tabId: string): void => {
    const shadow = browserAgentShadows.get(tabId);
    if (shadow === undefined) {
      return;
    }
    browserAgentShadows.delete(tabId);
    if (shadow.webContents.isDestroyed() === false) {
      shadow.webContents.close({ waitForBeforeUnload: false });
    }
    if (shadow.window.isDestroyed() === false) {
      shadow.window.destroy();
    }
  };

  const createBrowserAgentShadow = (source: BrowserPageEntry): BrowserAgentShadowEntry => {
    const width = Math.max(480, Math.round(source.layout?.width ?? 1366));
    const height = Math.max(360, Math.round(source.layout?.height ?? 900));
    const window = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      paintWhenInitiallyHidden: true,
      width,
      height,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true,
        sandbox: true,
        spellcheck: true
      }
    });
    window.setMenuBarVisibility(false);
    const { webContents } = window;
    const shadow: BrowserAgentShadowEntry = {
      tabId: source.tabId,
      sourceTabId: source.tabId,
      window,
      webContents,
      targetMode: "isolated",
      address: "about:blank",
      title: "Lyra Lumen",
      isLoading: false,
      detached: false
    };
    webContents.setWindowOpenHandler(({ url }) => {
      if (isSupportedWebUrl(url)) {
        void waitForAgentPageLoad(webContents, url, 8_000).then(() => {
          shadow.address = normalizeAddress(webContents.getURL()) ?? url;
          shadow.detached = true;
        });
      } else {
        void shell.openExternal(url).catch(() => undefined);
      }
      return { action: "deny" };
    });
    webContents.on("page-title-updated", (_event, title) => {
      shadow.title = normalizeString(title) ?? shadow.address;
    });
    webContents.on("did-start-loading", () => {
      shadow.isLoading = true;
    });
    webContents.on("did-stop-loading", () => {
      shadow.isLoading = false;
      shadow.address = normalizeAddress(webContents.getURL()) ?? shadow.address;
      shadow.title = normalizeString(webContents.getTitle()) ?? shadow.title;
    });
    webContents.on("did-navigate", (_event, url) => {
      shadow.address = normalizeAddress(url) ?? shadow.address;
      browserAgentCache.delete(browserAgentCacheKey(shadow.tabId, shadow.targetMode));
      browserAgentInputTargets.delete(browserAgentCacheKey(shadow.tabId, shadow.targetMode));
    });
    webContents.on("did-navigate-in-page", (_event, url) => {
      shadow.address = normalizeAddress(url) ?? shadow.address;
      browserAgentCache.delete(browserAgentCacheKey(shadow.tabId, shadow.targetMode));
      browserAgentInputTargets.delete(browserAgentCacheKey(shadow.tabId, shadow.targetMode));
    });
    window.on("closed", () => {
      browserAgentShadows.delete(shadow.tabId);
    });
    browserAgentShadows.set(source.tabId, shadow);
    return shadow;
  };

  const createStandaloneBrowserAgentShadow = (tabId: string): BrowserAgentShadowEntry => {
    const windowBounds = getWindow()?.getContentBounds();
    const width = Math.max(480, Math.round(windowBounds?.width ?? 1366));
    const height = Math.max(360, Math.round(windowBounds?.height ?? 900));
    const window = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      paintWhenInitiallyHidden: true,
      width,
      height,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true,
        sandbox: true,
        spellcheck: true
      }
    });
    window.setMenuBarVisibility(false);
    const { webContents } = window;
    const shadow: BrowserAgentShadowEntry = {
      tabId,
      sourceTabId: tabId,
      window,
      webContents,
      targetMode: "isolated",
      address: "about:blank",
      title: "Lyra Lumen",
      isLoading: false,
      detached: true
    };
    webContents.setWindowOpenHandler(({ url }) => {
      if (isSupportedWebUrl(url)) {
        void waitForAgentPageLoad(webContents, url, 8_000).then(() => {
          shadow.address = normalizeAddress(webContents.getURL()) ?? url;
          shadow.title = normalizeString(webContents.getTitle()) ?? shadow.address;
        });
      } else {
        void shell.openExternal(url).catch(() => undefined);
      }
      return { action: "deny" };
    });
    webContents.on("page-title-updated", (_event, title) => {
      shadow.title = normalizeString(title) ?? shadow.address;
    });
    webContents.on("did-start-loading", () => {
      shadow.isLoading = true;
    });
    webContents.on("did-stop-loading", () => {
      shadow.isLoading = false;
      shadow.address = normalizeAddress(webContents.getURL()) ?? shadow.address;
      shadow.title = normalizeString(webContents.getTitle()) ?? shadow.title;
    });
    webContents.on("did-navigate", (_event, url) => {
      shadow.address = normalizeAddress(url) ?? shadow.address;
    });
    webContents.on("did-navigate-in-page", (_event, url) => {
      shadow.address = normalizeAddress(url) ?? shadow.address;
    });
    window.on("closed", () => {
      browserAgentShadows.delete(shadow.tabId);
    });
    browserAgentShadows.set(tabId, shadow);
    return shadow;
  };

  const ensureBrowserAgentShadow = async (
    source: BrowserPageEntry,
    timeoutMs: number | undefined
  ): Promise<BrowserAgentShadowEntry> => {
    const shadow = browserAgentShadows.get(source.tabId) ?? createBrowserAgentShadow(source);
    const sourceAddress = normalizeAddress(source.webContents.getURL()) ?? source.runtime.address;
    const shouldSyncFromSource =
      shadow.detached === false
      && normalizeAddress(shadow.webContents.getURL()) !== sourceAddress;
    if (shouldSyncFromSource) {
      await waitForAgentPageLoad(shadow.webContents, sourceAddress, timeoutMs ?? 8_000);
      shadow.address = normalizeAddress(shadow.webContents.getURL()) ?? sourceAddress;
      shadow.title = normalizeString(shadow.webContents.getTitle()) ?? source.runtime.title;
    }
    return shadow;
  };

  const resolveBrowserAgentTarget = async (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode | undefined,
    timeoutMs: number | undefined
  ): Promise<BrowserAgentPageTarget> => {
    if (targetMode === "live") {
      return liveAgentTarget(requireEntry(tabId));
    }
    const entry = entries.get(tabId);
    if (entry !== undefined && entry.isDestroyed === false) {
      return await ensureBrowserAgentShadow(entry, timeoutMs);
    }
    return browserAgentShadows.get(tabId)
      ?? createStandaloneBrowserAgentShadow(tabId || WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID);
  };

  const createEntry = (
    spec: WorkbenchBrowserPageSpec,
    restoredRuntime?: WorkbenchBrowserPageRuntimeState
  ): BrowserPageEntry => {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true
      }
    });
    const { webContents } = view;
    const disposeDownloadTracking = onWebContentsCreated?.(spec.tabId, webContents) ?? (() => undefined);
    const entry: BrowserPageEntry = {
      tabId: spec.tabId,
      view,
      webContents,
      requestedAddress: spec.address,
      titleHint: spec.titleHint ?? null,
      attached: false,
      viewVisible: false,
      isDestroyed: false,
      layout: null,
      runtime: {
        ...(restoredRuntime ?? toInitialRuntimeState(spec)),
        lifecycleState: spec.isActive ? "restoring" : "hot-hidden",
        isTombstoned: false,
        ...(restoredRuntime === undefined ? {} : { restoreReason: "activated" }),
        updatedAt: Date.now()
      },
      disposeListeners: () => {
        disposeDownloadTracking();
        webContents.removeAllListeners("page-title-updated");
        webContents.removeAllListeners("page-favicon-updated");
        webContents.removeAllListeners("did-start-loading");
        webContents.removeAllListeners("did-stop-loading");
        webContents.removeAllListeners("did-fail-load");
        webContents.removeAllListeners("did-navigate");
        webContents.removeAllListeners("did-navigate-in-page");
        webContents.removeAllListeners("console-message");
        webContents.removeAllListeners("before-mouse-event");
        webContents.removeAllListeners("before-input-event");
        webContents.removeAllListeners("focus");
        webContents.removeAllListeners("enter-html-full-screen");
        webContents.removeAllListeners("leave-html-full-screen");
        webContents.removeAllListeners("render-process-gone");
      }
    };

    webContents.setWindowOpenHandler(({ url }) => {
      if (isSupportedWebUrl(url)) {
        publishEvent({
          kind: "request-open-tab",
          address: url
        });
        return { action: "deny" };
      }
      void shell.openExternal(url).catch(() => undefined);
      return { action: "deny" };
    });

    webContents.on("page-title-updated", (_event, title) => {
      const nextTitle = normalizeString(title) ?? entry.titleHint ?? entry.requestedAddress;
      updateRuntimeState(entry, { title: nextTitle });
    });

    webContents.on("page-favicon-updated", (_event, favicons) => {
      const faviconUrl = favicons.find((item) => typeof item === "string" && item.trim().length > 0);
      if (faviconUrl !== undefined) {
        updateRuntimeState(entry, { faviconUrl });
      }
    });

    webContents.on("did-start-loading", () => {
      hideChromePopover(entry);
      updateRuntimeState(entry, { isLoading: true });
      syncNavigationFlags(entry);
    });

    webContents.on("did-stop-loading", () => {
      updateRuntimeState(entry, { isLoading: false });
      syncNavigationFlags(entry);
      const restoreState = browserSessionSnapshots.get(entry.tabId) ?? entry.runtime.restoreState;
      if (restoreState !== undefined) {
        void applyBrowserRestoreState(entry, restoreState);
      }
    });

    webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
      if (errorCode === -3) {
        return;
      }
      recordPageDiagnostic(entry.tabId, {
        source: "navigation",
        severity: "error",
        message: `${errorDescription || "Page load failed"} (${errorCode})`,
        ...(typeof validatedUrl === "string" && validatedUrl.length > 0 ? { url: validatedUrl } : {})
      });
      updateRuntimeState(entry, { isLoading: false });
    });

    const syncAddress = (url: string): void => {
      const address = normalizeAddress(url) ?? entry.requestedAddress;
      updateRuntimeState(entry, {
        address,
        title: entry.runtime.title.length > 0 ? entry.runtime.title : entry.titleHint ?? address
      });
      syncNavigationFlags(entry);
    };

    webContents.on("did-navigate", (_event, url) => {
      hideChromePopover(entry);
      elementPickerController.handlePageNavigated(entry.tabId);
      browserAgentCache.delete(browserAgentCacheKey(entry.tabId, "live"));
      browserAgentInputTargets.delete(browserAgentCacheKey(entry.tabId, "live"));
      syncAddress(url);
    });

    webContents.on("did-navigate-in-page", (_event, url) => {
      hideChromePopover(entry);
      elementPickerController.handlePageNavigated(entry.tabId);
      browserAgentCache.delete(browserAgentCacheKey(entry.tabId, "live"));
      browserAgentInputTargets.delete(browserAgentCacheKey(entry.tabId, "live"));
      syncAddress(url);
    });

    webContents.on("console-message", (_event, level, message, line, sourceId) => {
      elementPickerController.handleConsoleMessage(entry.tabId, message);
      const severity = level >= 2 ? "error" : level === 1 ? "warning" : "info";
      if (severity !== "info" || String(message).trim().length > 0) {
        recordPageDiagnostic(entry.tabId, {
          source: "console",
          severity,
          message:
            String(message) +
            (typeof line === "number" && line > 0 ? ` at ${line}` : ""),
          ...(typeof sourceId === "string" && sourceId.length > 0 ? { url: sourceId } : {})
        });
      }
    });

    webContents.on("before-mouse-event", (event, mouse) => {
      handleSharedControlInput(entry.tabId, "mouse", event);
      if (mouse.type === "mouseDown") {
        hideChromePopover(entry);
      }
    });

    webContents.on("before-input-event", (event) => {
      handleSharedControlInput(entry.tabId, "keyboard", event);
    });

    webContents.on("focus", () => {
      hideChromePopover(entry);
    });

    webContents.on("enter-html-full-screen", () => {
      updateRuntimeState(entry, { isHtmlFullscreen: true });
      applyLayout();
      const window = getWindow();
      if (window !== null) {
        setImmediate(() => {
          if (window.isDestroyed() === false && window.isFullScreen()) {
            window.setFullScreen(false);
          }
        });
      }
    });

    webContents.on("leave-html-full-screen", () => {
      updateRuntimeState(entry, { isHtmlFullscreen: false });
      applyLayout();
    });

    webContents.on("render-process-gone", () => {
      destroyEntry(entry, true);
      entries.delete(entry.tabId);
    });

    webThemeInjector.attach(entry.tabId, webContents);
    loadRequestedAddress(entry);
    publishEvent({
      kind: "page-runtime-state",
      page: entry.runtime
    });
    return entry;
  };

  const ensureEntry = (spec: WorkbenchBrowserPageSpec): BrowserPageEntry | null => {
    const existing = entries.get(spec.tabId);
    if (existing !== undefined) {
      existing.titleHint = spec.titleHint ?? existing.titleHint;
      existing.requestedAddress = spec.address;
      updateRuntimeState(existing, {
        isActive: spec.isActive,
        coreKey: resolveBrowserCoreKey(spec.address),
        stateKey: `web-state:${spec.tabId}`,
        isTombstoned: false,
        ...(spec.restoreState === undefined ? {} : { restoreState: spec.restoreState }),
        title:
          existing.runtime.title.length > 0
            ? existing.runtime.title
            : spec.titleHint ?? existing.requestedAddress
      });
      return existing;
    }
    const tombstone = tombstones.get(spec.tabId);
    if (tombstone !== undefined && canMaterializePage(spec) === false) {
      const runtime: WorkbenchBrowserPageRuntimeState = {
        ...tombstone.runtime,
        address: spec.address,
        title: tombstone.runtime.title.length > 0 ? tombstone.runtime.title : spec.titleHint ?? spec.address,
        coreKey: resolveBrowserCoreKey(spec.address),
        stateKey: `web-state:${spec.tabId}`,
        isActive: spec.isActive,
        isVisible: false,
        lifecycleState: "tombstoned",
        isTombstoned: true,
        updatedAt: Date.now()
      };
      tombstone.requestedAddress = spec.address;
      tombstone.titleHint = spec.titleHint ?? tombstone.titleHint;
      tombstones.set(spec.tabId, {
        ...tombstone,
        runtime
      });
      publishRuntimeState(tombstones.get(spec.tabId)!.runtime);
      return null;
    }
    const restoredRuntime = tombstone?.runtime;
    tombstones.delete(spec.tabId);
    const entry = createEntry(spec, restoredRuntime);
    entries.set(spec.tabId, entry);
    return entry;
  };

  const syncTopology = (snapshot: WorkbenchBrowserTopologySnapshot): void => {
    const previousActiveTabId = topology.activeTabId;
    const nextTopology = normalizeTopology(snapshot);
    topology = nextTopology;
    if (
      previousActiveTabId !== null
      && previousActiveTabId !== nextTopology.activeTabId
    ) {
      const previousEntry = entries.get(previousActiveTabId);
      if (previousEntry !== undefined) {
        hideChromePopover(previousEntry);
      }
    }
    elementPickerController.handleActiveTabChanged(nextTopology.activeTabId);

    const nextTabIds = new Set(nextTopology.pages.map((page) => page.tabId));
    for (const [tabId, entry] of entries) {
      if (nextTabIds.has(tabId)) {
        continue;
      }
      void captureBrowserRestoreState(entry);
      destroyEntry(entry, true);
      entries.delete(tabId);
    }
    for (const tabId of tombstones.keys()) {
      if (nextTabIds.has(tabId)) {
        continue;
      }
      tombstones.delete(tabId);
      publishEvent({
        kind: "page-closed",
        tabId
      });
    }

    for (const page of nextTopology.pages) {
      const entry = ensureEntry(page);
      if (entry === null) {
        continue;
      }
      if (entry.requestedAddress !== page.address) {
        entry.requestedAddress = page.address;
      }
      if (entry.runtime.address !== page.address) {
        loadRequestedAddress(entry);
      } else {
        updateRuntimeState(entry, { isActive: page.isActive });
      }
    }

    applyLayout();
  };

  const syncLayout = (snapshot: WorkbenchBrowserLayoutSnapshot): void => {
    layoutSnapshot = normalizeLayout(snapshot);
    applyLayout();
  };

  const navigateInEntry = async (
    entry: BrowserPageEntry,
    request: WorkbenchBrowserNavigateRequest
  ): Promise<WorkbenchBrowserNavigateResult> => {
    const address = normalizeAddress(request.address);
    if (address === null) {
      throw new Error("address is required");
    }
    entry.requestedAddress = address;
    if (normalizeString(request.title) !== null) {
      entry.titleHint = normalizeString(request.title);
    }
    loadRequestedAddress(entry);
    return {
      address,
      tabId: entry.tabId,
      title: entry.titleHint ?? entry.runtime.title ?? null
    };
  };

  const requireEntry = (tabId: string): BrowserPageEntry => {
    const entry = entries.get(tabId);
    if (entry === undefined || entry.isDestroyed) {
      throw new Error(`Unknown browser tab: ${tabId}`);
    }
    return entry;
  };

  const findFrameInWebContents = (
    webContents: WebContents,
    frameTreeNodeId: number
  ): WebFrameMain | null =>
    webContents.mainFrame.framesInSubtree.find(
      (frame) => frame.frameTreeNodeId === frameTreeNodeId && !frame.isDestroyed()
    ) ?? null;

  const findFrame = (
    entry: BrowserPageEntry,
    frameTreeNodeId: number
  ): WebFrameMain | null => findFrameInWebContents(entry.webContents, frameTreeNodeId);

  const elementPickerController: WorkbenchBrowserElementPickerController =
    createWorkbenchBrowserElementPickerController({
      host: {
        publishEvent,
        listFrames: (tabId) => {
          const entry = requireEntry(tabId);
          return entry.webContents.mainFrame.framesInSubtree
            .filter((frame) => frame.isDestroyed() === false)
            .map((frame) => ({
              frameTreeNodeId: frame.frameTreeNodeId,
              url: frame.url,
              origin: frame.origin,
              name: frame.name,
              ...(frame.parent === null
                ? {}
                : { parentFrameTreeNodeId: frame.parent.frameTreeNodeId }),
              isMainFrame: frame.frameTreeNodeId === entry.webContents.mainFrame.frameTreeNodeId
            }));
        },
        executeFrameScript: async (
          tabId,
          request: {
            readonly script: string;
            readonly frameTreeNodeId?: number;
            readonly userGesture?: boolean;
            readonly timeoutMs?: number;
          }
        ) => {
          const entry = requireEntry(tabId);
          const timeoutMs = normalizeExecuteScriptTimeoutMs(request.timeoutMs);
          if (typeof request.frameTreeNodeId === "number" && Number.isFinite(request.frameTreeNodeId)) {
            const frame = findFrame(entry, Math.round(request.frameTreeNodeId));
            if (frame === null) {
              throw new Error(`Unknown browser frame: ${request.frameTreeNodeId}`);
            }
            return await runFrameScriptWithTimeout(
              () => frame.executeJavaScript(request.script, request.userGesture === true),
              timeoutMs
            );
          }
          return await runFrameScriptWithTimeout(
            () => entry.webContents.executeJavaScript(request.script, request.userGesture === true),
            timeoutMs
          );
        }
      }
    });

  const readPageDomSummary = async (
    tabId: string,
    options?: BrowserDomSummaryReadOptions
  ): Promise<WorkbenchObservationBrowserDomSummary> => {
    const entry = requireEntry(tabId);
    const maxChars = Math.max(256, Math.min(24_000, Math.round(options?.maxChars ?? 12_000)));
    const maxLinks = Math.max(1, Math.min(100, Math.round(options?.maxLinks ?? 50)));
    const maxHeadings = Math.max(1, Math.min(80, Math.round(options?.maxHeadings ?? 40)));
    const maxForms = Math.max(1, Math.min(30, Math.round(options?.maxForms ?? 10)));

    try {
      const summary = await entry.webContents.executeJavaScript(`
        (() => {
          const normalizeText = (value) =>
            typeof value === "string"
              ? value.replace(/\\s+/g, " ").trim()
              : "";
          const bodyText = normalizeText(document.body?.innerText ?? "");
          const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
            .map((element) => normalizeText(element.textContent ?? ""))
            .filter((value) => value.length > 0);
          const links = Array.from(document.querySelectorAll("a[href]"))
            .map((element) => ({
              text: normalizeText(element.textContent ?? ""),
              href: typeof element.href === "string" ? element.href : ""
            }))
            .filter((entry) => entry.href.length > 0);
          const forms = Array.from(document.querySelectorAll("form"))
            .map((form) => ({
              action: typeof form.action === "string" && form.action.length > 0 ? form.action : undefined,
              method: typeof form.method === "string" && form.method.length > 0 ? form.method.toLowerCase() : undefined,
              fields: Array.from(form.querySelectorAll("input, textarea, select, button"))
                .map((field) =>
                  normalizeText(
                    field.getAttribute("name")
                    ?? field.getAttribute("aria-label")
                    ?? field.getAttribute("placeholder")
                    ?? field.id
                    ?? field.tagName
                  )
                )
                .filter((value) => value.length > 0)
            }));
          const selectionText = normalizeText(String(window.getSelection?.() ?? ""));
          return {
            domTitle: normalizeText(document.title ?? ""),
            documentLanguage: normalizeText(document.documentElement?.lang ?? ""),
            selectionText,
            headings,
            mainTextExcerpt: bodyText.slice(0, ${maxChars}),
            links: links.slice(0, ${maxLinks}),
            forms: forms.slice(0, ${maxForms}),
            truncated:
              bodyText.length > ${maxChars}
              || headings.length > ${maxHeadings}
              || links.length > ${maxLinks}
              || forms.length > ${maxForms}
          };
        })()
      `, true);

      const record = summary as Record<string, unknown>;
      const headings = Array.isArray(record.headings)
        ? record.headings
            .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            .slice(0, maxHeadings)
        : [];
      const links = Array.isArray(record.links)
        ? record.links
            .map((value) => {
              if (value === null || typeof value !== "object") {
                return null;
              }
              const entry = value as Record<string, unknown>;
              if (typeof entry.href !== "string" || entry.href.trim().length === 0) {
                return null;
              }
              return {
                text: typeof entry.text === "string" ? entry.text : "",
                href: entry.href
              };
            })
            .filter((value): value is { text: string; href: string } => value !== null)
            .slice(0, maxLinks)
        : [];
      const forms = Array.isArray(record.forms)
        ? record.forms
            .map((value) => {
              if (value === null || typeof value !== "object") {
                return null;
              }
              const entry = value as Record<string, unknown>;
              const fields = Array.isArray(entry.fields)
                ? entry.fields.filter((field): field is string => typeof field === "string")
                : [];
              const form: {
                action?: string;
                method?: string;
                fields: readonly string[];
              } = { fields };
              if (typeof entry.action === "string" && entry.action.length > 0) {
                form.action = entry.action;
              }
              if (typeof entry.method === "string" && entry.method.length > 0) {
                form.method = entry.method;
              }
              return form;
            })
            .filter((value): value is { action?: string; method?: string; fields: readonly string[] } => value !== null)
            .slice(0, maxForms)
        : [];

      return {
        ...(typeof record.domTitle === "string" && record.domTitle.length > 0
          ? { domTitle: record.domTitle }
          : {}),
        ...(typeof record.documentLanguage === "string" && record.documentLanguage.length > 0
          ? { documentLanguage: record.documentLanguage }
          : {}),
        ...(typeof record.selectionText === "string" && record.selectionText.length > 0
          ? { selectionText: record.selectionText }
          : {}),
        headings,
        mainTextExcerpt:
          typeof record.mainTextExcerpt === "string" ? record.mainTextExcerpt : "",
        links,
        forms,
        truncated: record.truncated === true
      };
    } catch (_error) {
      return {
        headings: [],
        mainTextExcerpt: "",
        links: [],
        forms: [],
        truncated: false
      };
    }
  };

  const extractPageText = async (
    tabId: string,
    options?: BrowserTextExtractOptions
  ): Promise<WorkbenchTabExtractTextResult> => {
    const entry = requireEntry(tabId);
    return await extractTextFromPage({
      tabId,
      webContents: entry.webContents,
      ...(options === undefined ? {} : { options })
    });
  };

  const capturePage = async (tabId: string): Promise<WorkbenchVisualCaptureResult> => {
    const entry = requireEntry(tabId);
    if (entry.runtime.isVisible === false) {
      throw new Error("background_visual_capture_unsupported");
    }
    const image = await entry.webContents.capturePage();
    const size = image.getSize();
    return {
      tabId,
      mimeType: "image/png",
      imageBase64: image.toPNG().toString("base64"),
      width: size.width,
      height: size.height,
      visibleOnly: true
    };
  };

  const searchInPage = async (
    request: WorkbenchBrowserSearchInPageRequest
  ): Promise<WorkbenchBrowserSearchInPageResult> => {
    const query = normalizeString(request.query);
    if (query === null) {
      throw new Error("query is required");
    }
    const tabId = normalizeString(request.tabId) ?? getActiveOrFocusedTabId();
    if (tabId === null) {
      throw new Error("tab_not_found");
    }
    const entry = requireEntry(tabId);
    try {
      entry.webContents.findInPage(query, {
        forward: true,
        findNext: false,
        matchCase: request.caseSensitive === true
      });
    } catch {
      // Text extraction below is the authoritative result; native page highlight is best effort.
    }
    const raw = await entry.webContents.executeJavaScript(`
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
        return {
          title: normalizeText(document.title ?? ""),
          text: normalizeText(document.body?.innerText ?? document.body?.textContent ?? "")
        };
      })()
    `, true) as Record<string, unknown>;
    const text = typeof raw.text === "string" ? raw.text : "";
    const result = findSearchInPageMatches(text, query, request);
    return {
      tabId,
      address: normalizeAddress(entry.webContents.getURL()) ?? entry.runtime.address,
      title: normalizeString(raw.title) ?? entry.runtime.title,
      query,
      ...result
    };
  };

  const normalizeAgentObserveStrategy = (
    strategy: WorkbenchBrowserAgentObserveStrategy | undefined
  ): WorkbenchBrowserAgentObserveStrategy => {
    if (
      strategy === "picker"
      || strategy === "focus"
      || strategy === "hybrid"
      || strategy === "domFallback"
      || strategy === "visionFallback"
    ) {
      return strategy;
    }
    return "hybrid";
  };

  const createBrowserAgentObservationId = (tabId: string): string =>
    `lyra-lumen-${tabId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const browserAgentCacheKey = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): string => `${targetMode}:${tabId}`;

  const isAgentEditableElement = (element: WorkbenchBrowserAgentElement): boolean =>
    element.editable === true || element.actionHint === "type";

  const cacheBrowserAgentInputTarget = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    element: WorkbenchBrowserAgentElement,
    url: string,
    observationId?: string
  ): void => {
    if (!isAgentEditableElement(element)) {
      return;
    }
    browserAgentInputTargets.set(browserAgentCacheKey(tabId, targetMode), {
      element,
      url,
      updatedAt: Date.now(),
      ...(observationId === undefined ? {} : { observationId })
    });
  };

  const readCachedBrowserAgentInputTarget = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    url: string
  ): {
    readonly observationId?: string;
    readonly element: WorkbenchBrowserAgentElement;
  } | null => {
    const cached = browserAgentInputTargets.get(browserAgentCacheKey(tabId, targetMode));
    if (cached === undefined) {
      return null;
    }
    if (cached.url !== url || Date.now() - cached.updatedAt > 5 * 60_000) {
      browserAgentInputTargets.delete(browserAgentCacheKey(tabId, targetMode));
      return null;
    }
    return {
      element: cached.element,
      ...(cached.observationId === undefined ? {} : { observationId: cached.observationId })
    };
  };

  const activeEditableElementFromObservation = (
    observation: WorkbenchBrowserAgentObservation
  ): WorkbenchBrowserAgentElement | null => {
    if (observation.activeElementId === null) {
      return null;
    }
    const element = observation.elements.find((candidate) => candidate.id === observation.activeElementId);
    return element !== undefined && isAgentEditableElement(element) ? element : null;
  };

  const buildBrowserAgentObservationScript = ({
    frameTreeNodeId,
    strategy
  }: {
    readonly frameTreeNodeId: number;
    readonly strategy: WorkbenchBrowserAgentObserveStrategy;
  }): string => `
    (() => {
      const FRAME_TREE_NODE_ID = ${JSON.stringify(frameTreeNodeId)};
      const STRATEGY = ${JSON.stringify(strategy)};
      const warnings = [];

      const normalizeText = (value, maxLength = 160) => {
        if (typeof value !== "string") return "";
        const normalized = value.replace(/\\s+/g, " ").trim();
        return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength - 3) + "...";
      };

      const isDisabled = (element) =>
        element.disabled === true
        || element.getAttribute?.("disabled") !== null
        || element.getAttribute?.("aria-disabled") === "true";

      const isVisible = (element, win = window) => {
        const ElementCtor = win.Element || Element;
        if (!(element instanceof ElementCtor) || !element.isConnected) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = win.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (Number.parseFloat(style.opacity || "1") <= 0) return false;
        return true;
      };

      const associatedLabel = (element, doc = document) => {
        if (element.id) {
          const label = doc.querySelector("label[for=" + JSON.stringify(element.id) + "]");
          if (label) return label.innerText || label.textContent || "";
        }
        let parent = element.parentElement;
        while (parent) {
          if (parent.tagName === "LABEL") return parent.innerText || parent.textContent || "";
          parent = parent.parentElement;
        }
        return "";
      };

      const describedByText = (element, doc = document) => String(element.getAttribute?.("aria-describedby") || "")
        .split(/\\s+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((id) => doc.getElementById(id))
        .filter((entry) => entry instanceof HTMLElement)
        .map((entry) => normalizeText(entry.innerText || entry.textContent || "", 80))
        .find(Boolean) || "";

      const selectorPreview = (element) => {
        const tagName = String(element.tagName || "div").toLowerCase();
        const parts = [tagName];
        const id = normalizeText(element.id || "", 40);
        if (id) parts.push("#" + id);
        const classes = Array.from(element.classList || [])
          .map((item) => normalizeText(String(item), 24))
          .filter((item) => item.length > 0 && !item.startsWith("__lyra"))
          .slice(0, 2);
        if (classes.length > 0) parts.push(classes.map((item) => "." + item).join(""));
        const name = normalizeText(element.getAttribute?.("name") || "", 24);
        if (name) parts.push("[name=\\"" + name + "\\"]");
        const testId = normalizeText(
          element.getAttribute?.("data-testid") || element.getAttribute?.("data-test-id") || "",
          24
        );
        if (testId) parts.push("[data-testid=\\"" + testId + "\\"]");
        const type = normalizeText(element.getAttribute?.("type") || "", 20);
        if (type) parts.push("[type=\\"" + type + "\\"]");
        const preview = parts.join("");
        return preview.length <= 120 ? preview : preview.slice(0, 117) + "...";
      };

      const stateHint = (element) => {
        const expanded = element.getAttribute?.("aria-expanded");
        if (expanded === "true") return "expanded";
        if (expanded === "false") return "collapsed";
        const selected = element.getAttribute?.("aria-selected");
        if (selected === "true") return "selected";
        if (selected === "false") return "unselected";
        const pressed = element.getAttribute?.("aria-pressed");
        if (pressed === "true") return "pressed";
        if (pressed === "false") return "unpressed";
        return normalizeText(element.getAttribute?.("data-state") || "", 32);
      };

      const isEditable = (element) => {
        const win = element?.ownerDocument?.defaultView || window;
        const contentEditable = String(element.getAttribute?.("contenteditable") || "").toLowerCase();
        const role = String(element.getAttribute?.("role") || "").toLowerCase();
        return element instanceof win.HTMLInputElement
          || element instanceof win.HTMLTextAreaElement
          || element instanceof win.HTMLSelectElement
          || (element instanceof win.HTMLElement && element.isContentEditable)
          || (contentEditable.length > 0 && contentEditable !== "false")
          || role === "textbox"
          || role === "searchbox";
      };

      const isFocusable = (element) => {
        if (isDisabled(element)) return false;
        if (element.getAttribute?.("tabindex") === "-1") return false;
        const win = element?.ownerDocument?.defaultView || window;
        if (element instanceof win.HTMLElement && element.tabIndex >= 0) return true;
        if (element instanceof win.HTMLAnchorElement && element.href) return true;
        if (element instanceof win.HTMLButtonElement) return true;
        if (isEditable(element)) return true;
        const role = element.getAttribute?.("role");
        return role === "button" || role === "link" || role === "checkbox" || role === "menuitem";
      };

      const actionHint = (element, cursor) => {
        const win = element?.ownerDocument?.defaultView || window;
        if (element instanceof win.HTMLSelectElement) return "select";
        if (isEditable(element)) return "type";
        const role = normalizeText(element.getAttribute?.("role") || "", 32);
        const popup = normalizeText(element.getAttribute?.("aria-haspopup") || "", 32);
        if (popup) return "open " + popup;
        if (element instanceof win.HTMLAnchorElement && element.href) return "open";
        if (role === "button" || role === "link" || cursor === "pointer") return "click";
        return "";
      };

      const labelFor = (element, doc = document) => {
        const label = normalizeText(
          element.getAttribute?.("aria-label")
            || element.getAttribute?.("placeholder")
            || element.getAttribute?.("title")
            || element.getAttribute?.("alt")
            || associatedLabel(element, doc)
            || element.innerText
            || element.textContent
            || element.value
            || "",
          120
        );
        return label || "(no label)";
      };

      const detectAuthChallengeSignals = (doc, win, frameUrl = "") => {
        const signals = [];
        const pushSignal = (signal) => {
          if (!signals.some((entry) => entry.kind === signal.kind && entry.label === signal.label && entry.url === signal.url)) {
            signals.push(signal);
          }
        };
        const passwordFields = Array.from(doc.querySelectorAll("input[type='password']"))
          .filter((element) => isVisible(element, win) && !isDisabled(element));
        if (passwordFields.length > 0) {
          pushSignal({
            kind: "login_wall",
            confidence: "medium",
            source: "dom",
            label: "visible password field",
            url: frameUrl
          });
        }
        const oneTimeCodeFields = Array.from(doc.querySelectorAll("input[autocomplete='one-time-code'], input[inputmode='numeric']"))
          .filter((element) => {
            if (!isVisible(element, win) || isDisabled(element)) return false;
            const input = element;
            const maxLength = Number(input.getAttribute?.("maxlength") || NaN);
            return input.getAttribute?.("autocomplete") === "one-time-code"
              || (Number.isFinite(maxLength) && maxLength >= 4 && maxLength <= 8);
          });
        if (oneTimeCodeFields.length > 0) {
          pushSignal({
            kind: "mfa",
            confidence: "high",
            source: "attribute",
            label: "one-time-code input",
            url: frameUrl
          });
        }
        for (const frame of Array.from(doc.querySelectorAll("iframe, frame"))) {
          const src = normalizeText(frame.getAttribute?.("src") || "", 600);
          if (!src) continue;
          let host = "";
          try {
            host = new URL(src, String(win.location.href || "https://invalid.local")).hostname.toLowerCase();
          } catch (_error) {
            host = src.toLowerCase();
          }
          if (
            host.includes("recaptcha")
            || host.includes("hcaptcha")
            || host.includes("challenges.cloudflare")
            || host.includes("turnstile")
          ) {
            pushSignal({
              kind: "captcha",
              confidence: "high",
              source: "frame",
              label: host,
              url: src
            });
          }
        }
        return signals;
      };

      const items = [];
      const seen = new Set();
      const authChallengeSignals = [];
      let activeElementId = null;

      const crawl = (doc, win, offsetX = 0, offsetY = 0, frameUrl = "") => {
        const selector = [
          "a[href]",
          "button",
          "input",
          "select",
          "textarea",
          "summary",
          "[contenteditable]",
          "[tabindex]",
          "[role='button']",
          "[role='link']",
          "[role='checkbox']",
          "[role='textbox']",
          "[role='searchbox']",
          "[role='menuitem']"
        ].join(",");
        const collectCandidates = (root, scope = "document") => {
          const collected = Array.from(root.querySelectorAll(selector))
            .map((element) => ({ element, scope }));
          const descendants = Array.from(root.querySelectorAll("*"));
          for (const element of descendants) {
            if (element.shadowRoot) {
              collected.push(...collectCandidates(element.shadowRoot, "shadow"));
            }
          }
          return collected;
        };
        const candidates = collectCandidates(doc, "document");

        for (const candidate of candidates) {
          const { element, scope } = candidate;
          if (!(element instanceof win.Element) || seen.has(element)) continue;
          seen.add(element);
          if (!isVisible(element, win) || isDisabled(element)) continue;
          if (element instanceof win.HTMLInputElement && element.type === "hidden") continue;
          const focusable = isFocusable(element);
          if (STRATEGY === "focus" && !focusable) continue;
          const rect = element.getBoundingClientRect();
          const style = win.getComputedStyle(element);
          const cursor = normalizeText(style.cursor || "", 32);
          const editable = isEditable(element);
          const tabIndex = element instanceof win.HTMLElement ? element.tabIndex : -1;
          const id = items.length + 1;
          if (element === doc.activeElement) activeElementId = id;
          items.push({
            id,
            frameTreeNodeId: FRAME_TREE_NODE_ID,
            tagName: String(element.tagName || "div").toLowerCase(),
            role: normalizeText(element.getAttribute?.("role") || String(element.tagName || "element").toLowerCase(), 40),
            label: labelFor(element, doc),
            actionHint: actionHint(element, cursor),
            stateHint: stateHint(element),
            tooltipText: normalizeText(element.getAttribute?.("title") || describedByText(element, doc), 80),
            textSnippet: normalizeText(
              element instanceof win.HTMLInputElement || element instanceof win.HTMLTextAreaElement
                ? element.value || ""
                : element.innerText || element.textContent || "",
              80
            ),
            selectorPreview: selectorPreview(element),
            bounds: {
              x: Math.round(rect.left + offsetX),
              y: Math.round(rect.top + offsetY),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            },
            focusable,
            tabIndex,
            disabled: isDisabled(element),
            editable,
            href: element instanceof win.HTMLAnchorElement ? element.href : "",
            inputType: element instanceof win.HTMLInputElement ? normalizeText(element.type || "", 32) : "",
            frameUrl,
            discoveryScope: scope
          });
        }

        authChallengeSignals.push(...detectAuthChallengeSignals(doc, win, frameUrl));

        for (const frame of Array.from(doc.querySelectorAll("iframe, frame"))) {
          try {
            if (!isVisible(frame, win)) continue;
            const childDoc = frame.contentDocument || frame.contentWindow?.document;
            const childWin = frame.contentWindow;
            if (!childDoc || !childWin) continue;
            const frameRect = frame.getBoundingClientRect();
            crawl(
              childDoc,
              childWin,
              offsetX + frameRect.left,
              offsetY + frameRect.top,
              normalizeText(String(childWin.location?.href || ""), 400)
            );
          } catch (_error) {
            warnings.push("cross_origin_frame_skipped");
            const src = normalizeText(frame.getAttribute?.("src") || "", 600);
            if (src) {
              authChallengeSignals.push({
                kind: "cross_origin_auth_frame",
                confidence: "low",
                source: "frame",
                label: "cross-origin frame",
                url: src
              });
            }
          }
        }
      };

      crawl(document, window, 0, 0, normalizeText(String(window.location.href || ""), 400));

      const focusOrder = items
        .filter((item) => item.focusable)
        .slice()
        .sort((a, b) => {
          const aTab = a.tabIndex > 0 ? a.tabIndex : Number.MAX_SAFE_INTEGER;
          const bTab = b.tabIndex > 0 ? b.tabIndex : Number.MAX_SAFE_INTEGER;
          if (aTab !== bTab) return aTab - bTab;
          return a.id - b.id;
        })
        .map((item) => item.id);

      return {
        title: normalizeText(document.title || "", 200),
        url: normalizeText(String(window.location.href || ""), 600),
        elements: items,
        focusOrder,
        activeElementId,
        authChallengeSignals,
        warnings
      };
    })()
  `;

  const observeAgentPage = async (
    tabId: string,
    request?: {
      readonly strategy?: WorkbenchBrowserAgentObserveStrategy;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
      readonly suppressActivity?: boolean;
    }
  ): Promise<WorkbenchBrowserAgentObservation> => {
    const target = await resolveBrowserAgentTarget(tabId, request?.targetMode, request?.timeoutMs);
    const strategy = normalizeAgentObserveStrategy(request?.strategy);
    const timeoutMs = normalizeExecuteScriptTimeoutMs(request?.timeoutMs, 8_000);
    if (request?.suppressActivity !== true) {
      publishBrowserAgentActivity({
        tabId,
        targetMode: target.targetMode,
        action: "observe",
        durationMs: Math.max(1_250, Math.min(3_200, timeoutMs))
      });
    }
    const raw = await runFrameScriptWithTimeout(
      () => target.webContents.executeJavaScript(
        buildBrowserAgentObservationScript({
          frameTreeNodeId: target.webContents.mainFrame.frameTreeNodeId,
          strategy
        }),
        true
      ),
      timeoutMs
    ) as Record<string, unknown>;

    const rawUrl = typeof raw.url === "string" ? raw.url : agentTargetAddress(target);
    const rawElements = Array.isArray(raw.elements) ? raw.elements : [];
    const elements = rawElements
      .map((item): WorkbenchBrowserAgentElement | null => {
        if (item === null || typeof item !== "object") {
          return null;
        }
        const record = item as Record<string, unknown>;
        const bounds = record.bounds !== null && typeof record.bounds === "object"
          ? record.bounds as Record<string, unknown>
          : {};
        const id = Number(record.id);
        const x = Number(bounds.x);
        const y = Number(bounds.y);
        const width = Number(bounds.width);
        const height = Number(bounds.height);
        if (
          Number.isFinite(id) === false
          || Number.isFinite(x) === false
          || Number.isFinite(y) === false
          || Number.isFinite(width) === false
          || Number.isFinite(height) === false
          || width <= 0
          || height <= 0
        ) {
          return null;
        }
        const discoveryScope =
          record.discoveryScope === "shadow" || record.discoveryScope === "frame"
            ? record.discoveryScope
            : "document";
        const baseElement = {
          id: Math.round(id),
          frameTreeNodeId: Number.isFinite(Number(record.frameTreeNodeId))
            ? Math.round(Number(record.frameTreeNodeId))
            : target.webContents.mainFrame.frameTreeNodeId,
          tagName: typeof record.tagName === "string" ? record.tagName : "element",
          role: typeof record.role === "string" ? record.role : "element",
          label: typeof record.label === "string" && record.label.length > 0
            ? record.label
            : "(no label)",
          selectorPreview: typeof record.selectorPreview === "string" ? record.selectorPreview : "",
          bounds: {
            x: Math.round(x),
            y: Math.round(y),
            width: Math.round(width),
            height: Math.round(height)
          },
          focusable: record.focusable === true,
          disabled: record.disabled === true,
          editable: record.editable === true,
          discoveryScope,
          ...(typeof record.actionHint === "string" && record.actionHint.length > 0
            ? { actionHint: record.actionHint }
            : {}),
          ...(typeof record.stateHint === "string" && record.stateHint.length > 0
            ? { stateHint: record.stateHint }
            : {}),
          ...(typeof record.tooltipText === "string" && record.tooltipText.length > 0
            ? { tooltipText: record.tooltipText }
            : {}),
          ...(typeof record.textSnippet === "string" && record.textSnippet.length > 0
            ? { textSnippet: record.textSnippet }
            : {}),
          ...(Number.isFinite(Number(record.tabIndex))
            ? { tabIndex: Math.round(Number(record.tabIndex)) }
            : {}),
          ...(typeof record.href === "string" && record.href.length > 0
            ? { href: record.href }
            : {}),
          ...(typeof record.inputType === "string" && record.inputType.length > 0
            ? { inputType: record.inputType }
            : {}),
          ...(typeof record.frameUrl === "string" && record.frameUrl.length > 0
            ? { frameUrl: record.frameUrl }
            : {})
        } satisfies Omit<WorkbenchBrowserAgentElement, "stableId" | "targetRef">;
        const targetRef = createBrowserAgentTargetRef(rawUrl, baseElement);
        const element: WorkbenchBrowserAgentElement = {
          ...baseElement,
          stableId: targetRef.stableId,
          targetRef: targetRef.targetRef
        };
        return element;
      })
      .filter((item): item is WorkbenchBrowserAgentElement => item !== null);

    const focusOrder = Array.isArray(raw.focusOrder)
      ? raw.focusOrder
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
          .map((value) => Math.round(value))
      : elements.filter((element) => element.focusable).map((element) => element.id);
    const activeElementId = Number.isFinite(Number(raw.activeElementId))
      ? Math.round(Number(raw.activeElementId))
      : null;
    const warnings = Array.isArray(raw.warnings)
      ? [...new Set(raw.warnings.filter((value): value is string => typeof value === "string"))]
      : [];
    const authChallengeSignals = Array.isArray(raw.authChallengeSignals)
      ? raw.authChallengeSignals
          .map((value): NonNullable<WorkbenchBrowserAgentObservation["authChallengeSignals"]>[number] | null => {
            if (value === null || typeof value !== "object") {
              return null;
            }
            const record = value as Record<string, unknown>;
            const kind = record.kind;
            const confidence = record.confidence;
            const source = record.source;
            if (
              (kind !== "captcha" && kind !== "mfa" && kind !== "oauth_popup" && kind !== "login_wall" && kind !== "cross_origin_auth_frame")
              || (confidence !== "high" && confidence !== "medium" && confidence !== "low")
              || (source !== "dom" && source !== "attribute" && source !== "frame" && source !== "browser")
            ) {
              return null;
            }
            return {
              kind,
              confidence,
              source,
              ...(typeof record.label === "string" && record.label.length > 0 ? { label: record.label } : {}),
              ...(typeof record.url === "string" && record.url.length > 0 ? { url: record.url } : {})
            };
          })
          .filter((value): value is NonNullable<WorkbenchBrowserAgentObservation["authChallengeSignals"]>[number] => value !== null)
      : [];
    const observation: WorkbenchBrowserAgentObservation = {
      ok: true,
      kind: "lyraLumenMap",
      tabId,
      targetMode: target.targetMode,
      observationId: createBrowserAgentObservationId(tabId),
      strategy,
      url: rawUrl,
      title: typeof raw.title === "string" && raw.title.length > 0 ? raw.title : agentTargetTitle(target),
      elements,
      activeElementId,
      focusOrder,
      ...(authChallengeSignals.length > 0 ? { authChallengeSignals } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      nextRecommendedAction:
        authChallengeSignals.some((signal) => signal.confidence === "high")
          ? "lyra_lumen_elevate"
          : elements.length > 0 ? "lyra_lumen.act" : "lyra_lumen.read"
    };
    browserAgentCache.set(browserAgentCacheKey(tabId, target.targetMode), {
      observationId: observation.observationId,
      elements: observation.elements,
      elementsByTargetRef: new Map(observation.elements.map((element) => [element.targetRef, element])),
      url: observation.url,
      title: observation.title
    });
    const activeEditableElement = activeEditableElementFromObservation(observation);
    if (activeEditableElement !== null) {
      cacheBrowserAgentInputTarget(
        tabId,
        target.targetMode,
        activeEditableElement,
        observation.url,
        observation.observationId
      );
    }
    return observation;
  };

  const findAgentElement = async (
    tabId: string,
    request: {
      readonly elementId?: number;
      readonly targetRef?: string;
    },
    targetMode: WorkbenchBrowserAgentTargetMode,
    timeoutMs: number | undefined
  ): Promise<{
    readonly element: WorkbenchBrowserAgentElement | null;
    readonly observationId?: string;
  }> => {
    const cached = browserAgentCache.get(browserAgentCacheKey(tabId, targetMode));
    const cachedElement =
      request.targetRef === undefined
        ? cached?.elements.find((element) => element.id === request.elementId) ?? null
        : cached?.elementsByTargetRef.get(request.targetRef) ?? null;
    if (cached !== undefined && cachedElement !== null) {
      return { element: cachedElement, observationId: cached.observationId };
    }
    const observed = await observeAgentPage(tabId, {
      strategy: "hybrid",
      targetMode,
      suppressActivity: true,
      ...(timeoutMs === undefined ? {} : { timeoutMs })
    });
    return {
      element:
        request.targetRef === undefined
          ? observed.elements.find((element) => element.id === request.elementId) ?? null
          : observed.elements.find((element) => element.targetRef === request.targetRef) ?? null,
      observationId: observed.observationId
    };
  };

  const readFocusedElementSignature = async (
    target: BrowserAgentPageTarget,
    timeoutMs: number | undefined
  ): Promise<string> => {
    try {
      const value = await runFrameScriptWithTimeout(
        () => target.webContents.executeJavaScript(`
          (() => {
            const element = document.activeElement;
            if (!element) return "";
            return [
              element.tagName || "",
              element.id || "",
              element.getAttribute?.("name") || "",
              element.getAttribute?.("aria-label") || "",
              element.getAttribute?.("role") || ""
            ].join("|");
          })()
        `, true),
        normalizeExecuteScriptTimeoutMs(timeoutMs, 1_500)
      );
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  };

  const centerOfAgentElement = (element: WorkbenchBrowserAgentElement): { x: number; y: number } => ({
    x: element.bounds.x + Math.round(element.bounds.width / 2),
    y: element.bounds.y + Math.round(element.bounds.height / 2)
  });

  const staleElementResult = (
    tabId: string,
    elementId: number | undefined,
    targetRef: string | undefined,
    targetMode: WorkbenchBrowserAgentTargetMode,
    observationId?: string
  ): WorkbenchBrowserAgentActionResult => ({
    ok: false,
    kind: "lyraLumenActionResult",
    tabId,
    inputMode: "chromium",
    targetMode,
    ...(elementId === undefined ? {} : { elementId }),
    ...(targetRef === undefined ? {} : { targetRef }),
    ...(observationId === undefined ? {} : { beforeObservationId: observationId }),
    staleElement: true,
    nextRecommendedAction: "lyra_lumen.map",
    error: {
      kind: "staleElement",
      message:
        targetRef === undefined
          ? `Element ${elementId ?? "(unspecified)"} is not present in the latest Lyra Lumen map.`
          : `Target ${targetRef} is not present in the latest Lyra Lumen map.`
    }
  });

  const noEditableTargetResult = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    beforeObservationId?: string
  ): WorkbenchBrowserAgentActionResult => ({
    ok: false,
    kind: "lyraLumenActionResult",
    tabId,
    inputMode: "chromium",
    targetMode,
    ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
    nextRecommendedAction: "lyra_lumen.map",
    error: {
      kind: "noEditableTarget",
      message:
        "No focused or previously selected editable browser element is available. Map the page and pass the editable elementId to lyra_lumen_type."
    }
  });

  const buildBrowserAgentTextInsertionScript = ({
    elementId,
    x,
    y,
    text,
    clear
  }: {
    readonly elementId: number;
    readonly x: number;
    readonly y: number;
    readonly text: string;
    readonly clear: boolean;
  }): string => `
    (() => {
      const TARGET_ID = ${JSON.stringify(elementId)};
      const POINT = ${JSON.stringify({ x, y })};
      const TEXT = ${JSON.stringify(text)};
      const CLEAR = ${JSON.stringify(clear)};

      const normalizeText = (value, maxLength = 160) => {
        if (typeof value !== "string") return "";
        const normalized = value.replace(/\\s+/g, " ").trim();
        return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength - 3) + "...";
      };

      const isDisabled = (element) =>
        element.disabled === true
        || element.getAttribute?.("disabled") !== null
        || element.getAttribute?.("aria-disabled") === "true";

      const isVisible = (element, win = window) => {
        const ElementCtor = win.Element || Element;
        if (!(element instanceof ElementCtor) || !element.isConnected) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = win.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (Number.parseFloat(style.opacity || "1") <= 0) return false;
        return true;
      };

      const isEditable = (element) => {
        const win = element?.ownerDocument?.defaultView || window;
        const contentEditable = String(element.getAttribute?.("contenteditable") || "").toLowerCase();
        const role = String(element.getAttribute?.("role") || "").toLowerCase();
        return element instanceof win.HTMLInputElement
          || element instanceof win.HTMLTextAreaElement
          || element instanceof win.HTMLSelectElement
          || (element instanceof win.HTMLElement && element.isContentEditable)
          || (contentEditable.length > 0 && contentEditable !== "false")
          || role === "textbox"
          || role === "searchbox";
      };

      const selector = [
        "a[href]",
        "button",
        "input",
        "select",
        "textarea",
        "summary",
        "[contenteditable]",
        "[tabindex]",
        "[role='button']",
        "[role='link']",
        "[role='checkbox']",
        "[role='textbox']",
        "[role='searchbox']",
        "[role='menuitem']"
      ].join(",");

      const collectCandidates = () => {
        const items = [];
        const seen = new Set();
        const crawl = (doc, win, offsetX = 0, offsetY = 0) => {
          for (const element of Array.from(doc.querySelectorAll(selector))) {
            if (!(element instanceof win.Element) || seen.has(element)) continue;
            seen.add(element);
            if (!isVisible(element, win) || isDisabled(element)) continue;
            if (element instanceof win.HTMLInputElement && element.type === "hidden") continue;
            const rect = element.getBoundingClientRect();
            items.push({
              id: items.length + 1,
              element,
              bounds: {
                x: Math.round(rect.left + offsetX),
                y: Math.round(rect.top + offsetY),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
            });
          }
          for (const frame of Array.from(doc.querySelectorAll("iframe, frame"))) {
            try {
              if (!isVisible(frame, win)) continue;
              const childDoc = frame.contentDocument || frame.contentWindow?.document;
              const childWin = frame.contentWindow;
              if (!childDoc || !childWin) continue;
              const frameRect = frame.getBoundingClientRect();
              crawl(childDoc, childWin, offsetX + frameRect.left, offsetY + frameRect.top);
            } catch (_error) {
              // Cross-origin frames cannot be edited through DOM injection here.
            }
          }
        };
        crawl(document, window);
        return items;
      };

      const editableNear = (element) => {
        const win = element?.ownerDocument?.defaultView || window;
        if (!(element instanceof win.Element)) return null;
        if (isEditable(element)) return element;
        const descendant = element.querySelector?.(
          "input:not([type='hidden']), textarea, select, [contenteditable], [role='textbox'], [role='searchbox']"
        );
        if (descendant instanceof win.Element && isEditable(descendant)) return descendant;
        let parent = element.parentElement;
        while (parent) {
          if (isEditable(parent)) return parent;
          parent = parent.parentElement;
        }
        return null;
      };

      const dispatchTextEvents = (element) => {
        const win = element?.ownerDocument?.defaultView || window;
        try {
          element.dispatchEvent(new win.InputEvent("input", {
            bubbles: true,
            composed: true,
            data: TEXT,
            inputType: "insertText"
          }));
        } catch (_error) {
          element.dispatchEvent(new win.Event("input", { bubbles: true }));
        }
        element.dispatchEvent(new win.Event("change", { bubbles: true }));
      };

      const byId = collectCandidates().find((item) => item.id === TARGET_ID)?.element ?? null;
      const byPoint = document.elementFromPoint(POINT.x, POINT.y);
      const target = editableNear(byId) ?? editableNear(byPoint);
      const targetWindow = target?.ownerDocument?.defaultView || window;
      if (!(target instanceof targetWindow.Element)) {
        return { ok: false, errorKind: "editable_not_found" };
      }

      const before = target instanceof targetWindow.HTMLInputElement || target instanceof targetWindow.HTMLTextAreaElement
        ? target.value
        : target.textContent || "";
      let method = "dom";
      try {
        if (target instanceof targetWindow.HTMLInputElement || target instanceof targetWindow.HTMLTextAreaElement) {
          target.focus({ preventScroll: true });
          const start = CLEAR ? 0 : (target.selectionStart ?? target.value.length);
          const end = CLEAR ? target.value.length : (target.selectionEnd ?? target.value.length);
          if (typeof target.setRangeText === "function") {
            target.setRangeText(TEXT, start, end, "end");
            method = "setRangeText";
          } else {
            target.value = target.value.slice(0, start) + TEXT + target.value.slice(end);
            method = "value";
          }
          dispatchTextEvents(target);
        } else if (target instanceof targetWindow.HTMLElement) {
          target.focus({ preventScroll: true });
          const ownerDocument = target.ownerDocument || document;
          const selection = ownerDocument.getSelection?.();
          if (selection) {
            const range = ownerDocument.createRange();
            range.selectNodeContents(target);
            if (!CLEAR) {
              range.collapse(false);
            }
            selection.removeAllRanges();
            selection.addRange(range);
          }
          const inserted = ownerDocument.execCommand?.("insertText", false, TEXT) === true;
          method = inserted ? "execCommand.insertText" : "textNode";
          if (!inserted) {
            if (CLEAR) {
              target.textContent = TEXT;
            } else {
              target.appendChild(ownerDocument.createTextNode(TEXT));
            }
          }
          dispatchTextEvents(target);
        }
      } catch (error) {
        return {
          ok: false,
          errorKind: "insert_failed",
          message: String(error instanceof Error ? error.message : error)
        };
      }

      const after = target instanceof targetWindow.HTMLInputElement || target instanceof targetWindow.HTMLTextAreaElement
        ? target.value
        : target.textContent || "";
      return {
        ok: after !== before || (CLEAR && after === TEXT) || TEXT.length === 0,
        method,
        tagName: String(target.tagName || "element").toLowerCase(),
        role: normalizeText(target.getAttribute?.("role") || "", 40),
        textChanged: after !== before,
        textPreview: normalizeText(after, 120)
      };
    })()
  `;

  const insertTextIntoAgentElement = async (
    target: BrowserAgentPageTarget,
    element: WorkbenchBrowserAgentElement,
    text: string,
    clear: boolean,
    timeoutMs: number | undefined
  ): Promise<{
    readonly ok: boolean;
    readonly method?: string;
    readonly textChanged?: boolean;
    readonly errorKind?: string;
    readonly message?: string;
  }> => {
    const frame = findFrameInWebContents(target.webContents, element.frameTreeNodeId)
      ?? target.webContents.mainFrame;
    const { x, y } = centerOfAgentElement(element);
    const raw = await runFrameScriptWithTimeout(
      () => frame.executeJavaScript(
        buildBrowserAgentTextInsertionScript({
          elementId: element.id,
          x,
          y,
          text,
          clear
        }),
        true
      ),
      normalizeExecuteScriptTimeoutMs(timeoutMs, 4_000)
    );
    if (raw === null || typeof raw !== "object") {
      return { ok: false, errorKind: "invalid_insert_result" };
    }
    const record = raw as Record<string, unknown>;
    return {
      ok: record.ok === true,
      ...(typeof record.method === "string" ? { method: record.method } : {}),
      ...(typeof record.errorKind === "string" ? { errorKind: record.errorKind } : {}),
      ...(typeof record.message === "string" ? { message: record.message } : {}),
      ...(typeof record.textChanged === "boolean" ? { textChanged: record.textChanged } : {})
    };
  };

  const observeAfterAgentInput = async (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    timeoutMs: number | undefined
  ): Promise<WorkbenchBrowserAgentObservation | null> => {
    try {
      const normalizedTimeoutMs = timeoutMs === undefined
        ? undefined
        : Math.max(250, Math.min(timeoutMs, 8_000));
      return await observeAgentPage(tabId, {
        strategy: "hybrid",
        targetMode,
        suppressActivity: true,
        ...(normalizedTimeoutMs === undefined ? {} : { timeoutMs: normalizedTimeoutMs })
      });
    } catch {
      return null;
    }
  };

  const normalizeAgentFocusDirection = (
    direction: WorkbenchBrowserAgentFocusDirection | undefined
  ): WorkbenchBrowserAgentFocusDirection => {
    if (direction === "previous" || direction === "scan") {
      return direction;
    }
    return "next";
  };

  const normalizeAgentFocusSteps = (
    direction: WorkbenchBrowserAgentFocusDirection,
    steps: number | undefined
  ): number => {
    const defaultSteps = direction === "scan" ? 12 : 1;
    const maxSteps = direction === "scan" ? 40 : 10;
    const value = Number.isFinite(Number(steps)) ? Math.round(Number(steps)) : defaultSteps;
    return Math.max(1, Math.min(value, maxSteps));
  };

  const markAgentFocusAnchor = async (target: BrowserAgentPageTarget): Promise<string | null> => {
    const token = `lyra-agent-focus-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const marked = await target.webContents.executeJavaScript(`
        (() => {
          const active = document.activeElement;
          if (!(active instanceof HTMLElement)) return false;
          active.setAttribute("data-lyra-agent-focus-anchor", ${JSON.stringify(token)});
          return true;
        })()
      `, true);
      return marked === true ? token : null;
    } catch {
      return null;
    }
  };

  const restoreAgentFocusAnchor = async (
    target: BrowserAgentPageTarget,
    token: string | null
  ): Promise<boolean> => {
    if (token === null) {
      return false;
    }
    try {
      const restored = await target.webContents.executeJavaScript(`
        (() => {
          const selector = ${JSON.stringify(`[data-lyra-agent-focus-anchor="${token}"]`)};
          const target = document.querySelector(selector);
          if (!(target instanceof HTMLElement)) return false;
          target.focus({ preventScroll: true });
          target.removeAttribute("data-lyra-agent-focus-anchor");
          return true;
        })()
      `, true);
      return restored === true;
    } catch {
      return false;
    }
  };

  const sendAgentTabKey = async (
    target: BrowserAgentPageTarget,
    backwards: boolean
  ): Promise<void> => {
    target.webContents.focus();
    if (backwards) {
      sendAgentInputEvent(target, { type: "keyDown", keyCode: "Tab", modifiers: ["shift"] });
    } else {
      sendAgentInputEvent(target, { type: "keyDown", keyCode: "Tab" });
    }
    await delay(12);
    if (backwards) {
      sendAgentInputEvent(target, { type: "keyUp", keyCode: "Tab", modifiers: ["shift"] });
    } else {
      sendAgentInputEvent(target, { type: "keyUp", keyCode: "Tab" });
    }
    await delay(60);
  };

  const focusedElementFromObservation = (
    observation: WorkbenchBrowserAgentObservation
  ): WorkbenchBrowserAgentElement | undefined => {
    if (observation.activeElementId === null) {
      return undefined;
    }
    return observation.elements.find((element) => element.id === observation.activeElementId);
  };

  const focusTrailEntryFromObservation = (
    step: number,
    observation: WorkbenchBrowserAgentObservation
  ): WorkbenchBrowserAgentFocusTrailEntry => {
    const element = focusedElementFromObservation(observation);
    return {
      step,
      elementId: observation.activeElementId,
      ...(element === undefined ? {} : { role: element.role, label: element.label })
    };
  };

  const focusAgentPage = async (
    tabId: string,
    request: {
      readonly direction: WorkbenchBrowserAgentFocusDirection;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly steps?: number;
      readonly restoreFocus?: boolean;
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserAgentFocusResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request.targetMode, request.timeoutMs);
    const direction = normalizeAgentFocusDirection(request.direction);
    const steps = normalizeAgentFocusSteps(direction, request.steps);
    const restoreFocus = request.restoreFocus ?? direction === "scan";
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "focus",
      inputActive: true,
      durationMs: Math.max(1_400, Math.min(4_000, 950 + steps * 160))
    });
    const before = await observeAgentPage(tabId, {
      strategy: "focus",
      targetMode: target.targetMode,
      suppressActivity: true,
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
    });
    const anchor = restoreFocus ? await markAgentFocusAnchor(target) : null;
    const trail: WorkbenchBrowserAgentFocusTrailEntry[] = [];
    let current = before;
    const backwards = direction === "previous";

    for (let index = 0; index < steps; index += 1) {
      await sendAgentTabKey(target, backwards);
      current = await observeAgentPage(tabId, {
        strategy: "focus",
        targetMode: target.targetMode,
        suppressActivity: true,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      });
      trail.push(focusTrailEntryFromObservation(index + 1, current));
    }

    const restored = restoreFocus ? await restoreAgentFocusAnchor(target, anchor) : false;
    if (restored) {
      current = await observeAgentPage(tabId, {
        strategy: "focus",
        targetMode: target.targetMode,
        suppressActivity: true,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      });
    }
    const focusedElement = focusedElementFromObservation(current);

    return {
      ok: true,
      kind: "lyraLumenFocusResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      direction,
      steps,
      activeElementId: current.activeElementId,
      ...(focusedElement === undefined ? {} : { focusedElement }),
      focusTrail: trail,
      beforeObservationId: before.observationId,
      afterObservationId: current.observationId,
      restored,
      message: restored
        ? `Scanned ${steps} focus stop${steps === 1 ? "" : "s"} and restored the previous focus.`
        : `Moved focus ${direction} by ${steps} step${steps === 1 ? "" : "s"}.`,
      nextRecommendedAction: current.activeElementId === null ? "lyra_lumen.map" : "lyra_lumen.act"
    };
  };

  const actOnAgentElement = async (
    tabId: string,
    request: {
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly interaction: WorkbenchBrowserAgentInteraction;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request.targetMode, request.timeoutMs);
    const { element, observationId } = await findAgentElement(
      tabId,
      {
        ...(request.elementId === undefined ? {} : { elementId: request.elementId }),
        ...(request.targetRef === undefined ? {} : { targetRef: request.targetRef })
      },
      target.targetMode,
      request.timeoutMs
    );
    if (element === null) {
      return staleElementResult(tabId, request.elementId, request.targetRef, target.targetMode, observationId);
    }

    const beforeUrl = agentTargetAddress(target);
    const beforeFocus = await readFocusedElementSignature(target, request.timeoutMs);
    const { x, y } = centerOfAgentElement(element);
    const interaction = request.interaction;
    await performAgentPointerInteraction({
      tabId,
      target,
      x,
      y,
      interaction,
    });
    await delay(interaction === "hover" ? 80 : 120);

    const after = await observeAfterAgentInput(tabId, target.targetMode, request.timeoutMs);
    if (isAgentEditableElement(element)) {
      cacheBrowserAgentInputTarget(
        tabId,
        target.targetMode,
        element,
        after?.url ?? agentTargetAddress(target),
        after?.observationId ?? observationId
      );
    }
    const afterFocus = await readFocusedElementSignature(target, request.timeoutMs);
    return {
      ok: true,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      elementId: element.id,
      targetRef: element.targetRef,
      x,
      y,
      ...(observationId === undefined ? {} : { beforeObservationId: observationId }),
      ...(after === null ? {} : { afterObservationId: after.observationId }),
      pageChanged: beforeUrl !== agentTargetAddress(target),
      focusChanged: beforeFocus !== afterFocus,
      navigationStarted: agentTargetIsLoading(target),
      message: `${interaction} sent to element ${element.id} (${element.targetRef}) with Chromium virtual input.`,
      nextRecommendedAction: "lyra_lumen.map"
    };
  };

  const actOnAgentPoint = async (
    tabId: string,
    request: {
      readonly point: WorkbenchBrowserAgentPoint;
      readonly interaction: WorkbenchBrowserAgentInteraction;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request.targetMode, request.timeoutMs);
    const beforeUrl = agentTargetAddress(target);
    const beforeFocus = await readFocusedElementSignature(target, request.timeoutMs);
    const x = Math.max(0, Math.round(request.point.x));
    const y = Math.max(0, Math.round(request.point.y));
    const interaction = request.interaction;
    await performAgentPointerInteraction({
      tabId,
      target,
      x,
      y,
      interaction,
    });
    await delay(interaction === "hover" ? 80 : 120);

    const after = await observeAfterAgentInput(tabId, target.targetMode, request.timeoutMs);
    const activeEditableElement = after === null ? null : activeEditableElementFromObservation(after);
    if (activeEditableElement !== null) {
      cacheBrowserAgentInputTarget(
        tabId,
        target.targetMode,
        activeEditableElement,
        after?.url ?? agentTargetAddress(target),
        after?.observationId
      );
    }
    const afterFocus = await readFocusedElementSignature(target, request.timeoutMs);
    return {
      ok: true,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      x,
      y,
      ...(after === null ? {} : { afterObservationId: after.observationId }),
      pageChanged: beforeUrl !== agentTargetAddress(target),
      focusChanged: beforeFocus !== afterFocus,
      navigationStarted: agentTargetIsLoading(target),
      message:
        `${interaction} sent to visual fallback point (${x}, ${y})` +
        (request.point.reason === undefined ? "." : `: ${request.point.reason}`),
      nextRecommendedAction: "lyra_lumen.map"
    };
  };

  const typeIntoAgentElement = async (
    tabId: string,
    request: {
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly text: string;
      readonly clear?: boolean;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request.targetMode, request.timeoutMs);
    const currentUrl = agentTargetAddress(target);
    let beforeObservationId = browserAgentCache.get(browserAgentCacheKey(tabId, target.targetMode))?.observationId;
    let element: WorkbenchBrowserAgentElement | null = null;
    if (request.elementId !== undefined || request.targetRef !== undefined) {
      const found = await findAgentElement(
        tabId,
        {
          ...(request.elementId === undefined ? {} : { elementId: request.elementId }),
          ...(request.targetRef === undefined ? {} : { targetRef: request.targetRef })
        },
        target.targetMode,
        request.timeoutMs
      );
      if (found.element === null) {
        return staleElementResult(tabId, request.elementId, request.targetRef, target.targetMode, found.observationId);
      }
      beforeObservationId = found.observationId ?? beforeObservationId;
      element = found.element;
    } else {
      const observed = await observeAgentPage(tabId, {
        strategy: "hybrid",
        targetMode: target.targetMode,
        suppressActivity: true,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      });
      beforeObservationId = observed.observationId;
      element = activeEditableElementFromObservation(observed);
      if (element === null) {
        element = readCachedBrowserAgentInputTarget(tabId, target.targetMode, currentUrl)?.element ?? null;
      }
    }

    if (element === null) {
      return noEditableTargetResult(tabId, target.targetMode, beforeObservationId);
    }

    const { x, y } = centerOfAgentElement(element);
    const beforeUrl = agentTargetAddress(target);
    const beforeFocus = await readFocusedElementSignature(target, request.timeoutMs);
    await performAgentPointerInteraction({
      tabId,
      target,
      x,
      y,
      interaction: "click"
    });
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "type",
      inputActive: true,
      cursor: { x, y },
      durationMs: Math.max(1_700, Math.min(5_000, 950 + request.text.length * 24))
    });

    let insertion: Awaited<ReturnType<typeof insertTextIntoAgentElement>>;
    try {
      insertion = await insertTextIntoAgentElement(
        target,
        element,
        request.text,
        request.clear === true,
        request.timeoutMs
      );
    } catch (error) {
      return {
        ok: false,
        kind: "lyraLumenActionResult",
        tabId,
        inputMode: "chromium",
        targetMode: target.targetMode,
        elementId: element.id,
        targetRef: element.targetRef,
        x,
        y,
        ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
        nextRecommendedAction: "lyra_lumen.map",
        error: {
          kind: "insertFailed",
          message: String(error instanceof Error ? error.message : error)
        }
      };
    }
    if (insertion.ok !== true) {
      return {
        ok: false,
        kind: "lyraLumenActionResult",
        tabId,
        inputMode: "chromium",
        targetMode: target.targetMode,
        elementId: element.id,
        targetRef: element.targetRef,
        x,
        y,
        ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
        nextRecommendedAction: "lyra_lumen.map",
        error: {
          kind: insertion.errorKind ?? "insertFailed",
          message: insertion.message ?? `Unable to insert text into editable element ${element.id}.`
        }
      };
    }

    await delay(80);
    const after = await observeAfterAgentInput(tabId, target.targetMode, request.timeoutMs);
    cacheBrowserAgentInputTarget(
      tabId,
      target.targetMode,
      element,
      after?.url ?? agentTargetAddress(target),
      after?.observationId ?? beforeObservationId
    );
    const afterFocus = await readFocusedElementSignature(target, request.timeoutMs);
    return {
      ok: true,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      elementId: element.id,
      targetRef: element.targetRef,
      x,
      y,
      ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
      ...(after === null ? {} : { afterObservationId: after.observationId }),
      pageChanged: beforeUrl !== agentTargetAddress(target),
      focusChanged: beforeFocus !== afterFocus,
      navigationStarted: agentTargetIsLoading(target),
      message:
        `Typed into editable element ${element.id}` +
        (insertion.method === undefined ? "." : ` via ${insertion.method}.`),
      nextRecommendedAction: "lyra_lumen.map"
    };
  };

  const pressAgentKey = async (
    tabId: string,
    request: {
      readonly key: string;
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request.targetMode, request.timeoutMs);
    let beforeObservationId = browserAgentCache.get(browserAgentCacheKey(tabId, target.targetMode))?.observationId;
    let elementId = request.elementId;
    let targetRef = request.targetRef;
    let x: number | undefined;
    let y: number | undefined;
    if (elementId !== undefined || targetRef !== undefined) {
      const focused = await actOnAgentElement(tabId, {
        ...(elementId === undefined ? {} : { elementId }),
        ...(targetRef === undefined ? {} : { targetRef }),
        interaction: "click",
        targetMode: target.targetMode,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      });
      if (focused.ok === false) {
        return focused;
      }
      beforeObservationId = focused.beforeObservationId;
      elementId = focused.elementId;
      targetRef = focused.targetRef;
      x = focused.x;
      y = focused.y;
    }
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "press",
      inputActive: true,
      ...(x === undefined || y === undefined ? {} : { cursor: { x, y } }),
      durationMs: 1_550
    });
    const beforeUrl = agentTargetAddress(target);
    const beforeFocus = await readFocusedElementSignature(target, request.timeoutMs);
    target.webContents.focus();
    sendAgentInputEvent(target, { type: "keyDown", keyCode: request.key });
    if (request.key.length === 1) {
      sendAgentInputEvent(target, { type: "char", keyCode: request.key });
    }
    sendAgentInputEvent(target, { type: "keyUp", keyCode: request.key });
    await delay(80);
    const after = await observeAfterAgentInput(tabId, target.targetMode, request.timeoutMs);
    const afterFocus = await readFocusedElementSignature(target, request.timeoutMs);
    return {
      ok: true,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      ...(elementId === undefined ? {} : { elementId }),
      ...(targetRef === undefined ? {} : { targetRef }),
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
      ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
      ...(after === null ? {} : { afterObservationId: after.observationId }),
      pageChanged: beforeUrl !== agentTargetAddress(target),
      focusChanged: beforeFocus !== afterFocus,
      navigationStarted: agentTargetIsLoading(target),
      message: `Pressed ${request.key} with Chromium virtual keyboard.`,
      nextRecommendedAction: "lyra_lumen.map"
    };
  };

  const readAgentDomSummaryFromTarget = async (
    target: BrowserAgentPageTarget,
    maxChars: number | undefined,
    timeoutMs: number
  ): Promise<WorkbenchObservationBrowserDomSummary & {
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
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
    request: {
      readonly url: string;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserNavigateResult & { readonly targetMode: WorkbenchBrowserAgentTargetMode }> => {
    const target = await resolveBrowserAgentTarget(tabId, request.targetMode, request.timeoutMs);
    const address = normalizeAddress(request.url);
    if (address === null) {
      throw new Error("url is required");
    }
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "navigate",
      inputActive: true,
      durationMs: Math.max(1_800, Math.min(5_000, request.timeoutMs ?? 2_400))
    });
    if (target.targetMode === "live") {
      return {
        ...(await navigateInEntry(requireEntry(tabId), { address })),
        targetMode: "live"
      };
    }
    const shadow = target as BrowserAgentShadowEntry;
    shadow.detached = true;
    await waitForAgentPageLoad(shadow.webContents, address, request.timeoutMs ?? 8_000);
    shadow.address = normalizeAddress(shadow.webContents.getURL()) ?? address;
    shadow.title = normalizeString(shadow.webContents.getTitle()) ?? shadow.address;
    browserAgentCache.delete(browserAgentCacheKey(tabId, shadow.targetMode));
    browserAgentInputTargets.delete(browserAgentCacheKey(tabId, shadow.targetMode));
    return {
      address: shadow.address,
      tabId,
      title: shadow.title,
      targetMode: shadow.targetMode
    };
  };

  const readAgentPage = async (
    tabId: string,
    request: {
      readonly strategy?: WorkbenchBrowserAgentObserveStrategy;
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
      readonly maxChars?: number;
      readonly timeoutMs?: number;
    }
  ) => {
    const timeoutMs = normalizeExecuteScriptTimeoutMs(request.timeoutMs, 8_000);
    const target = await resolveBrowserAgentTarget(tabId, request.targetMode, timeoutMs);
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "read",
      durationMs: Math.max(900, Math.min(3_200, timeoutMs))
    });
    if (request.strategy === "domFallback") {
      return await readAgentDomSummaryFromTarget(target, request.maxChars, timeoutMs);
    }
    return await readAgentRecentTextFromTarget(target, request.maxChars, timeoutMs);
  };

  const captureAgentPage = async (
    tabId: string,
    request?: {
      readonly targetMode?: WorkbenchBrowserAgentTargetMode;
    }
  ): Promise<WorkbenchVisualCaptureResult & { readonly targetMode: WorkbenchBrowserAgentTargetMode }> => {
    const target = await resolveBrowserAgentTarget(tabId, request?.targetMode, undefined);
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "capture",
      durationMs: 1_500
    });
    if (target.targetMode === "live") {
      return {
        ...(await capturePage(tabId)),
        targetMode: "live"
      };
    }
    const image = await target.webContents.capturePage();
    const size = image.getSize();
    return {
      tabId,
      targetMode: target.targetMode,
      mimeType: "image/png",
      imageBase64: image.toPNG().toString("base64"),
      width: size.width,
      height: size.height,
      visibleOnly: false
    };
  };

  const showAgentActivity: WorkbenchBrowserViewManager["showAgentActivity"] = async (
    tabId,
    request
  ) => {
    const target = await resolveBrowserAgentTarget(tabId, request.targetMode, request.durationMs);
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: request.action,
      inputActive: true,
      ...(request.durationMs === undefined ? {} : { durationMs: request.durationMs })
    });
    return {
      tabId,
      targetMode: target.targetMode,
      action: request.action
    };
  };

  const readAgentFollowAudit: WorkbenchBrowserViewManager["readAgentFollowAudit"] = async (
    tabId,
    request
  ) => {
    const targetMode = request?.targetMode ?? "live";
    const session = followSessions.get(followSessionKey(tabId, targetMode)) ?? null;
    const maxActions = Math.max(1, Math.min(400, Math.round(request?.maxActions ?? 80)));
    const actions = session?.actions.slice(-maxActions) ?? [];
    const countByAction = (action: BrowserAgentCursorOverlayAction): number =>
      session?.actions.filter((entry) => entry.action === action).length ?? 0;
    return {
      ok: true,
      kind: "lyraLumenFollowAudit",
      tabId,
      targetMode,
      sessionId: session?.sessionId ?? null,
      startedAt: session?.startedAt ?? null,
      updatedAt: session?.updatedAt ?? null,
      totalActions: session?.totalActions ?? 0,
      actions,
      compactSummary: {
        observeCount: countByAction("observe"),
        readCount: countByAction("read"),
        captureCount: countByAction("capture"),
        waitCount: countByAction("wait"),
        navigationCount: countByAction("navigate"),
        focusCount: countByAction("focus"),
        pointerCount: countByAction("act"),
        typeCount: countByAction("type"),
        keyCount: countByAction("press"),
        interruptedCount: session?.interruptedCount ?? 0
      }
    };
  };

  const auditAgentPageDiagnostics: WorkbenchBrowserViewManager["auditAgentPageDiagnostics"] = async (
    tabId,
    request
  ) => {
    const target = await resolveBrowserAgentTarget(tabId, request?.targetMode, undefined);
    let runtimeDiagnostic: WorkbenchBrowserPageDiagnosticEntry | null = null;
    try {
      const raw = await target.webContents.executeJavaScript(`
        (() => {
          const entries = performance.getEntriesByType("resource");
          return {
            resourceCount: entries.length,
            navigationType: performance.getEntriesByType("navigation")[0]?.type || "unknown"
          };
        })()
      `, true) as { readonly resourceCount?: unknown; readonly navigationType?: unknown };
      runtimeDiagnostic = {
        id: `diag-runtime-${tabId}-${Date.now()}`,
        at: Date.now(),
        source: "runtime",
        severity: "info",
        message: `Runtime reachable; resources=${Number(raw.resourceCount ?? 0)}, navigation=${String(raw.navigationType ?? "unknown")}.`,
        url: agentTargetAddress(target)
      };
    } catch (error) {
      runtimeDiagnostic = {
        id: `diag-runtime-${tabId}-${Date.now()}`,
        at: Date.now(),
        source: "runtime",
        severity: "warning",
        message: `Runtime diagnostics unavailable: ${String(error instanceof Error ? error.message : error)}`,
        url: agentTargetAddress(target)
      };
    }
    const maxEntries = Math.max(1, Math.min(300, Math.round(request?.maxEntries ?? 80)));
    const buffered = [...(pageDiagnostics.get(tabId) ?? []), runtimeDiagnostic].filter(
      (entry): entry is WorkbenchBrowserPageDiagnosticEntry => entry !== null
    );
    const entriesForResult = buffered.slice(-maxEntries);
    return {
      ok: true,
      kind: "lyraLumenPageDiagnostics",
      tabId,
      targetMode: target.targetMode,
      address: agentTargetAddress(target),
      title: agentTargetTitle(target),
      entries: entriesForResult,
      summary: {
        errors: entriesForResult.filter((entry) => entry.severity === "error").length,
        warnings: entriesForResult.filter((entry) => entry.severity === "warning").length,
        networkFailures: entriesForResult.filter((entry) => entry.source === "network" || entry.source === "navigation").length,
        consoleErrors: entriesForResult.filter((entry) => entry.source === "console" && entry.severity === "error").length
      }
    };
  };

  const elevateAgentPage: WorkbenchBrowserViewManager["elevateAgentPage"] = async (
    tabId,
    request
  ) => {
    const target = await resolveBrowserAgentTarget(tabId, request?.targetMode ?? "isolated", undefined);
    if (target.targetMode === "live") {
      return {
        ok: true,
        kind: "lyraLumenElevation",
        tabId,
        targetMode: "live",
        liveTabId: tabId,
        address: agentTargetAddress(target),
        title: agentTargetTitle(target),
        userActionRequired: false,
        message: "Lyra Lumen is already operating on a visible browser tab."
      };
    }
    const address = normalizeAddress(target.webContents.getURL()) ?? agentTargetAddress(target);
    const title = normalizeString(target.webContents.getTitle()) ?? agentTargetTitle(target);
    publishEvent({
      kind: "request-open-tab",
      address,
      title
    });
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "navigate",
      inputActive: true,
      durationMs: 2_000
    });
    return {
      ok: true,
      kind: "lyraLumenElevation",
      tabId,
      targetMode: target.targetMode,
      address,
      title,
      userActionRequired: true,
      message:
        "Lyra opened the isolated browser state in a visible tab so the user can complete CAPTCHA, OAuth, MFA, or another auth wall."
    };
  };

  return {
    dispose: () => {
      void elementPickerController.dispose();
      for (const session of debuggerSessions.values()) {
        void session.dispose().catch(() => undefined);
      }
      debuggerSessions.clear();
      webThemeInjector.dispose();
      for (const timer of tombstoneTimers.values()) {
        clearTimeout(timer);
      }
      tombstoneTimers.clear();
      for (const entry of entries.values()) {
        destroyEntry(entry, false);
      }
      for (const tabId of [...browserAgentShadows.keys()]) {
        destroyBrowserAgentShadow(tabId);
      }
      browserAgentInputTargets.clear();
      browserAgentCache.clear();
      followSessions.clear();
      pageDiagnostics.clear();
      agentControlLocks.clear();
      agentSyntheticInputUntil.clear();
      agentControlInterruptions.clear();
      activeChromePopovers.clear();
      detachChromePopoverView();
      if (
        chromePopoverView !== null
        && chromePopoverView.webContents.isDestroyed() === false
      ) {
        chromePopoverView.webContents.close({ waitForBeforeUnload: false });
      }
      chromePopoverView = null;
      entries.clear();
      tombstones.clear();
      const window = getWindow();
      if (window !== null && window.isDestroyed() === false && overlayAttached) {
        window.contentView.removeChildView(overlayView);
        overlayAttached = false;
        overlayVisible = false;
      }
    },
    applyWebTheme: async (snapshot: WorkbenchBrowserWebThemeSnapshot) => {
      await webThemeInjector.updateSnapshot(snapshot);
      for (const [tabId, request] of [...activeChromePopovers.entries()]) {
        if (entries.has(tabId)) {
          await setChromePopover({ ...request, tabId, visible: true }).catch(() => {
            activeChromePopovers.delete(tabId);
          });
        }
      }
    },
    syncTopology,
    syncLayout,
    navigate: async (request: WorkbenchBrowserNavigateRequest) => {
      const address = normalizeAddress(request.address);
      if (address === null) {
        throw new Error("address is required");
      }
      const requestedTabId = normalizeString(request.tabId);
      const requestedEntry = requestedTabId === null ? null : entries.get(requestedTabId) ?? null;
      if (requestedEntry !== null) {
        return await navigateInEntry(requestedEntry, request);
      }

      if (request.newTab !== true) {
        const targetTabId = getActiveOrFocusedTabId();
        const targetEntry = targetTabId === null ? null : entries.get(targetTabId) ?? null;
        if (targetEntry !== null) {
          return await navigateInEntry(targetEntry, request);
        }
      }

      publishEvent({
        kind: "request-open-tab",
        address,
        ...(normalizeString(request.title) === null ? {} : { title: normalizeString(request.title)! })
      });
      return {
        address,
        tabId: null,
        title: normalizeString(request.title)
      };
    },
    goBack: (tabId: string) => {
      const entry = entries.get(tabId);
      if (
        entry === undefined
        || entry.isDestroyed
        || entry.webContents.navigationHistory.canGoBack() === false
      ) {
        return;
      }
      entry.webContents.navigationHistory.goBack();
      syncNavigationFlags(entry);
    },
    goForward: (tabId: string) => {
      const entry = entries.get(tabId);
      if (
        entry === undefined
        || entry.isDestroyed
        || entry.webContents.navigationHistory.canGoForward() === false
      ) {
        return;
      }
      entry.webContents.navigationHistory.goForward();
      syncNavigationFlags(entry);
    },
    reload: (tabId: string, ignoreCache = false) => {
      const entry = entries.get(tabId);
      if (entry === undefined || entry.isDestroyed) {
        return;
      }
      if (ignoreCache) {
        entry.webContents.reloadIgnoringCache();
        return;
      }
      entry.webContents.reload();
    },
    stop: (tabId: string) => {
      const entry = entries.get(tabId);
      if (entry === undefined || entry.isDestroyed) {
        return;
      }
      entry.webContents.stop();
      updateRuntimeState(entry, { isLoading: false });
    },
    readPageState: (request?: WorkbenchBrowserReadPageStateRequest) => {
      const targetTabId = targetTabIdForRead(request);
      if (targetTabId === null) {
        return null;
      }
      return entries.get(targetTabId)?.runtime ?? tombstones.get(targetTabId)?.runtime ?? null;
    },
    setElementPickerMode: async (request) => {
      const tabId = normalizeString(request?.tabId);
      if (tabId === null || entries.has(tabId) === false) {
        publishEvent({
          kind: "element-picker-state",
          state: {
            tabId: tabId ?? "unknown",
            enabled: false,
            cause: "script_error",
            errorCode: "tab_not_found"
          }
        });
        return;
      }
      await elementPickerController.setMode({
        tabId,
        enabled: request.enabled === true,
        ...(request.enabled === true
          ? {
              appearance: request.appearance,
              mode: request.mode
            }
          : {})
      });
    },
    readActiveTabId: () => getActiveOrFocusedTabId(),
    listFrames: (tabId: string) => {
      const entry = requireEntry(tabId);
      return entry.webContents.mainFrame.framesInSubtree
        .filter((frame) => frame.isDestroyed() === false)
        .map((frame) => ({
          frameTreeNodeId: frame.frameTreeNodeId,
          url: frame.url,
          origin: frame.origin,
          name: frame.name,
          ...(frame.parent === null
            ? {}
            : { parentFrameTreeNodeId: frame.parent.frameTreeNodeId }),
          isMainFrame: frame.frameTreeNodeId === entry.webContents.mainFrame.frameTreeNodeId
        }));
    },
    probeFrameDom: async (
      tabId: string,
      frameTreeNodeId: number,
      options?: { readonly maxChars?: number }
    ) => {
      const entry = requireEntry(tabId);
      const frame = findFrame(entry, frameTreeNodeId);
      if (frame === null) {
        throw new Error(`Unknown browser frame: ${frameTreeNodeId}`);
      }
      try {
        const raw = await frame.executeJavaScript(
          buildFrameDomProbeScript({
            maxChars: Math.max(512, Math.min(40_000, Math.round(options?.maxChars ?? 8_000)))
          }),
          true
        );
        return normalizeFrameDomProbeResult(raw);
      } catch (_error) {
        return { embeddedDocuments: [] };
      }
    },
    executeFrameScript: async (
      tabId,
      request: {
        readonly script: string;
        readonly frameTreeNodeId?: number;
        readonly userGesture?: boolean;
        readonly timeoutMs?: number;
      }
    ) => {
      if (typeof request.script !== "string" || request.script.trim().length === 0) {
        throw new Error("script is required");
      }
      const entry = requireEntry(tabId);
      const timeoutMs = normalizeExecuteScriptTimeoutMs(request.timeoutMs);
      if (typeof request.frameTreeNodeId === "number" && Number.isFinite(request.frameTreeNodeId)) {
        const frame = findFrame(entry, Math.round(request.frameTreeNodeId));
        if (frame === null) {
          throw new Error(`Unknown browser frame: ${request.frameTreeNodeId}`);
        }
        return await runFrameScriptWithTimeout(
          () => frame.executeJavaScript(request.script, request.userGesture === true),
          timeoutMs
        );
      }
      return await runFrameScriptWithTimeout(
        () => entry.webContents.executeJavaScript(request.script, request.userGesture === true),
        timeoutMs
      );
    },
    dispatchNativeInput: async (
      tabId: string,
      events: readonly WorkbenchBrowserNativeInputEvent[]
    ) => {
      const entry = requireEntry(tabId);
      entry.webContents.focus();
      for (const event of events) {
        entry.webContents.sendInputEvent(toNativeInputEvent(event));
        await delay(Math.max(0, Math.min(2_000, Math.round(event.delayMs ?? 0))));
      }
    },
    openDebuggerSession: async (tabId: string): Promise<WorkbenchBrowserDebuggerSession> => {
      const entry = requireEntry(tabId);
      const existing = debuggerSessions.get(tabId);
      if (existing !== undefined) {
        return await existing.acquire();
      }
      const created = createWorkbenchBrowserSharedDebuggerSession({
        tabId,
        webContents: entry.webContents,
        readPageAddress: () => entries.get(tabId)?.runtime.address,
      });
      debuggerSessions.set(tabId, created);
      return await created.acquire();
    },
    fetchWithTabSession: async (tabId, request) => {
      const entry = requireEntry(tabId);
      const timeoutMs = Math.max(250, Math.min(30_000, Math.round(request.timeoutMs ?? 10_000)));
      const maxBytes = Math.max(1_024, Math.min(128 * 1024 * 1024, Math.round(request.maxBytes ?? 64 * 1024 * 1024)));
      const response = await entry.webContents.session.fetch(request.url, {
        method: "GET",
        ...(typeof request.referrer === "string" && request.referrer.trim().length > 0
          ? { headers: { referer: request.referrer.trim() } }
          : {}),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const contentLength = Number(response.headers.get("content-length") ?? NaN);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        throw Object.assign(new Error("document_too_large"), { code: "document_too_large" });
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > maxBytes) {
        throw Object.assign(new Error("document_too_large"), { code: "document_too_large" });
      }
      return {
        finalUrl: response.url,
        status: response.status,
        ...(response.headers.get("content-type") === null
          ? {}
          : { mimeType: response.headers.get("content-type") ?? "" }),
        body: buffer
      };
    },
    readPageDomSummary,
    extractPageText,
    capturePage,
    searchInPage,
    setChromePopover,
    resolveFrameGlobalBounds: async (
      tabId: string,
      frameTreeNodeId: number
    ): Promise<WorkbenchBrowserFrameGlobalBounds | null> => {
      const entry = entries.get(tabId);
      if (entry === undefined || entry.isDestroyed) {
        return null;
      }
      const targetFrame = findFrame(entry, frameTreeNodeId);
      if (targetFrame === null) {
        return null;
      }
      // If this is the main frame, the bounds come from the view layout directly.
      if (targetFrame.frameTreeNodeId === entry.webContents.mainFrame.frameTreeNodeId) {
        const layout = findLayout(tabId);
        if (layout === null) {
          return null;
        }
        return { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
      }
      // Walk up the frame tree, accumulating iframe element bounds.
      // Each parent frame runs a script to find the child iframe element's position.
      try {
        let currentFrame = targetFrame;
        let accumulatedX = 0;
        let accumulatedY = 0;
        let boundsWidth = 0;
        let boundsHeight = 0;
        let firstIteration = true;
        while (currentFrame.parent !== null && !currentFrame.parent.isDestroyed()) {
          const parentFrame = currentFrame.parent;
          const childFrameTreeNodeId = currentFrame.frameTreeNodeId;
          // Ask parent frame where the child iframe element is located.
          const result = await parentFrame.executeJavaScript(`
            (() => {
              const childFrameId = ${childFrameTreeNodeId};
              const iframes = Array.from(document.querySelectorAll("iframe, frame"));
              for (const iframe of iframes) {
                // Match by name or by iterating WebFrameMain.framesInSubtree
                const rect = iframe.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) {
                  continue;
                }
                // We return the first visible iframe that could match.
                // Electron's contentFrame matching is done by the parent having
                // called executeJavaScript on the correct parent WebFrameMain.
                return {
                  x: Math.round(rect.left),
                  y: Math.round(rect.top),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                  count: iframes.length
                };
              }
              return null;
            })()
          `, false) as { x: number; y: number; width: number; height: number; count: number } | null;
          if (result === null) {
            return null;
          }
          accumulatedX += result.x;
          accumulatedY += result.y;
          if (firstIteration) {
            boundsWidth = result.width;
            boundsHeight = result.height;
            firstIteration = false;
          }
          // If the parent is the main frame, we're done traversing frames.
          if (parentFrame.frameTreeNodeId === entry.webContents.mainFrame.frameTreeNodeId) {
            break;
          }
          currentFrame = parentFrame;
        }
        // Add the WebContentsView layout offset (view position within the Electron window).
        const layout = findLayout(tabId);
        if (layout !== null) {
          accumulatedX += layout.x;
          accumulatedY += layout.y;
        }
        return {
          x: accumulatedX,
          y: accumulatedY,
          width: boundsWidth,
          height: boundsHeight
        };
      } catch {
        return null;
      }
    },
    reapplyLayout: () => {
      applyLayout();
    },
    toggleDevToolsForActivePage: () => {
      const targetTabId = getActiveOrFocusedTabId();
      if (targetTabId === null) {
        return false;
      }
      const entry = entries.get(targetTabId);
      if (entry === undefined || entry.isDestroyed) {
        return false;
      }
      if (entry.webContents.isDevToolsOpened()) {
        entry.webContents.closeDevTools();
      } else {
        entry.webContents.openDevTools({ mode: "detach" });
      }
      return true;
    },
    observeAgentPage,
    actOnAgentElement,
    actOnAgentPoint,
    focusAgentPage,
    typeIntoAgentElement,
    pressAgentKey,
    navigateAgentPage,
    readAgentPage,
    captureAgentPage,
    showAgentActivity,
    readAgentFollowAudit,
    auditAgentPageDiagnostics,
    elevateAgentPage
  };
};
