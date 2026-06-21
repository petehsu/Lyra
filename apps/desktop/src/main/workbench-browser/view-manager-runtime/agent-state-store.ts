import { LumenTargetRegistry } from "../lumen-target-registry";
import type { WorkbenchBrowserAgentElement, WorkbenchBrowserAgentObservation, WorkbenchBrowserAgentTargetMode } from "../types";
import type { BrowserAgentCacheEntry } from "./types";

type CachedInputTarget = {
  readonly observationId?: string;
  readonly element: WorkbenchBrowserAgentElement;
  readonly url: string;
  readonly updatedAt: number;
};

export const browserAgentCacheKey = (
  tabId: string,
  targetMode: WorkbenchBrowserAgentTargetMode
): string => `${targetMode}:${tabId}`;

export const isAgentEditableElement = (element: WorkbenchBrowserAgentElement): boolean =>
  element.editable === true || element.actionHint === "type";

export const activeEditableElementFromObservation = (
  observation: WorkbenchBrowserAgentObservation
): WorkbenchBrowserAgentElement | null => {
  if (observation.activeElementId === null) {
    return null;
  }
  const element = observation.elements.find((candidate) => candidate.id === observation.activeElementId);
  return element !== undefined && isAgentEditableElement(element) ? element : null;
};

export const createBrowserAgentStateStore = () => {
  const browserAgentCache = new Map<string, BrowserAgentCacheEntry>();
  const lumenTargetRegistry = new LumenTargetRegistry();
  const browserAgentInputTargets = new Map<string, CachedInputTarget>();
  const pendingSettleHints = new Map<string, boolean>();
  const pendingFileChooserHints = new Map<string, number>();
  const cdpFileChooserOpen = new Map<string, number>();

  const PENDING_FILE_CHOOSER_TTL_MS = 30_000;
  const CDP_FILE_CHOOSER_TTL_MS = 120_000;

  const invalidateBrowserAgentTargets = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    reason: "navigation" | "frameReload" = "navigation"
  ): void => {
    browserAgentCache.delete(browserAgentCacheKey(tabId, targetMode));
    browserAgentInputTargets.delete(browserAgentCacheKey(tabId, targetMode));
    lumenTargetRegistry.invalidateTab(tabId, targetMode, reason);
  };

  const rememberBrowserAgentObservation = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    observation: WorkbenchBrowserAgentObservation
  ): void => {
    browserAgentCache.set(browserAgentCacheKey(tabId, targetMode), {
      observationId: observation.observationId,
      mapEpoch: observation.mapEpoch,
      elements: observation.elements,
      elementsById: new Map(observation.elements.map((element) => [element.id, element])),
      elementsByTargetRef: new Map(observation.elements.map((element) => [element.targetRef, element])),
      targets: observation.targets,
      targetsByRef: new Map(observation.targets.map((entry) => [entry.targetRef, entry])),
      url: observation.url,
      title: observation.title
    });
  };

  const readBrowserAgentCacheEntry = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): BrowserAgentCacheEntry | undefined => browserAgentCache.get(browserAgentCacheKey(tabId, targetMode));

  const nextMapEpoch = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): number => lumenTargetRegistry.nextMapEpoch(tabId, targetMode);

  const targetTtlMs = (): number => lumenTargetRegistry.targetTtlMs();

  const registerTargetObservation = (
    observation: Parameters<LumenTargetRegistry["registerObservation"]>[0]
  ): void => {
    lumenTargetRegistry.registerObservation(observation);
  };

  const resolveElementId = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    elementId: number,
    observationId?: string
  ): ReturnType<LumenTargetRegistry["resolveElementId"]> =>
    lumenTargetRegistry.resolveElementId(tabId, targetMode, elementId, observationId);

  const resolveTargetRef = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    targetRef: string,
    now?: number
  ): ReturnType<LumenTargetRegistry["resolveTargetRef"]> =>
    lumenTargetRegistry.resolveTargetRef(tabId, targetMode, targetRef, now);

  const getTargetRefSnapshot = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    targetRef: string
  ): ReturnType<LumenTargetRegistry["getTargetRefSnapshot"]> =>
    lumenTargetRegistry.getTargetRefSnapshot(tabId, targetMode, targetRef);

  const explainTargetRef = (
    request: Parameters<LumenTargetRegistry["explainTargetRef"]>[0]
  ): ReturnType<LumenTargetRegistry["explainTargetRef"]> => lumenTargetRegistry.explainTargetRef(request);

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

  const markPendingSettle = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): void => {
    pendingSettleHints.set(browserAgentCacheKey(tabId, targetMode), true);
  };

  const consumePendingSettle = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): boolean => {
    const key = browserAgentCacheKey(tabId, targetMode);
    const pending = pendingSettleHints.get(key) === true;
    if (pending) {
      pendingSettleHints.delete(key);
    }
    return pending;
  };

  const markPendingFileChooser = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): void => {
    pendingFileChooserHints.set(browserAgentCacheKey(tabId, targetMode), Date.now());
  };

  const markCdpFileChooserOpen = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): void => {
    cdpFileChooserOpen.set(browserAgentCacheKey(tabId, targetMode), Date.now());
  };

  const markCdpFileChooserClosed = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): void => {
    cdpFileChooserOpen.delete(browserAgentCacheKey(tabId, targetMode));
  };

  const isActiveFileChooserPending = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): boolean => {
    const key = browserAgentCacheKey(tabId, targetMode);
    const cdpOpenedAt = cdpFileChooserOpen.get(key);
    if (cdpOpenedAt !== undefined) {
      if (Date.now() - cdpOpenedAt > CDP_FILE_CHOOSER_TTL_MS) {
        cdpFileChooserOpen.delete(key);
      } else {
        return true;
      }
    }
    const markedAt = pendingFileChooserHints.get(key);
    if (markedAt === undefined) {
      return false;
    }
    if (Date.now() - markedAt > PENDING_FILE_CHOOSER_TTL_MS) {
      pendingFileChooserHints.delete(key);
      return false;
    }
    return true;
  };

  const dispose = (): void => {
    browserAgentInputTargets.clear();
    browserAgentCache.clear();
    lumenTargetRegistry.clear();
    pendingSettleHints.clear();
    pendingFileChooserHints.clear();
    cdpFileChooserOpen.clear();
  };

  return {
    activeEditableElementFromObservation,
    cacheBrowserAgentInputTarget,
    consumePendingSettle,
    isActiveFileChooserPending,
    dispose,
    explainTargetRef,
    invalidateBrowserAgentTargets,
    markCdpFileChooserClosed,
    markCdpFileChooserOpen,
    markPendingFileChooser,
    markPendingSettle,
    isAgentEditableElement,
    nextMapEpoch,
    readBrowserAgentCacheEntry,
    readCachedBrowserAgentInputTarget,
    registerTargetObservation,
    rememberBrowserAgentObservation,
    getTargetRefSnapshot,
    resolveElementId,
    resolveTargetRef,
    targetTtlMs
  };
};

export type BrowserAgentStateStore = ReturnType<typeof createBrowserAgentStateStore>;
