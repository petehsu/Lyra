import {
  BrowserWindow,
  View,
  WebContentsView,
  session as electronSessionApi,
  shell,
  type Session,
  type WebContents,
  type WebFrameMain
} from "electron";
import type {
  BrowserSessionSnapshot,
  BrowserSessionTabSnapshot,
  BrowserSiteStorageAvailability,
  BrowserStorageStateRef,
  WorkbenchBrowserEvent,
  WorkbenchBrowserChromePopoverRequest,
  WorkbenchBrowserClearSiteDataRequest,
  WorkbenchBrowserClearSiteDataResult,
  WorkbenchBrowserLayoutSnapshot,
  WorkbenchBrowserNavigateRequest,
  WorkbenchBrowserNavigateResult,
  WorkbenchBrowserPageDiagnosticEntry,
  WorkbenchBrowserPageLayout,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserPageSpec,
  WorkbenchBrowserReadPageStateRequest,
  WorkbenchBrowserRecoveryFailure,
  WorkbenchBrowserSearchInPageMatch,
  WorkbenchBrowserSearchInPageRequest,
  WorkbenchBrowserSearchInPageResult,
  WorkbenchBrowserStorageStateRequest,
  WorkbenchBrowserAuthChallengeSignal,
  WorkbenchBrowserElevationSession,
  WorkbenchBrowserSharedControlEvent,
  WorkbenchBrowserSharedControlStateEvent,
  WorkbenchLumenFollowAudit,
  WorkbenchLumenStaleTarget,
  WorkbenchLumenTargetRef,
  WorkbenchBrowserTopologySnapshot,
  WorkbenchBrowserWebThemeSnapshot
} from "../../shared/desktop-bridge";
import {
  WORKBENCH_BROWSER_ISOLATED_PROFILE_PARTITION,
  WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION,
  createBrowserStorageStateRef,
  sanitizeBrowserPageRestoreState
} from "../../shared/workbench-browser";
import type {
  WorkbenchTabExtractTextResult,
  WorkbenchVisualCaptureResult
} from "../../shared/workbench-observation";
import type {
  BrowserDomSummaryReadOptions,
  BrowserTextExtractOptions
} from "../workbench-observation/browser/types";
import type { LyraPerformanceResourceScheduler } from "../performance";
import type { WorkbenchObservationBrowserDomSummary } from "../workbench-observation/types";
import {
  buildBrowserDiagnosticsSummary,
  filterBrowserDiagnostics,
  recommendBrowserDiagnosticAction
} from "@lyra/browser-automation";
import {
  createCdpAuditSession,
  type CdpAuditSession,
  type CdpAuditSessionReadRequest
} from "./cdp-audit-session";
import {
  buildAgentCursorOverlayScript,
  type BrowserAgentCursorOverlayAction,
  type BrowserAgentCursorOverlayPhase
} from "./agent-cursor-overlay";
import { compactFollowSession } from "./lumen-follow-audit";
import {
  createIdleSharedControlSnapshot,
  isCriticalBrowserAgentAction,
  isSharedControlPaused,
  transitionSharedControlForAgentAction,
  transitionSharedControlForDecision,
  transitionSharedControlForUserInput,
  transitionSharedControlToAwaitingDecision,
  transitionSharedControlToIdle,
  type SharedControlDecision,
  type SharedControlInputType,
  type SharedControlSnapshot
} from "./shared-control";
import {
  buildFrameDomProbeScript,
  normalizeFrameDomProbeResult
} from "./frame-probe";
import { LumenTargetRegistry } from "./lumen-target-registry";
import { createWorkbenchBrowserSharedDebuggerSession } from "./debugger";
import { createWorkbenchBrowserElementPickerController } from "./element-picker/controller";
import { extractTextFromPage } from "./page-text-extractor";
import { createWebThemeInjector } from "./web-theme";
import { WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID } from "./types";
import type {
  WorkbenchBrowserAgentActionResult,
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentFindResult,
  WorkbenchBrowserAgentFocusDirection,
  WorkbenchBrowserAgentFocusResult,
  WorkbenchBrowserAgentFocusTrailEntry,
  WorkbenchBrowserAgentInteraction,
  WorkbenchBrowserAgentLocateResult,
  WorkbenchBrowserAgentModeInfo,
  WorkbenchBrowserAgentModeReason,
  WorkbenchBrowserAgentModeRequest,
  WorkbenchBrowserAgentObservation,
  WorkbenchBrowserAgentObserveStrategy,
  WorkbenchBrowserAgentPoint,
  WorkbenchBrowserAgentScrollBlock,
  WorkbenchBrowserAgentScrollDirection,
  WorkbenchBrowserAgentScrollEffect,
  WorkbenchBrowserAgentScrollResult,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserAgentVerification,
  WorkbenchBrowserDebuggerSession,
  WorkbenchBrowserElementPickerController,
  WorkbenchBrowserFrameGlobalBounds,
  WorkbenchBrowserNativeInputEvent,
  WorkbenchBrowserPublishEvent,
  WorkbenchBrowserSemanticActionCapability,
  WorkbenchBrowserSemanticBlockedRegion,
  WorkbenchBrowserSemanticFrame,
  WorkbenchBrowserSemanticNode,
  WorkbenchBrowserSemanticTree,
  WorkbenchBrowserViewManager
} from "./types";

import type {
  BrowserAgentAutoScrollResult,
  BrowserAgentCacheEntry,
  BrowserAgentFollowSession,
  BrowserAgentFrameOwnerCandidate,
  BrowserAgentLoginBorrowResult,
  BrowserAgentPageTarget,
  BrowserAgentRawFrameObservation,
  BrowserAgentSemanticFrameGraph,
  BrowserAgentShadowEntry,
  BrowserAgentViewportState,
  BrowserElevationSessionRecord,
  BrowserPageEntry,
  BrowserPageFindRevealResult,
  BrowserPageFindTarget,
  BrowserPageTombstone
} from "./view-manager-runtime/types";
import { SharedControlInterruptionError } from "./view-manager-runtime/types";
import { createChromePopoverRuntime } from "./view-manager-runtime/chrome-popover-runtime";
import { createBrowserSessionRuntime } from "./view-manager-runtime/session-runtime";
import {
  boundsFromCdpBoxModel,
  buildBrowserAgentObservationScript,
  readAxValueText
} from "./view-manager-runtime/agent-observation-runtime";
import {
  agentPointInsideViewport,
  centerOfAgentElement,
  clampAgentPointToViewport,
  normalizeAgentScrollBlock,
  preferredAgentPointForBlock,
  scrollDeltaForDirection,
  scrollDeltaToPlacePoint
} from "./view-manager-runtime/agent-action-runtime";
import {
  agentTargetAddress,
  agentTargetIsLoading,
  agentTargetTitle,
  debuggerSessionKey,
  defaultBrowserMode,
  liveAgentTarget,
  normalizeBrowserAgentModeRequest,
  wantsLiveLoginState
} from "./view-manager-runtime/agent-target-runtime";
import {
  BROWSER_SESSION_SNAPSHOT_WRITE_DELAY_MS,
  BROWSER_SESSION_STATE_KEY,
  DEFAULT_PAGE_TITLE,
  HIDDEN_PAGE_TOMBSTONE_DELAY_MS,
  MAX_BROWSER_AGENT_FOLLOW_ACTIONS,
  MAX_BROWSER_AGENT_FOLLOW_FRAMES,
  MAX_BROWSER_PAGE_DIAGNOSTICS,
  actionCapabilitiesForElement,
  boundsCenter,
  browserAgentTargetKind,
  buildBrowserAgentFrameOwnerProbeScript,
  coerceElementVisibility,
  coerceFrameBounds,
  coerceFrameOwnerCandidates,
  createBrowserAgentFrameRef,
  createBrowserAgentTargetRef,
  delay,
  findSearchInPageMatches,
  hashStableString,
  isScriptExecutionTimeout,
  isSupportedWebUrl,
  matchFrameOwnerCandidates,
  normalizeAddress,
  normalizeAgentVerification,
  normalizeExecuteScriptTimeoutMs,
  normalizeLayout,
  normalizeNumber,
  normalizeSearchText,
  normalizeString,
  normalizeTopology,
  normalizeUnitCoverage,
  normalizeWebOrigin,
  resolveBrowserCoreKey,
  runFrameScriptWithTimeout,
  runtimeStateEquals,
  scoreFrameOwnerCandidate,
  selectSemanticLocateCandidate,
  semanticNodeKeyForTarget,
  toBounds,
  toInitialRuntimeState,
  toNativeInputEvent
} from "./view-manager-runtime/normalizers";

export const createWorkbenchBrowserViewManager = ({
  getWindow,
  publishEvent,
  workbenchState,
  onWebContentsCreated,
  performanceScheduler
}: {
  readonly getWindow: () => BrowserWindow | null;
  readonly publishEvent: WorkbenchBrowserPublishEvent;
  readonly workbenchState?: {
    readonly readState: (key: typeof BROWSER_SESSION_STATE_KEY) => string | null;
    readonly writeState: (key: typeof BROWSER_SESSION_STATE_KEY, json: string) => void;
  };
  readonly onWebContentsCreated?: (tabId: string, webContents: WebContents) => () => void;
  readonly performanceScheduler?: LyraPerformanceResourceScheduler;
}): WorkbenchBrowserViewManager => {
  const entries = new Map<string, BrowserPageEntry>();
  const browserAgentShadows = new Map<string, BrowserAgentShadowEntry>();
  const browserAgentCache = new Map<string, BrowserAgentCacheEntry>();
  const lumenTargetRegistry = new LumenTargetRegistry();
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
  const browserSessionSnapshots = new Map<string, NonNullable<WorkbenchBrowserPageRuntimeState["restoreState"]>>();
  const pendingRestoreValidations = new Map<string, NonNullable<WorkbenchBrowserPageRuntimeState["restoreState"]>>();
  const followSessions = new Map<string, BrowserAgentFollowSession>();
  const agentSyntheticInputUntil = new Map<string, number>();
  const userInputDirtyTabs = new Set<string>();
  const sharedControlStates = new Map<string, SharedControlSnapshot>();
  const sharedControlTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const lastControlHandoffByTabId = new Map<string, WorkbenchBrowserSharedControlEvent>();
  const elevationSessions = new Map<string, BrowserElevationSessionRecord>();
  const elevationSessionByIsolatedTabId = new Map<string, string>();
  const pageDiagnostics = new Map<string, WorkbenchBrowserPageDiagnosticEntry[]>();
  const tombstoneTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const debuggerSessions = new Map<
    string,
    ReturnType<typeof createWorkbenchBrowserSharedDebuggerSession>
  >();
  const cdpAuditSessions = new Map<string, CdpAuditSession>();
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
  const liveElectronSession = (): Session =>
    electronSessionApi.fromPartition(WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION);

  const isolatedElectronSession = (): Session =>
    electronSessionApi.fromPartition(WORKBENCH_BROWSER_ISOLATED_PROFILE_PARTITION);

  const browserSessionRuntime = createBrowserSessionRuntime({
    workbenchState,
    entries,
    tombstones,
    followSessions,
    userInputDirtyTabs,
    publishEvent,
    performanceScheduler,
    readTopology: () => topology,
    readLayoutSnapshot: () => layoutSnapshot,
    liveElectronSession
  });

  const persistBrowserSessionSnapshot = (): BrowserSessionSnapshot | null =>
    browserSessionRuntime.persistBrowserSessionSnapshot();
  const scheduleBrowserSessionSnapshotWrite = (delayMs = BROWSER_SESSION_SNAPSHOT_WRITE_DELAY_MS): void => {
    browserSessionRuntime.scheduleBrowserSessionSnapshotWrite(delayMs);
  };
  const readPageStorageAvailability = async (
    entry: BrowserPageEntry
  ): Promise<BrowserSiteStorageAvailability | undefined> =>
    await browserSessionRuntime.readPageStorageAvailability(entry);
  const sessionStoragePath = (electronSession: Session): string | null =>
    browserSessionRuntime.sessionStoragePath(electronSession);
  const updateRuntimeState = (
    entry: BrowserPageEntry,
    patch: Partial<WorkbenchBrowserPageRuntimeState>
  ): void => {
    browserSessionRuntime.updateRuntimeState(entry, patch);
  };
  const publishRuntimeState = (runtime: WorkbenchBrowserPageRuntimeState): void => {
    browserSessionRuntime.publishRuntimeState(runtime);
  };
  const syncPerformanceRuntimeState = (
    runtime: WorkbenchBrowserPageRuntimeState,
    entry?: BrowserPageEntry
  ): void => {
    browserSessionRuntime.syncPerformanceRuntimeState(runtime, entry);
  };
  const navigationHistorySnapshot = (
    entry: BrowserPageEntry
  ): NonNullable<WorkbenchBrowserPageRuntimeState["restoreState"]>["history"] | undefined =>
    browserSessionRuntime.navigationHistorySnapshot(entry);
  const persistedTabSnapshot = (tabId: string): BrowserSessionTabSnapshot | null =>
    browserSessionRuntime.persistedTabSnapshot(tabId);
  const hasActiveLiveAgentBrowserTask = (tabId: string): boolean =>
    browserSessionRuntime.hasActiveLiveAgentBrowserTask(tabId);

  const captureBrowserRestoreState = async (
    entry: BrowserPageEntry
  ): Promise<WorkbenchBrowserPageRuntimeState["restoreState"] | undefined> => {
    if (entry.isDestroyed || entry.webContents.isDestroyed()) {
      return entry.runtime.restoreState;
    }
    try {
      const pageState = await entry.webContents.executeJavaScript(`
        (() => {
          const hashStableString = (value) => {
            let hash = 2166136261;
            for (let index = 0; index < value.length; index += 1) {
              hash ^= value.charCodeAt(index);
              hash = Math.imul(hash, 16777619);
            }
            return (hash >>> 0).toString(36);
          };
          const normalizeText = (value, maxLength = 160) => {
            if (typeof value !== "string") return "";
            const normalized = value.replace(/\\s+/g, " ").trim();
            return normalized.length <= maxLength
              ? normalized
              : normalized.slice(0, maxLength - 3) + "...";
          };
          const cssEscape = (value) => {
            if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
              return CSS.escape(value);
            }
            return String(value).replace(/[^A-Za-z0-9_-]/g, "\\\\$&");
          };
          const selectorPreview = (element) => {
            const tagName = String(element.tagName || "div").toLowerCase();
            const parts = [tagName];
            if (element.id) parts.push("#" + cssEscape(element.id));
            const name = normalizeText(element.getAttribute?.("name") || "", 40);
            if (name) parts.push("[name=" + JSON.stringify(name) + "]");
            const type = normalizeText(element.getAttribute?.("type") || "", 24);
            if (type) parts.push("[type=" + JSON.stringify(type) + "]");
            return parts.join("");
          };
          const activeElementSnapshot = () => {
            const element = document.activeElement;
            if (!(element instanceof Element) || element === document.body || element === document.documentElement) {
              return null;
            }
            const rect = element.getBoundingClientRect();
            const selector = selectorPreview(element);
            const role = normalizeText(element.getAttribute?.("role") || "", 40);
            const inputType = element instanceof HTMLInputElement ? normalizeText(element.type || "", 32) : "";
            const label = normalizeText(
              element.getAttribute?.("aria-label")
              || element.getAttribute?.("placeholder")
              || element.getAttribute?.("title")
              || element.textContent
              || "",
              160
            );
            const signature = [
              window.location.href,
              String(element.tagName || "").toLowerCase(),
              role,
              inputType,
              selector,
              hashStableString(label),
              Math.round(rect.left / 8),
              Math.round(rect.top / 8),
              Math.round(rect.width / 8),
              Math.round(rect.height / 8)
            ].join("|");
            const targetRef = "lumen:" + hashStableString(signature);
            return {
              targetRef,
              signature,
              tagName: String(element.tagName || "element").toLowerCase(),
              role: role || undefined,
              inputType: inputType || undefined,
              selectorPreview: selector,
              cssSelector: selector,
              frameUrl: window.location.href,
              textHash: label ? hashStableString(label) : undefined,
              bounds: {
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
            };
          };
          const formDraftMetadata = () => {
            const fields = Array.from(document.querySelectorAll("input, textarea, select, [contenteditable='true']"));
            const mapped = fields.map((field) => {
              const tagName = String(field.tagName || "field").toLowerCase();
              const input = field instanceof HTMLInputElement ? field : null;
              const textarea = field instanceof HTMLTextAreaElement ? field : null;
              const select = field instanceof HTMLSelectElement ? field : null;
              const inputType = input ? String(input.type || "text").toLowerCase() : undefined;
              const autocomplete = String(field.getAttribute?.("autocomplete") || "").toLowerCase();
              const name = String(field.getAttribute?.("name") || field.id || "");
              const sensitive = inputType === "password"
                || autocomplete.includes("password")
                || autocomplete.includes("cc-")
                || autocomplete.includes("one-time-code");
              const value = input
                ? input.value
                : textarea
                  ? textarea.value
                  : select
                    ? Array.from(select.selectedOptions).map((option) => option.value).join(",")
                    : field.textContent || "";
              const defaultValue = input
                ? input.defaultValue
                : textarea
                  ? textarea.defaultValue
                  : select
                    ? Array.from(select.options).filter((option) => option.defaultSelected).map((option) => option.value).join(",")
                    : "";
              const dirty = inputType === "checkbox" || inputType === "radio"
                ? Boolean(input?.checked !== input?.defaultChecked)
                : value !== defaultValue;
              const refSeed = [window.location.href, tagName, inputType || "", name, selectorPreview(field)].join("|");
              return {
                targetRef: "field:" + hashStableString(refSeed),
                tagName,
                inputType,
                dirty,
                sensitive,
                valueLength: sensitive ? undefined : String(value || "").length
              };
            });
            return {
              redacted: true,
              fieldCount: fields.length,
              editedFieldCount: mapped.filter((field) => field.dirty).length,
              passwordFieldCount: mapped.filter((field) => field.inputType === "password").length,
              sensitiveFieldCount: mapped.filter((field) => field.sensitive).length,
              fields: mapped.filter((field) => field.dirty || field.sensitive).slice(0, 80)
            };
          };
          const bodyText = normalizeText(document.body?.innerText ?? document.body?.textContent ?? "", 12000);
          return {
            scrollX: Math.max(0, Math.round(window.scrollX || document.documentElement.scrollLeft || 0)),
            scrollY: Math.max(0, Math.round(window.scrollY || document.documentElement.scrollTop || 0)),
            viewport: {
              width: Math.max(0, Math.round(window.innerWidth || document.documentElement.clientWidth || 0)),
              height: Math.max(0, Math.round(window.innerHeight || document.documentElement.clientHeight || 0)),
              deviceScaleFactor: Number(window.devicePixelRatio || 1)
            },
            activeElement: activeElementSnapshot(),
            formDraft: formDraftMetadata(),
            textHash: hashStableString(bodyText),
            capturedAt: Date.now()
          };
        })()
      `, true) as Record<string, unknown>;
      const storage = await readPageStorageAvailability(entry);
      const restoreState = sanitizeBrowserPageRestoreState({
        ...pageState,
        history: navigationHistorySnapshot(entry),
        loadState: entry.runtime.isLoading ? "loading" : "idle",
        ...(entry.runtime.restoreState?.targetRegistry === undefined
          ? {}
          : { targetRegistry: entry.runtime.restoreState.targetRegistry }),
        ...(storage === undefined ? {} : { storage })
      });
      if (restoreState === undefined) {
        return entry.runtime.restoreState;
      }
      browserSessionSnapshots.set(entry.tabId, restoreState);
      updateRuntimeState(entry, { restoreState });
      scheduleBrowserSessionSnapshotWrite();
      return restoreState;
    } catch (_error) {
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
        `
          (() => {
            window.scrollTo(${Math.max(0, Math.round(scrollX))}, ${Math.max(0, Math.round(scrollY))});
            const selector = ${JSON.stringify(restoreState.activeElement?.cssSelector ?? "")};
            if (selector.length > 0) {
              try {
                const element = document.querySelector(selector);
                if (element instanceof HTMLElement || element instanceof SVGElement) {
                  element.focus?.({ preventScroll: true });
                }
              } catch (_error) {
                return false;
              }
            }
            return true;
          })()
        `,
        true
      );
    } catch {
      // Best-effort restoration should not block tab materialization.
    }
  };

  const currentHistoryUrl = (
    restoreState: WorkbenchBrowserPageRuntimeState["restoreState"] | undefined
  ): string | null => {
    const history = restoreState?.history;
    if (history === undefined || history.entries.length === 0) {
      return null;
    }
    const index = Math.max(0, Math.min(history.entries.length - 1, history.currentIndex));
    return normalizeAddress(history.entries[index]?.url) ?? null;
  };

  const validateDormantRestore = (
    entry: BrowserPageEntry,
    expected: WorkbenchBrowserPageRuntimeState["restoreState"] | undefined,
    actual: WorkbenchBrowserPageRuntimeState["restoreState"] | undefined
  ): void => {
    if (expected === undefined || actual === undefined) {
      return;
    }
    const mismatches: string[] = [];
    const expectedUrl = currentHistoryUrl(expected) ?? normalizeAddress(entry.requestedAddress);
    const actualUrl = currentHistoryUrl(actual) ?? normalizeAddress(entry.runtime.address);
    if (expectedUrl !== null && actualUrl !== null && expectedUrl !== actualUrl) {
      mismatches.push(`url expected ${expectedUrl} got ${actualUrl}`);
    }
    if (
      expected.textHash !== undefined &&
      actual.textHash !== undefined &&
      expected.textHash !== actual.textHash
    ) {
      mismatches.push("text hash changed");
    }
    const expectedScrollX = Number(expected.scrollX);
    const actualScrollX = Number(actual.scrollX);
    if (
      Number.isFinite(expectedScrollX) &&
      Number.isFinite(actualScrollX) &&
      Math.abs(expectedScrollX - actualScrollX) > 16
    ) {
      mismatches.push(`scrollX expected ${expectedScrollX} got ${actualScrollX}`);
    }
    const expectedScrollY = Number(expected.scrollY);
    const actualScrollY = Number(actual.scrollY);
    if (
      Number.isFinite(expectedScrollY) &&
      Number.isFinite(actualScrollY) &&
      Math.abs(expectedScrollY - actualScrollY) > 16
    ) {
      mismatches.push(`scrollY expected ${expectedScrollY} got ${actualScrollY}`);
    }
    const expectedHistoryLength = expected.history?.entries.length;
    const actualHistoryLength = actual.history?.entries.length;
    if (
      expectedHistoryLength !== undefined &&
      actualHistoryLength !== undefined &&
      expectedHistoryLength !== actualHistoryLength
    ) {
      mismatches.push(`history length expected ${expectedHistoryLength} got ${actualHistoryLength}`);
    }
    if (mismatches.length === 0) {
      return;
    }
    updateRuntimeState(entry, {
      recoveryFailure: {
        reason: "target_stale",
        message: `Dormant browser restore validation failed: ${mismatches.join("; ")}`,
        at: Date.now()
      }
    });
  };

  const restoreNavigationHistory = async (
    entry: BrowserPageEntry,
    restoreState: WorkbenchBrowserPageRuntimeState["restoreState"] | undefined
  ): Promise<boolean> => {
    if (
      entry.historyRestoreAttempted ||
      restoreState?.history === undefined ||
      restoreState.history.entries.length === 0 ||
      entry.webContents.isDestroyed()
    ) {
      return false;
    }
    entry.historyRestoreAttempted = true;
    const entries = restoreState.history.entries
      .map((historyEntry) => ({
        url: historyEntry.url,
        title: historyEntry.title
      }))
      .filter((historyEntry) => normalizeAddress(historyEntry.url) !== null);
    if (entries.length === 0) {
      return false;
    }
    const index = Math.max(0, Math.min(entries.length - 1, restoreState.history.currentIndex));
    try {
      updateRuntimeState(entry, { isLoading: true, lifecycleState: "restoring" });
      await entry.webContents.navigationHistory.restore({ entries, index });
      return true;
    } catch (error) {
      const recoveryFailure: WorkbenchBrowserRecoveryFailure = {
        reason: "navigation_failed",
        message: error instanceof Error ? error.message : String(error),
        at: Date.now()
      };
      updateRuntimeState(entry, {
        recoveryFailure,
        isLoading: false
      });
      return false;
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
      || debuggerSessions.get(entry.tabId)?.hasActiveClients() === true
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
    if (
      entry.isDestroyed ||
      entry.runtime.isVisible ||
      entry.runtime.isActive ||
      hasActiveLiveAgentBrowserTask(entry.tabId)
    ) {
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
    scheduleBrowserSessionSnapshotWrite(0);
    destroyEntry(entry, false);
    entries.delete(entry.tabId);
    publishRuntimeState(runtime);
  };

  const scheduleTombstone = (entry: BrowserPageEntry): void => {
    if (
      entry.runtime.isActive
      || entry.runtime.isVisible
      || entry.runtime.isTombstoned === true
      || hasActiveLiveAgentBrowserTask(entry.tabId)
      || tombstoneTimers.has(entry.tabId)
    ) {
      return;
    }
    disposeCdpAuditSession(entry.tabId, "live");
    const timer = setTimeout(() => {
      tombstoneTimers.delete(entry.tabId);
      if (hasActiveLiveAgentBrowserTask(entry.tabId)) {
        return;
      }
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

  let chromePopoverRuntime: ReturnType<typeof createChromePopoverRuntime>;
  const hideChromePopover = (entry: BrowserPageEntry): void => {
    chromePopoverRuntime.hideChromePopover(entry);
  };
  const hideTransientChromePopover = (entry: BrowserPageEntry): void => {
    chromePopoverRuntime.hideTransientChromePopover(entry);
  };
  const setChromePopover = async (request: WorkbenchBrowserChromePopoverRequest): Promise<void> => {
    await chromePopoverRuntime.setChromePopover(request);
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
        disposeCdpAuditSession(entry.tabId, "live");
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
      startCdpAuditSessionForEntry(entry);
    }
    chromePopoverRuntime.reattachVisiblePopover();
  };

  const destroyEntry = (entry: BrowserPageEntry, emitClosedEvent: boolean): void => {
    if (entry.isDestroyed) {
      return;
    }
    cancelTombstoneTimer(entry.tabId);
    entry.isDestroyed = true;
    destroyBrowserAgentShadow(entry.tabId);
    hideChromePopover(entry);
    disposeCdpAuditSession(entry.tabId, "live");
    disposeCdpAuditSession(entry.tabId, "isolated");
    disposeDebuggerSession(entry.tabId, "live");
    disposeDebuggerSession(entry.tabId, "isolated");
    invalidateBrowserAgentTargets(entry.tabId, "live", "navigation");
    invalidateBrowserAgentTargets(entry.tabId, "isolated", "navigation");
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
      performanceScheduler?.unregisterResource(`browserPage:${entry.tabId}`);
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
    void restoreNavigationHistory(entry, entry.runtime.restoreState)
      .then((restored) => {
        if (restored) {
          return;
        }
        void entry.webContents.loadURL(target).catch((error: unknown) => {
          const recoveryFailure: WorkbenchBrowserRecoveryFailure = {
            reason: "navigation_failed",
            message: error instanceof Error ? error.message : String(error),
            at: Date.now()
          };
          console.error(`[lyra-browser] loadURL failed tab=${entry.tabId} url=${target} error=${String(error)}`);
          updateRuntimeState(entry, {
            isLoading: false,
            recoveryFailure
          });
        });
      });
  };

  const openDebuggerSessionForTarget = async (
    target: BrowserAgentPageTarget
  ): Promise<WorkbenchBrowserDebuggerSession> => {
    const key = debuggerSessionKey(target.tabId, target.targetMode);
    const existing = debuggerSessions.get(key);
    if (existing !== undefined) {
      return await existing.acquire();
    }
    const created = createWorkbenchBrowserSharedDebuggerSession({
      tabId: target.tabId,
      webContents: target.webContents,
      readPageAddress: () =>
        normalizeAddress(target.webContents.getURL())
        ?? target.liveEntry?.runtime.address
        ?? target.address,
    });
    debuggerSessions.set(key, created);
    return await created.acquire();
  };

  const ensureCdpAuditSessionForTarget = (
    target: BrowserAgentPageTarget
  ): CdpAuditSession => {
    const key = debuggerSessionKey(target.tabId, target.targetMode);
    const existing = cdpAuditSessions.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const created = createCdpAuditSession({
      tabId: target.tabId,
      targetMode: target.targetMode,
      acquireDebugger: async () => await openDebuggerSessionForTarget(target),
      onDiagnostic: (diagnostic) => {
        appendPageDiagnostic(target.tabId, diagnostic);
      },
      maxBufferedEntries: MAX_BROWSER_PAGE_DIAGNOSTICS
    });
    cdpAuditSessions.set(key, created);
    return created;
  };

  const startCdpAuditSessionForEntry = (entry: BrowserPageEntry): void => {
    if (entry.isDestroyed || entry.webContents.isDestroyed()) {
      return;
    }
    const session = ensureCdpAuditSessionForTarget(liveAgentTarget(entry));
    void session.start().catch((error: unknown) => {
      recordPageDiagnostic(entry.tabId, {
        source: "runtime",
        severity: "warning",
        message: `CDP diagnostics unavailable: ${String(error instanceof Error ? error.message : error)}`
      });
    });
  };

  const disposeCdpAuditSession = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): void => {
    const key = debuggerSessionKey(tabId, targetMode);
    const session = cdpAuditSessions.get(key);
    if (session !== undefined) {
      cdpAuditSessions.delete(key);
      void session.dispose().catch(() => undefined);
    }
  };

  const disposeDebuggerSession = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): void => {
    const key = debuggerSessionKey(tabId, targetMode);
    void debuggerSessions.get(key)?.dispose().catch(() => undefined);
    debuggerSessions.delete(key);
  };

  const diagnosticsForTab = (tabId: string): WorkbenchBrowserPageDiagnosticEntry[] => {
    const existing = pageDiagnostics.get(tabId);
    if (existing !== undefined) {
      return existing;
    }
    const created: WorkbenchBrowserPageDiagnosticEntry[] = [];
    pageDiagnostics.set(tabId, created);
    return created;
  };

  const appendPageDiagnostic = (
    tabId: string,
    entry: WorkbenchBrowserPageDiagnosticEntry
  ): void => {
    const diagnostics = diagnosticsForTab(tabId);
    const existingIndex = diagnostics.findIndex((item) => item.id === entry.id);
    if (existingIndex >= 0) {
      diagnostics[existingIndex] = entry;
    } else {
      diagnostics.push(entry);
    }
    if (diagnostics.length > MAX_BROWSER_PAGE_DIAGNOSTICS) {
      diagnostics.splice(0, diagnostics.length - MAX_BROWSER_PAGE_DIAGNOSTICS);
    }
  };

  const recordPageDiagnostic = (
    tabId: string,
    entry: Omit<WorkbenchBrowserPageDiagnosticEntry, "id" | "at">
  ): void => {
    const at = Date.now();
    appendPageDiagnostic(tabId, {
      id: `diag-${tabId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at,
      timestamp: new Date(at).toISOString(),
      ...entry
    });
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
      turnId: null,
      tabId,
      targetMode,
      startedAt: Date.now(),
      endedAt: null,
      updatedAt: Date.now(),
      status: "running",
      reason: null,
      totalActions: 0,
      interruptedCount: 0,
      actions: [],
      frames: []
    };
    followSessions.set(key, created);
    return created;
  };

  const sharedControlForTab = (
    tabId: string,
    sessionId: string
  ): SharedControlSnapshot => {
    const existing = sharedControlStates.get(tabId);
    if (existing !== undefined) {
      if (existing.sessionId === sessionId) {
        return existing;
      }
      const retargeted = { ...existing, sessionId };
      sharedControlStates.set(tabId, retargeted);
      return retargeted;
    }
    const created = createIdleSharedControlSnapshot(tabId, sessionId);
    sharedControlStates.set(tabId, created);
    return created;
  };

  const publishSharedControlStateTransition = (
    transition: {
      readonly snapshot: SharedControlSnapshot;
      readonly previousState: SharedControlSnapshot["state"];
      readonly changed: boolean;
    },
    reason: WorkbenchBrowserSharedControlStateEvent["reason"]
  ): void => {
    if (!transition.changed) {
      return;
    }
    publishEvent({
      kind: "browser-shared-control-state",
      tabId: transition.snapshot.tabId,
      targetMode: "live",
      sessionId: transition.snapshot.sessionId,
      state: transition.snapshot.state,
      previousState: transition.previousState,
      at: transition.snapshot.updatedAt,
      ...(transition.snapshot.action === undefined ? {} : { action: transition.snapshot.action }),
      ...(transition.snapshot.interaction === undefined
        ? {}
        : { interaction: transition.snapshot.interaction }),
      criticalInput: transition.snapshot.criticalInput,
      reason
    });
  };

  const applySharedControlTransition = (
    transition: {
      readonly snapshot: SharedControlSnapshot;
      readonly previousState: SharedControlSnapshot["state"];
      readonly changed: boolean;
    },
    reason: WorkbenchBrowserSharedControlStateEvent["reason"]
  ): SharedControlSnapshot => {
    sharedControlStates.set(transition.snapshot.tabId, transition.snapshot);
    publishSharedControlStateTransition(transition, reason);
    return transition.snapshot;
  };

  const scheduleSharedControlIdle = (tabId: string, durationMs: number): void => {
    const existing = sharedControlTimers.get(tabId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      sharedControlTimers.delete(tabId);
      const current = sharedControlStates.get(tabId);
      if (current === undefined || isSharedControlPaused(current)) {
        return;
      }
      applySharedControlTransition(transitionSharedControlToIdle(current), "timer");
    }, Math.max(600, Math.min(8_000, durationMs)));
    sharedControlTimers.set(tabId, timer);
  };

  const latestFollowAction = (
    session: BrowserAgentFollowSession
  ): BrowserAgentFollowSession["actions"][number] | null =>
    session.actions.length === 0 ? null : session.actions[session.actions.length - 1] ?? null;

  const summarizeFollowAction = (
    action: BrowserAgentCursorOverlayAction,
    request: {
      readonly interaction?: WorkbenchBrowserAgentInteraction;
      readonly cursorPhase?: BrowserAgentCursorOverlayPhase;
      readonly inputActive: boolean;
      readonly result?: "success" | "failure" | "interrupted";
    }
  ): string => {
    const result = request.result === undefined || request.result === "success"
      ? ""
      : ` ${request.result}`;
    if (action === "act") {
      return `${request.interaction ?? "click"}${request.cursorPhase === undefined ? "" : `:${request.cursorPhase}`}${result}`;
    }
    if (action === "type") {
      return `type${request.inputActive ? ":input" : ""}${result}`;
    }
    if (action === "press") {
      return `press${request.inputActive ? ":key" : ""}${result}`;
    }
    return `${action}${result}`;
  };

  const followFrameEvent = (
    action: BrowserAgentCursorOverlayAction,
    result?: "success" | "failure" | "interrupted"
  ): "cursor" | "input" | "wait" | "navigation" | "interrupt" => {
    if (result === "interrupted") return "interrupt";
    if (action === "wait" || action === "read" || action === "observe" || action === "capture") return "wait";
    if (action === "navigate") return "navigation";
    if (action === "act") return "cursor";
    return "input";
  };

  const recordFollowAction = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    action: BrowserAgentCursorOverlayAction,
    request: {
      readonly visibleFollow?: boolean;
      readonly interaction?: WorkbenchBrowserAgentInteraction;
      readonly cursorPhase?: BrowserAgentCursorOverlayPhase;
      readonly inputActive: boolean;
      readonly cursor?: { readonly x: number; readonly y: number };
      readonly result?: "success" | "failure" | "interrupted";
      readonly sharedControlState?: SharedControlSnapshot["state"];
      readonly criticalInput?: boolean;
      readonly redacted?: boolean;
    }
  ): BrowserAgentFollowSession | null => {
    if (request.visibleFollow !== true) {
      return null;
    }
    const existing = followSessions.get(followSessionKey(tabId, targetMode));
    const session = existing ?? ensureFollowSession(tabId, targetMode);
    const at = Date.now();
    session.updatedAt = at;
    session.totalActions += 1;
    if (request.result === "failure") {
      session.status = "failed";
      session.reason = "browser operation failed";
    } else if (request.result === "interrupted") {
      session.status = "interrupted";
      session.reason = "user input interrupted browser follow";
    } else if (session.status !== "interrupted" && session.status !== "failed") {
      session.status = "running";
      session.reason = null;
    }
    const actionId = `follow-action-${session.totalActions}`;
    session.actions.push({
      id: actionId,
      at,
      tabId,
      targetMode,
      action,
      ...(request.interaction === undefined ? {} : { interaction: request.interaction }),
      ...(request.cursorPhase === undefined ? {} : { cursorPhase: request.cursorPhase }),
      inputActive: request.inputActive,
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      ...(request.result === undefined ? {} : { result: request.result }),
      summary: summarizeFollowAction(action, request),
      ...(request.sharedControlState === undefined
        ? {}
        : { sharedControlState: request.sharedControlState }),
      ...(request.criticalInput === undefined ? {} : { criticalInput: request.criticalInput }),
      ...(request.redacted === undefined ? {} : { redacted: request.redacted })
    });
    session.frames.push({
      id: `follow-frame-${session.totalActions}`,
      at,
      actionId,
      tabId,
      targetMode,
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      ...(request.cursorPhase === undefined ? {} : { cursorPhase: request.cursorPhase }),
      event: followFrameEvent(action, request.result)
    });
    if (session.actions.length > MAX_BROWSER_AGENT_FOLLOW_ACTIONS) {
      session.actions.splice(0, session.actions.length - MAX_BROWSER_AGENT_FOLLOW_ACTIONS);
    }
    if (session.frames.length > MAX_BROWSER_AGENT_FOLLOW_FRAMES) {
      session.frames.splice(0, session.frames.length - MAX_BROWSER_AGENT_FOLLOW_FRAMES);
    }
    return session;
  };

  const markSyntheticInput = (tabId: string): void => {
    agentSyntheticInputUntil.set(tabId, Date.now() + 350);
  };

  const isSyntheticInput = (tabId: string): boolean =>
    (agentSyntheticInputUntil.get(tabId) ?? 0) >= Date.now();

  const buildSharedControlHandoff = (
    tabId: string,
    session: BrowserAgentFollowSession,
    snapshot: SharedControlSnapshot,
    inputType: SharedControlInputType,
    physicalInputPrevented: boolean,
    at = Date.now()
  ): WorkbenchBrowserSharedControlEvent => {
    const lastAction = latestFollowAction(session);
    return {
      kind: "browser-shared-control-interrupted",
      tabId,
      targetMode: "live",
      sessionId: session.sessionId,
      inputType,
      at,
      ...(lastAction?.action === undefined ? {} : { action: lastAction.action }),
      ...(lastAction?.interaction === undefined ? {} : { interaction: lastAction.interaction }),
      ...(lastAction?.id === undefined ? {} : { followActionId: lastAction.id }),
      criticalInput: snapshot.criticalInput,
      physicalInputPrevented,
      sharedControlState:
        snapshot.state === "awaiting_user_decision"
          ? "awaiting_user_decision"
          : "user_interrupted",
      browserRecoveryAnchor: {
        tabId,
        targetMode: "live",
        ...(lastAction?.id === undefined ? {} : { followActionId: lastAction.id })
      }
    };
  };

  const assertSharedControlCanContinue = (tabId: string): void => {
    const snapshot = sharedControlStates.get(tabId);
    if (snapshot === undefined || !isSharedControlPaused(snapshot)) {
      return;
    }
    const session = followSessions.get(followSessionKey(tabId, "live"))
      ?? ensureFollowSession(tabId, "live");
    const handoff =
      lastControlHandoffByTabId.get(tabId)
      ?? buildSharedControlHandoff(
        tabId,
        session,
        snapshot,
        snapshot.inputType ?? "keyboard",
        snapshot.criticalInput
      );
    throw new SharedControlInterruptionError(handoff);
  };

  const handleSharedControlInput = (
    tabId: string,
    inputType: SharedControlInputType,
    event?: { readonly preventDefault?: () => void }
  ): void => {
    const session = followSessions.get(followSessionKey(tabId, "live"));
    if (session === undefined || session.status !== "running") {
      return;
    }
    const current = sharedControlForTab(tabId, session.sessionId);
    const transition = transitionSharedControlForUserInput(current, {
      inputType,
      synthetic: isSyntheticInput(tabId)
    });
    if (!transition.interrupted) {
      return;
    }
    if (transition.preventPhysicalInput) {
      event?.preventDefault?.();
    }
    session.interruptedCount += 1;
    session.updatedAt = Date.now();
    session.status = "interrupted";
    session.reason = "user input interrupted browser follow";
    recordFollowAction(tabId, "live", inputType === "keyboard" ? "press" : "act", {
      visibleFollow: true,
      inputActive: true,
      result: "interrupted",
      sharedControlState: "user_interrupted",
      criticalInput: transition.snapshot.criticalInput,
      redacted: inputType === "keyboard"
    });
    const interruptedSnapshot = applySharedControlTransition(transition, "user_input");
    const handoff = buildSharedControlHandoff(
      tabId,
      session,
      interruptedSnapshot,
      inputType,
      transition.preventPhysicalInput,
      interruptedSnapshot.interruptedAt ?? Date.now()
    );
    lastControlHandoffByTabId.set(tabId, handoff);
    publishEvent(handoff);
    const awaiting = transitionSharedControlToAwaitingDecision(interruptedSnapshot);
    const awaitingSnapshot = applySharedControlTransition(awaiting, "awaiting_decision");
    if (awaiting.changed) {
      lastControlHandoffByTabId.set(tabId, {
        ...handoff,
        sharedControlState: "awaiting_user_decision",
        at: awaitingSnapshot.updatedAt
      });
    }
  };

  const sendAgentInputEvent = (
    target: BrowserAgentPageTarget,
    event: Parameters<WebContents["sendInputEvent"]>[0]
  ): void => {
    if (target.targetMode === "live") {
      assertSharedControlCanContinue(target.tabId);
    }
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
    visibleFollow = false,
    durationMs = inputActive ? 1_800 : 1_250,
    cursor
  }: {
    readonly tabId: string;
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly action: BrowserAgentCursorOverlayAction;
    readonly interaction?: WorkbenchBrowserAgentInteraction;
    readonly cursorPhase?: BrowserAgentCursorOverlayPhase;
    readonly inputActive?: boolean;
    readonly visibleFollow?: boolean;
    readonly durationMs?: number;
    readonly cursor?: { readonly x: number; readonly y: number };
  }): void => {
    const criticalInput = isCriticalBrowserAgentAction(action, interaction);
    let sharedControlState: SharedControlSnapshot["state"] | undefined;
    if (targetMode === "live" && visibleFollow) {
      const session = ensureFollowSession(tabId, targetMode);
      const current = sharedControlForTab(tabId, session.sessionId);
      const transition = transitionSharedControlForAgentAction(current, {
        action,
        ...(interaction === undefined ? {} : { interaction }),
        criticalInput
      });
      if (transition.blocked) {
        assertSharedControlCanContinue(tabId);
      }
      sharedControlState = applySharedControlTransition(transition, "agent_action").state;
      scheduleSharedControlIdle(tabId, durationMs);
    }
    const followSession = recordFollowAction(tabId, targetMode, action, {
      visibleFollow,
      ...(interaction === undefined ? {} : { interaction }),
      cursorPhase,
      inputActive,
      ...(cursor === undefined ? {} : { cursor }),
      ...(sharedControlState === undefined ? {} : { sharedControlState }),
      criticalInput,
      redacted: action === "type" || action === "press"
    });
    if (followSession === null) {
      return;
    }
    const followAction = followSession.actions[followSession.actions.length - 1];
    if (inputActive && targetMode === "live" && visibleFollow) {
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
      visibleFollow,
      sessionId: followSession.sessionId,
      actionId: followAction?.id ?? "follow-action-unknown",
      cursorPhase,
      inputActive,
      durationMs,
      ...(sharedControlState === undefined ? {} : { sharedControlState }),
      criticalInput,
      redacted: action === "type" || action === "press",
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
      visibleFollow: target.browserMode.visibleFollow,
      cursor,
      durationMs: interaction === "hover" ? 2_400 : 2_800
    });
    await delay(20);

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
        visibleFollow: target.browserMode.visibleFollow,
        cursor,
        durationMs: 2_400
      });
      await delay(40);
      return;
    }

    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "act",
      interaction,
      cursorPhase: "down",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      cursor,
      durationMs: 2_400
    });
    sendAgentInputEvent(target, { type: "mouseDown", x, y, button, clickCount });
    await delay(20);

    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "act",
      interaction,
      cursorPhase: "up",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      cursor,
      durationMs: 2_400
    });
    sendAgentInputEvent(target, { type: "mouseUp", x, y, button, clickCount });
    await delay(30);

    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "act",
      interaction,
      cursorPhase: "idle",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
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
    disposeCdpAuditSession(tabId, "isolated");
    disposeDebuggerSession(tabId, "isolated");
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
        partition: WORKBENCH_BROWSER_ISOLATED_PROFILE_PARTITION,
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
      browserMode: defaultBrowserMode("isolated"),
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
      invalidateBrowserAgentTargets(shadow.tabId, shadow.targetMode, "navigation");
    });
    webContents.on("did-navigate-in-page", (_event, url) => {
      shadow.address = normalizeAddress(url) ?? shadow.address;
      invalidateBrowserAgentTargets(shadow.tabId, shadow.targetMode, "navigation");
    });
    webContents.on("did-frame-navigate", (_event, _url, _code, _status, isMainFrame) => {
      if (!isMainFrame) {
        invalidateBrowserAgentTargets(shadow.tabId, shadow.targetMode, "frameReload");
      }
    });
    webContents.on("frame-created", () => {
      invalidateBrowserAgentTargets(shadow.tabId, shadow.targetMode, "frameReload");
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
        partition: WORKBENCH_BROWSER_ISOLATED_PROFILE_PARTITION,
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
      browserMode: defaultBrowserMode("isolated"),
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
      invalidateBrowserAgentTargets(shadow.tabId, shadow.targetMode, "navigation");
    });
    webContents.on("did-navigate-in-page", (_event, url) => {
      shadow.address = normalizeAddress(url) ?? shadow.address;
      invalidateBrowserAgentTargets(shadow.tabId, shadow.targetMode, "navigation");
    });
    webContents.on("did-frame-navigate", (_event, _url, _code, _status, isMainFrame) => {
      if (!isMainFrame) {
        invalidateBrowserAgentTargets(shadow.tabId, shadow.targetMode, "frameReload");
      }
    });
    webContents.on("frame-created", () => {
      invalidateBrowserAgentTargets(shadow.tabId, shadow.targetMode, "frameReload");
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

  const readLiveLocalStorageEntries = async (
    source: BrowserPageEntry,
    origin: string,
    timeoutMs: number | undefined
  ): Promise<readonly [string, string][]> => {
    if (normalizeWebOrigin(source.webContents.getURL()) !== origin) {
      return [];
    }
    try {
      const entries = await runFrameScriptWithTimeout(
        () => source.webContents.executeJavaScript(`
          (() => {
            try {
              return Object.entries(window.localStorage || {})
                .slice(0, 500)
                .map(([key, value]) => [String(key), String(value)]);
            } catch (_error) {
              return [];
            }
          })()
        `, true),
        normalizeExecuteScriptTimeoutMs(timeoutMs, 2_000)
      );
      return Array.isArray(entries)
        ? entries
            .map((entry) => {
              if (!Array.isArray(entry) || entry.length < 2) {
                return null;
              }
              const [key, value] = entry;
              return typeof key === "string" && typeof value === "string"
                ? [key, value] as [string, string]
                : null;
            })
            .filter((entry): entry is [string, string] => entry !== null)
        : [];
    } catch {
      return [];
    }
  };

  const writeIsolatedLocalStorageEntries = async (
    shadow: BrowserAgentShadowEntry,
    origin: string,
    entries: readonly [string, string][],
    timeoutMs: number | undefined
  ): Promise<number> => {
    if (entries.length === 0 || normalizeWebOrigin(shadow.webContents.getURL()) !== origin) {
      return 0;
    }
    try {
      const written = await runFrameScriptWithTimeout(
        () => shadow.webContents.executeJavaScript(`
          ((entries) => {
            let written = 0;
            try {
              for (const [key, value] of entries) {
                window.localStorage.setItem(String(key), String(value));
                written += 1;
              }
            } catch (_error) {
              return written;
            }
            return written;
          })(${JSON.stringify(entries)})
        `, true),
        normalizeExecuteScriptTimeoutMs(timeoutMs, 2_000)
      );
      return typeof written === "number" && Number.isFinite(written)
        ? Math.max(0, Math.round(written))
        : 0;
    } catch {
      return 0;
    }
  };

  const copyLiveLoginStateToIsolated = async (
    source: BrowserPageEntry | undefined,
    shadow: BrowserAgentShadowEntry,
    timeoutMs: number | undefined
  ): Promise<BrowserAgentLoginBorrowResult> => {
    if (source === undefined || source.isDestroyed || source.webContents.isDestroyed()) {
      return {
        borrowed: false,
        coverage: [],
        unavailableReason: "live_source_tab_unavailable"
      };
    }
    const sourceOrigin =
      normalizeWebOrigin(source.webContents.getURL()) ?? normalizeWebOrigin(source.runtime.address);
    if (sourceOrigin === null) {
      return {
        borrowed: false,
        coverage: [],
        unavailableReason: "live_source_origin_unavailable"
      };
    }
    const liveSession = source.webContents.session ?? liveElectronSession();
    const isolatedSession = isolatedElectronSession();
    const cookies = await liveSession.cookies.get({ url: sourceOrigin }).catch(() => []);
    let copiedCookies = 0;
    for (const cookie of cookies) {
      const details: Parameters<Session["cookies"]["set"]>[0] = {
        url: sourceOrigin,
        name: cookie.name,
        value: cookie.value
      };
      if (cookie.domain !== undefined && cookie.domain.length > 0) details.domain = cookie.domain;
      if (cookie.path !== undefined && cookie.path.length > 0) details.path = cookie.path;
      if (cookie.secure !== undefined) details.secure = cookie.secure;
      if (cookie.httpOnly !== undefined) details.httpOnly = cookie.httpOnly;
      if (cookie.expirationDate !== undefined) details.expirationDate = cookie.expirationDate;
      if (cookie.sameSite !== undefined && cookie.sameSite !== "unspecified") {
        details.sameSite = cookie.sameSite;
      }
      await isolatedSession.cookies.set(details)
        .then(() => {
          copiedCookies += 1;
        })
        .catch(() => undefined);
    }
    const localStorageEntries = await readLiveLocalStorageEntries(source, sourceOrigin, timeoutMs);
    const copiedLocalStorage = await writeIsolatedLocalStorageEntries(
      shadow,
      sourceOrigin,
      localStorageEntries,
      timeoutMs
    );
    const coverage: ("cookies" | "localStorage")[] = [];
    if (copiedCookies > 0) coverage.push("cookies");
    if (copiedLocalStorage > 0) coverage.push("localStorage");
    return {
      borrowed: coverage.length > 0,
      sourceOrigin,
      cookieCount: copiedCookies,
      localStorageItemCount: copiedLocalStorage,
      coverage,
      ...(coverage.length === 0 ? { unavailableReason: "no_live_login_state_found" } : {})
    };
  };

  const resolveBrowserAgentTarget = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest | WorkbenchBrowserAgentTargetMode | undefined,
    timeoutMs: number | undefined
  ): Promise<BrowserAgentPageTarget> => {
    const modeRequest = normalizeBrowserAgentModeRequest(request);
    const requestedTargetMode = modeRequest.targetMode;
    const visibleFollow = modeRequest.visibleFollow === true;
    if (requestedTargetMode === "live") {
      return liveAgentTarget(
        requireEntry(tabId),
        defaultBrowserMode("live", "explicit_live", visibleFollow)
      );
    }
    const entry = entries.get(tabId);
    if (requestedTargetMode === undefined && entry !== undefined && entry.isDestroyed === false) {
      return liveAgentTarget(
        entry,
        defaultBrowserMode("live", "default_current_visible_browser", visibleFollow)
      );
    }
    let loginBorrow: BrowserAgentLoginBorrowResult | undefined;
    const reason: WorkbenchBrowserAgentModeReason = requestedTargetMode === "isolated"
      ? "explicit_isolated"
      : "explicit_isolated";
    let target: BrowserAgentShadowEntry;
    if (entry !== undefined && entry.isDestroyed === false) {
      target = await ensureBrowserAgentShadow(entry, timeoutMs);
      if (wantsLiveLoginState(modeRequest)) {
        loginBorrow = await copyLiveLoginStateToIsolated(entry, target, timeoutMs);
      }
    } else {
      target = browserAgentShadows.get(tabId)
        ?? createStandaloneBrowserAgentShadow(tabId || WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID);
      if (wantsLiveLoginState(modeRequest)) {
        loginBorrow = {
          borrowed: false,
          coverage: [],
          unavailableReason: "live_source_tab_unavailable"
        };
      }
    }
    target.browserMode = defaultBrowserMode("isolated", reason, false, loginBorrow);
    return target;
  };

  const createEntry = (
    spec: WorkbenchBrowserPageSpec,
    restoredRuntime?: WorkbenchBrowserPageRuntimeState
  ): BrowserPageEntry => {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        partition: WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION,
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
      historyRestoreAttempted: false,
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
        webContents.removeAllListeners("did-frame-navigate");
        webContents.removeAllListeners("frame-created");
        webContents.removeAllListeners("console-message");
        webContents.removeAllListeners("before-mouse-event");
        webContents.removeAllListeners("before-input-event");
        webContents.removeAllListeners("focus");
        webContents.removeAllListeners("enter-html-full-screen");
        webContents.removeAllListeners("leave-html-full-screen");
        webContents.removeAllListeners("render-process-gone");
      }
    };
    if (restoredRuntime?.restoreState !== undefined) {
      pendingRestoreValidations.set(spec.tabId, restoredRuntime.restoreState);
    }

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
      const restoreState =
        pendingRestoreValidations.get(entry.tabId)
        ?? browserSessionSnapshots.get(entry.tabId)
        ?? entry.runtime.restoreState;
      if (restoreState !== undefined) {
        void applyBrowserRestoreState(entry, restoreState)
          .then(() => captureBrowserRestoreState(entry))
          .then((nextRestoreState) => {
            if (nextRestoreState !== undefined) {
              const expectedRestoreState = pendingRestoreValidations.get(entry.tabId);
              pendingRestoreValidations.delete(entry.tabId);
              validateDormantRestore(entry, expectedRestoreState, nextRestoreState);
              scheduleBrowserTargetRegistryWarmup(entry, nextRestoreState);
            }
          });
      } else {
        void captureBrowserRestoreState(entry);
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
      updateRuntimeState(entry, {
        isLoading: false,
        recoveryFailure: {
          reason: "navigation_failed",
          message: `${errorDescription || "Page load failed"} (${errorCode})`,
          at: Date.now()
        }
      });
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
      invalidateBrowserAgentTargets(entry.tabId, "live", "navigation");
      userInputDirtyTabs.delete(entry.tabId);
      syncAddress(url);
      void captureBrowserRestoreState(entry);
    });

    webContents.on("did-navigate-in-page", (_event, url) => {
      hideChromePopover(entry);
      elementPickerController.handlePageNavigated(entry.tabId);
      invalidateBrowserAgentTargets(entry.tabId, "live", "navigation");
      syncAddress(url);
      void captureBrowserRestoreState(entry);
    });

    webContents.on("did-frame-navigate", (_event, _url, _code, _status, isMainFrame) => {
      if (isMainFrame) {
        return;
      }
      invalidateBrowserAgentTargets(entry.tabId, "live", "frameReload");
      void captureBrowserRestoreState(entry);
    });

    webContents.on("frame-created", () => {
      invalidateBrowserAgentTargets(entry.tabId, "live", "frameReload");
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
      const inputType: SharedControlInputType =
        mouse.type === "mouseMove"
          ? "mouse_move"
          : mouse.type === "mouseWheel" ? "wheel" : "mouse_down";
      handleSharedControlInput(entry.tabId, inputType, event);
      if (mouse.type === "mouseDown") {
        userInputDirtyTabs.add(entry.tabId);
        syncPerformanceRuntimeState(entry.runtime, entry);
        hideTransientChromePopover(entry);
      }
    });

    webContents.on("before-input-event", (event, input) => {
      if (
        input.type === "keyDown"
        && input.key.toLocaleLowerCase() === "f"
        && (input.control === true || input.meta === true)
        && input.alt !== true
      ) {
        event.preventDefault();
        publishEvent({
          kind: "request-page-find",
          tabId: entry.tabId
        });
        return;
      }
      userInputDirtyTabs.add(entry.tabId);
      syncPerformanceRuntimeState(entry.runtime, entry);
      handleSharedControlInput(entry.tabId, "keyboard", event);
    });

    webContents.on("focus", () => {
      hideTransientChromePopover(entry);
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
    syncPerformanceRuntimeState(entry.runtime, entry);
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
    const persisted = persistedTabSnapshot(spec.tabId);
    const persistedRuntime: WorkbenchBrowserPageRuntimeState | undefined =
      persisted === null
        ? undefined
        : {
            ...toInitialRuntimeState({
              ...spec,
              address: spec.address,
              titleHint: spec.titleHint ?? persisted.title,
              restoreState: spec.restoreState ?? persisted.restoreState
            }),
            address: spec.address,
            title: spec.titleHint ?? persisted.title,
            ...(persisted.faviconUrl === undefined ? {} : { faviconUrl: persisted.faviconUrl }),
            canGoBack: persisted.canGoBack,
            canGoForward: persisted.canGoForward,
            ...(persisted.recoveryFailure === undefined
              ? {}
              : { recoveryFailure: persisted.recoveryFailure })
          };
    const restoredRuntime = tombstone?.runtime ?? persistedRuntime;
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
      void captureBrowserRestoreState(entry).finally(() => {
        destroyEntry(entry, true);
        entries.delete(tabId);
        scheduleBrowserSessionSnapshotWrite();
      });
    }
    for (const tabId of tombstones.keys()) {
      if (nextTabIds.has(tabId)) {
        continue;
      }
      tombstones.delete(tabId);
      performanceScheduler?.unregisterResource(`browserPage:${tabId}`);
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

  const clearSearchInPageOverlay = async (
    target: Pick<BrowserPageFindTarget, "webContents">
  ): Promise<void> => {
    try {
      target.webContents.stopFindInPage("clearSelection");
    } catch {
      // The injected overlay below is the durable cleanup path.
    }
    await target.webContents.executeJavaScript(`
      (() => {
        const timers = window.__lyraPageFindTimers;
        if (Array.isArray(timers)) {
          for (const timer of timers) clearTimeout(timer);
        }
        window.__lyraPageFindTimers = [];
        document.getElementById("__lyra_page_find_overlay__")?.remove();
        return true;
      })()
    `, true).catch(() => undefined);
  };

  chromePopoverRuntime = createChromePopoverRuntime({
    overlayView,
    entries,
    publishEvent,
    webThemeInjector,
    findLayout,
    requireEntry,
    getActiveOrFocusedTabId,
    clearSearchInPageOverlay,
    openDebuggerSessionForTarget,
    liveAgentTarget
  });

  const revealSearchInPageMatch = async (
    target: Pick<BrowserPageFindTarget, "webContents">,
    query: string,
    activeIndex: number,
    caseSensitive: boolean
  ): Promise<BrowserPageFindRevealResult> => {
    const script = `
      (async () => {
        const QUERY = ${JSON.stringify(query)};
        const TARGET_INDEX = ${JSON.stringify(activeIndex)};
        const CASE_SENSITIVE = ${JSON.stringify(caseSensitive)};
        const clearOverlay = () => {
          const timers = window.__lyraPageFindTimers;
          if (Array.isArray(timers)) {
            for (const timer of timers) clearTimeout(timer);
          }
          window.__lyraPageFindTimers = [];
          document.getElementById("__lyra_page_find_overlay__")?.remove();
        };
        clearOverlay();
        if (!QUERY || TARGET_INDEX < 1 || !document.body) {
          return { ok: false };
        }
        const normalize = (value) => CASE_SENSITIVE ? value : String(value).toLocaleLowerCase();
        const needle = normalize(QUERY);
        const rejectedTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION"]);
        const acceptNode = (node) => {
          const parent = node.parentElement;
          if (!parent || rejectedTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.closest("#__lyra_page_find_overlay__")) return NodeFilter.FILTER_REJECT;
          if (!node.nodeValue || node.nodeValue.trim().length === 0) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        };
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode });
        let count = 0;
        let selected = null;
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const source = normalize(node.nodeValue || "");
          let cursor = 0;
          while (needle.length > 0 && cursor <= source.length) {
            const index = source.indexOf(needle, cursor);
            if (index < 0) break;
            count += 1;
            if (count === TARGET_INDEX) {
              selected = { node, start: index, end: index + QUERY.length };
              break;
            }
            cursor = Math.max(index + needle.length, index + 1);
          }
          if (selected) break;
        }
        if (!selected) return { ok: false, totalScanned: count };
        const range = document.createRange();
        range.setStart(selected.node, selected.start);
        range.setEnd(selected.node, selected.end);
        const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const fallbackElementRect = selected.node.parentElement?.getBoundingClientRect?.();
        const firstRect = typeof range.getBoundingClientRect === "function"
          ? range.getBoundingClientRect()
          : fallbackElementRect;
        if (!firstRect) return { ok: false, totalScanned: count };
        if (
          firstRect.top < 80 ||
          firstRect.bottom > window.innerHeight - 80 ||
          firstRect.left < 20 ||
          firstRect.right > window.innerWidth - 20
        ) {
          window.scrollBy({
            left: firstRect.left < 20 ? firstRect.left - 80 : firstRect.right > window.innerWidth - 20 ? firstRect.right - window.innerWidth + 80 : 0,
            top: firstRect.top - Math.max(90, window.innerHeight * 0.38),
            behavior: "smooth"
          });
          await waitFrame();
          await waitFrame();
        }
        const rects = (typeof range.getClientRects === "function"
          ? Array.from(range.getClientRects())
          : []
        )
          .filter((rect) => rect.width > 0 && rect.height > 0)
          .map((rect) => ({
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
          }));
        if (rects.length === 0 && fallbackElementRect && fallbackElementRect.width > 0 && fallbackElementRect.height > 0) {
          rects.push({
            left: fallbackElementRect.left,
            top: fallbackElementRect.top,
            right: fallbackElementRect.right,
            bottom: fallbackElementRect.bottom,
            width: fallbackElementRect.width,
            height: fallbackElementRect.height
          });
        }
        if (rects.length === 0) return { ok: false, totalScanned: count };
        const bounds = rects.reduce((acc, rect) => ({
          left: Math.min(acc.left, rect.left),
          top: Math.min(acc.top, rect.top),
          right: Math.max(acc.right, rect.right),
          bottom: Math.max(acc.bottom, rect.bottom)
        }), {
          left: rects[0].left,
          top: rects[0].top,
          right: rects[0].right,
          bottom: rects[0].bottom
        });
        const pad = 10;
        const focus = {
          left: Math.max(0, bounds.left - pad),
          top: Math.max(0, bounds.top - pad),
          right: Math.min(window.innerWidth, bounds.right + pad),
          bottom: Math.min(window.innerHeight, bounds.bottom + pad)
        };
        const host = document.createElement("div");
        host.id = "__lyra_page_find_overlay__";
        host.setAttribute("aria-hidden", "true");
        host.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;contain:layout style paint;";
        const style = document.createElement("style");
        style.textContent = \`
          #__lyra_page_find_overlay__ .lyra-find-blur {
            position: fixed;
            background: rgba(12, 12, 12, 0.16);
            backdrop-filter: blur(7px);
            -webkit-backdrop-filter: blur(7px);
            opacity: 0;
            transition: opacity 190ms cubic-bezier(0.16, 1, 0.3, 1);
          }
          #__lyra_page_find_overlay__ .lyra-find-highlight {
            position: fixed;
            border-radius: 3px;
            background: rgba(255, 214, 64, 0.58);
            box-shadow: 0 0 0 1px rgba(180, 125, 0, 0.36), 0 4px 18px rgba(255, 204, 51, 0.28);
            opacity: 1;
            transition: background 260ms ease, box-shadow 260ms ease, opacity 260ms ease;
            mix-blend-mode: multiply;
          }
        \`;
        host.appendChild(style);
        const panels = [
          { left: 0, top: 0, width: window.innerWidth, height: focus.top },
          { left: 0, top: focus.bottom, width: window.innerWidth, height: Math.max(0, window.innerHeight - focus.bottom) },
          { left: 0, top: focus.top, width: focus.left, height: Math.max(0, focus.bottom - focus.top) },
          { left: focus.right, top: focus.top, width: Math.max(0, window.innerWidth - focus.right), height: Math.max(0, focus.bottom - focus.top) }
        ];
        for (const panel of panels) {
          if (panel.width <= 0 || panel.height <= 0) continue;
          const node = document.createElement("div");
          node.className = "lyra-find-blur";
          node.style.left = panel.left + "px";
          node.style.top = panel.top + "px";
          node.style.width = panel.width + "px";
          node.style.height = panel.height + "px";
          host.appendChild(node);
        }
        for (const rect of rects) {
          const mark = document.createElement("div");
          mark.className = "lyra-find-highlight";
          mark.style.left = Math.max(0, rect.left - 2) + "px";
          mark.style.top = Math.max(0, rect.top - 1) + "px";
          mark.style.width = Math.max(1, rect.width + 4) + "px";
          mark.style.height = Math.max(1, rect.height + 2) + "px";
          host.appendChild(mark);
        }
        document.documentElement.appendChild(host);
        await waitFrame();
        for (const panel of host.querySelectorAll(".lyra-find-blur")) {
          panel.style.opacity = "1";
        }
        const timers = [];
        timers.push(setTimeout(() => {
          for (const panel of host.querySelectorAll(".lyra-find-blur")) {
            panel.style.opacity = "0";
          }
        }, 2000));
        timers.push(setTimeout(() => {
          for (const panel of host.querySelectorAll(".lyra-find-blur")) {
            panel.remove();
          }
          for (const mark of host.querySelectorAll(".lyra-find-highlight")) {
            mark.style.background = "rgba(255, 221, 74, 0.42)";
            mark.style.boxShadow = "0 0 0 1px rgba(170, 118, 0, 0.26)";
          }
        }, 2300));
        window.__lyraPageFindTimers = timers;
        return {
          ok: true,
          rect: {
            left: Math.round(bounds.left),
            top: Math.round(bounds.top),
            right: Math.round(bounds.right),
            bottom: Math.round(bounds.bottom)
          }
        };
      })()
    `;
    try {
      const result = await target.webContents.executeJavaScript(script, true) as Record<string, unknown>;
      const rect = result?.rect;
      if (result?.ok !== true || rect === null || typeof rect !== "object") {
        return { ok: false };
      }
      const record = rect as Record<string, unknown>;
      const left = Number(record.left);
      const top = Number(record.top);
      const right = Number(record.right);
      const bottom = Number(record.bottom);
      if ([left, top, right, bottom].every(Number.isFinite) === false) {
        return { ok: true };
      }
      return {
        ok: true,
        rect: {
          left: Math.round(left),
          top: Math.round(top),
          right: Math.round(right),
          bottom: Math.round(bottom)
        }
      };
    } catch {
      return { ok: false };
    }
  };

  const performSearchInPage = async (
    target: BrowserPageFindTarget,
    request: WorkbenchBrowserSearchInPageRequest
  ): Promise<WorkbenchBrowserSearchInPageResult & {
    readonly revealRect?: BrowserPageFindRevealResult["rect"];
  }> => {
    const query = typeof request.query === "string" ? request.query.trim() : "";
    if (query.length === 0) {
      await clearSearchInPageOverlay(target);
      return {
        tabId: target.tabId,
        address: normalizeAddress(target.webContents.getURL()) ?? target.address,
        title: target.title,
        query: "",
        currentIndex: 0,
        totalMatches: 0,
        matches: [],
        truncated: false
      };
    }
    try {
      target.webContents.findInPage(query, {
        forward: request.direction !== "previous",
        findNext: request.direction === "next" || request.direction === "previous",
        matchCase: request.caseSensitive === true
      });
    } catch {
      // Text extraction below is the authoritative result; native page highlight is best effort.
    }
    const raw = await target.webContents.executeJavaScript(`
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
    const totalMatches = result.totalMatches;
    const requestedIndex = Number.isFinite(Number(request.activeIndex))
      ? Math.round(Number(request.activeIndex))
      : 0;
    const normalizedRequestedIndex =
      totalMatches === 0 ? 0 : Math.max(1, Math.min(totalMatches, requestedIndex));
    const currentIndex = (() => {
      if (totalMatches === 0) {
        return 0;
      }
      if (request.direction === "previous") {
        return normalizedRequestedIndex <= 1 ? totalMatches : normalizedRequestedIndex - 1;
      }
      if (request.direction === "next") {
        return normalizedRequestedIndex <= 0 || normalizedRequestedIndex >= totalMatches
          ? 1
          : normalizedRequestedIndex + 1;
      }
      return normalizedRequestedIndex || 1;
    })();
    const activeMatchId =
      result.matches.find((match) => match.index === currentIndex)?.id
      ?? (currentIndex > 0 ? `find-${hashStableString(`${query}|${currentIndex}`)}` : undefined);
    const reveal = request.reveal === true && currentIndex > 0
      ? await revealSearchInPageMatch(target, query, currentIndex, request.caseSensitive === true)
      : { ok: false };
    return {
      tabId: target.tabId,
      address: normalizeAddress(target.webContents.getURL()) ?? target.address,
      title: normalizeString(raw.title) ?? target.title,
      query,
      currentIndex,
      ...(activeMatchId === undefined ? {} : { activeMatchId }),
      ...(reveal.rect === undefined ? {} : { revealRect: reveal.rect }),
      ...result
    };
  };

  const searchInPage = async (
    request: WorkbenchBrowserSearchInPageRequest
  ): Promise<WorkbenchBrowserSearchInPageResult> => {
    const tabId = normalizeString(request.tabId) ?? getActiveOrFocusedTabId();
    if (tabId === null) {
      throw new Error("tab_not_found");
    }
    const entry = requireEntry(tabId);
    return await performSearchInPage(
      {
        tabId,
        webContents: entry.webContents,
        address: entry.runtime.address,
        title: entry.runtime.title
      },
      request
    );
  };

  const normalizeAgentObserveStrategy = (
    strategy: WorkbenchBrowserAgentObserveStrategy | undefined
  ): WorkbenchBrowserAgentObserveStrategy => {
    if (
      strategy === "interactiveOnly"
      || strategy === "picker"
      || strategy === "focus"
      || strategy === "hybrid"
      || strategy === "domFallback"
      || strategy === "visionFallback"
    ) {
      return strategy;
    }
    return "interactiveOnly";
  };

  const isLightweightAgentObserveStrategy = (
    strategy: WorkbenchBrowserAgentObserveStrategy
  ): boolean =>
    strategy === "interactiveOnly" || strategy === "picker" || strategy === "focus";

  const createBrowserAgentObservationId = (tabId: string): string =>
    `lyra-lumen-${tabId}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const browserAgentCacheKey = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode
  ): string => `${targetMode}:${tabId}`;

  const invalidateBrowserAgentTargets = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    reason: "navigation" | "frameReload" = "navigation"
  ): void => {
    browserAgentCache.delete(browserAgentCacheKey(tabId, targetMode));
    browserAgentInputTargets.delete(browserAgentCacheKey(tabId, targetMode));
    lumenTargetRegistry.invalidateTab(tabId, targetMode, reason);
  };

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

  const buildBrowserAgentSemanticFrameGraph = async (
    target: BrowserAgentPageTarget,
    timeoutMs: number
  ): Promise<BrowserAgentSemanticFrameGraph> => {
    const allFrames = target.webContents.mainFrame.framesInSubtree
      .filter((frame) => frame.isDestroyed() === false);
    const mainFrame = target.webContents.mainFrame;
    const mainOrigin = mainFrame.origin;
    const ownerCandidatesByFrame = new Map<number, readonly BrowserAgentFrameOwnerCandidate[]>();
    const viewportByFrame = new Map<number, WorkbenchBrowserFrameGlobalBounds>();
    const warnings: string[] = [];
    const blockedRegions: WorkbenchBrowserSemanticBlockedRegion[] = [];
    const ownerScript = buildBrowserAgentFrameOwnerProbeScript();

    for (const frame of allFrames) {
      try {
        const raw = await runFrameScriptWithTimeout(
          () => frame.executeJavaScript(ownerScript, false),
          Math.max(500, Math.min(2_000, timeoutMs))
        );
        const probed = coerceFrameOwnerCandidates(raw);
        ownerCandidatesByFrame.set(frame.frameTreeNodeId, probed.candidates);
        if (probed.viewport !== null) {
          viewportByFrame.set(frame.frameTreeNodeId, probed.viewport);
        }
      } catch (error) {
        warnings.push(`frame_owner_probe_failed:${frame.frameTreeNodeId}`);
        blockedRegions.push({
          id: `frame-unavailable-${frame.frameTreeNodeId}`,
          kind: "frame-unavailable",
          frameRef: createBrowserAgentFrameRef(
            frame.frameTreeNodeId,
            frame.url,
            frame.parent?.frameTreeNodeId
          ),
          frameTreeNodeId: frame.frameTreeNodeId,
          reason: error instanceof Error ? error.message : String(error),
          ...(frame.url.length > 0 ? { url: frame.url } : {}),
          fallback: "visual",
          confidence: "medium"
        });
      }
    }

    const ownerByChildFrame = new Map<number, BrowserAgentFrameOwnerCandidate>();
    for (const parentFrame of allFrames) {
      const candidates = ownerCandidatesByFrame.get(parentFrame.frameTreeNodeId) ?? [];
      const matches = matchFrameOwnerCandidates(parentFrame, candidates);
      for (const [childFrameTreeNodeId, candidate] of matches) {
        ownerByChildFrame.set(childFrameTreeNodeId, candidate);
      }
    }

    const boundsByFrame = new Map<number, WorkbenchBrowserFrameGlobalBounds>();
    boundsByFrame.set(
      mainFrame.frameTreeNodeId,
      viewportByFrame.get(mainFrame.frameTreeNodeId) ?? { x: 0, y: 0, width: 1_280, height: 720 }
    );

    const sortedFrames = allFrames.slice().sort((left, right) => {
      const leftDepth = left === left.top ? 0 : left.framesInSubtree.length;
      const rightDepth = right === right.top ? 0 : right.framesInSubtree.length;
      return leftDepth - rightDepth || left.frameTreeNodeId - right.frameTreeNodeId;
    });
    let changed = true;
    while (changed) {
      changed = false;
      for (const frame of sortedFrames) {
        if (boundsByFrame.has(frame.frameTreeNodeId) || frame.parent === null) {
          continue;
        }
        const parentBounds = boundsByFrame.get(frame.parent.frameTreeNodeId);
        const owner = ownerByChildFrame.get(frame.frameTreeNodeId);
        if (parentBounds === undefined || owner === undefined) {
          continue;
        }
        boundsByFrame.set(frame.frameTreeNodeId, {
          x: parentBounds.x + owner.bounds.x,
          y: parentBounds.y + owner.bounds.y,
          width: owner.bounds.width,
          height: owner.bounds.height
        });
        changed = true;
      }
    }

    const frames = allFrames.map((frame): WorkbenchBrowserSemanticFrame => {
      const parentFrameTreeNodeId = frame.parent?.frameTreeNodeId;
      const frameRef = createBrowserAgentFrameRef(frame.frameTreeNodeId, frame.url, parentFrameTreeNodeId);
      const owner = ownerByChildFrame.get(frame.frameTreeNodeId);
      const crossOrigin = frame.parent !== null && frame.origin !== "null" && frame.parent.origin !== frame.origin;
      return {
        frameRef,
        frameTreeNodeId: frame.frameTreeNodeId,
        ...(frame.parent === null
          ? {}
          : {
              parentFrameRef: createBrowserAgentFrameRef(
                frame.parent.frameTreeNodeId,
                frame.parent.url,
                frame.parent.parent?.frameTreeNodeId
              ),
              parentFrameTreeNodeId: frame.parent.frameTreeNodeId
            }),
        isMainFrame: frame.frameTreeNodeId === mainFrame.frameTreeNodeId,
        url: frame.url,
        origin: frame.origin,
        name: frame.name,
        ...(boundsByFrame.get(frame.frameTreeNodeId) === undefined
          ? {}
          : { bounds: boundsByFrame.get(frame.frameTreeNodeId) as WorkbenchBrowserFrameGlobalBounds }),
        ...(owner === undefined
          ? {}
          : {
              ownerSelectorPreview: owner.selectorPreview,
              ...(frame.parent === null ? {} : { ownerFrameTreeNodeId: frame.parent.frameTreeNodeId }),
              matchConfidence:
                scoreFrameOwnerCandidate(
                  frame,
                  owner,
                  frame.parent?.frames.findIndex((candidate) => candidate.frameTreeNodeId === frame.frameTreeNodeId) ?? 0
                ) >= 80
                  ? "high"
                  : "medium"
            }),
        domAccess: frame.frameTreeNodeId === mainFrame.frameTreeNodeId || frame.origin === mainOrigin
          ? "direct"
          : (crossOrigin ? "cdp" : "unknown"),
        accessibilityStatus: "unknown"
      };
    });

    const framesByTreeNodeId = new Map(frames.map((frame) => [frame.frameTreeNodeId, frame]));
    return { frames, framesByTreeNodeId, warnings, blockedRegions };
  };

  const buildBrowserAgentSemanticTree = ({
    elements,
    frameGraph,
    warnings,
    authChallengeSignals
  }: {
    readonly elements: readonly WorkbenchBrowserAgentElement[];
    readonly frameGraph: BrowserAgentSemanticFrameGraph;
    readonly warnings: readonly string[];
    readonly authChallengeSignals: NonNullable<WorkbenchBrowserAgentObservation["authChallengeSignals"]>;
  }): WorkbenchBrowserSemanticTree => {
    const blockedRegions: WorkbenchBrowserSemanticBlockedRegion[] = [...frameGraph.blockedRegions];
    for (const signal of authChallengeSignals) {
      if (signal.kind === "captcha") {
        blockedRegions.push({
          id: `captcha-${hashStableString(`${signal.url ?? ""}|${signal.label ?? ""}`)}`,
          kind: "captcha",
          reason: signal.label ?? "captcha challenge detected",
          ...(signal.url === undefined ? {} : { url: signal.url }),
          fallback: "elevate",
          confidence: signal.confidence
        });
      } else if (signal.kind === "permission_prompt" || signal.kind === "payment_auth") {
        blockedRegions.push({
          id: `${signal.kind}-${hashStableString(`${signal.url ?? ""}|${signal.label ?? ""}`)}`,
          kind: "permission-prompt",
          reason: signal.label ?? signal.kind,
          ...(signal.url === undefined ? {} : { url: signal.url }),
          fallback: "user",
          confidence: signal.confidence
        });
      }
    }
    if (warnings.some((warning) => warning.includes("closed_shadow"))) {
      blockedRegions.push({
        id: "closed-shadow-boundary",
        kind: "closed-shadow",
        reason: "A custom element or closed shadow boundary was visible but not DOM-traversable.",
        fallback: "visual",
        confidence: "low"
      });
    }

    const nodes: WorkbenchBrowserSemanticNode[] = elements.map((element) => {
      const frameBounds = element.frameBounds
        ?? frameGraph.framesByTreeNodeId.get(element.frameTreeNodeId)?.bounds;
      const offscreen = frameBounds === undefined
        ? false
        : element.bounds.x + element.bounds.width < frameBounds.x
          || element.bounds.y + element.bounds.height < frameBounds.y
          || element.bounds.x > frameBounds.x + frameBounds.width
          || element.bounds.y > frameBounds.y + frameBounds.height;
      const visibility = element.visibility;
      return {
        nodeKey: element.semanticNodeKey ?? semanticNodeKeyForTarget(element.targetRef, "dom", element.frameRef),
        targetRef: element.targetRef,
        frameRef: element.frameRef,
        frameTreeNodeId: element.frameTreeNodeId,
        elementId: element.id,
        tagName: element.tagName,
        role: element.role,
        name: element.label,
        label: element.label,
        selectorPreview: element.selectorPreview,
        bounds: element.bounds,
        source:
          element.discoveryScope === "visual"
            ? ["visual"]
            : element.discoveryScope === "ax" ? ["ax"] : ["dom"],
        treeScope: element.discoveryScope ?? "document",
        ...(element.hostChain === undefined ? {} : { hostChain: element.hostChain }),
        ...(element.hostChainFingerprint === undefined ? {} : { hostChainFingerprint: element.hostChainFingerprint }),
        actionCapabilities: element.actionCapabilities ?? actionCapabilitiesForElement(element),
        visibility: {
          visible: visibility?.visible ?? true,
          offscreen: visibility?.offscreen ?? offscreen,
          covered: visibility?.covered ?? false,
          ariaHidden: visibility?.ariaHidden ?? false
        },
        state: {
          focusable: element.focusable,
          disabled: element.disabled,
          editable: element.editable,
          ...(element.checked === undefined ? {} : { checked: element.checked }),
          ...(element.expanded === undefined ? {} : { expanded: element.expanded })
        },
        confidence: element.confidence ?? 0.92
      };
    });

    const edges = nodes
      .filter((node) => node.treeScope === "shadow" && node.hostChain !== undefined && node.hostChain.length > 0)
      .map((node): WorkbenchBrowserSemanticTree["edges"][number] => ({
        from: `shadow-host:${hashStableString(node.hostChain?.join(">") ?? "")}`,
        to: node.nodeKey,
        kind: "shadow-host"
      }));
    const frameEdges = frameGraph.frames
      .filter((frame) => frame.parentFrameRef !== undefined)
      .map((frame): WorkbenchBrowserSemanticTree["edges"][number] => ({
        from: frame.parentFrameRef ?? "",
        to: frame.frameRef,
        kind: "frame-owner"
      }));
    const framesWithBounds = frameGraph.frames.filter((frame) => frame.bounds !== undefined).length;
    const shadowNodes = nodes.filter((node) => node.treeScope === "shadow").length;
    const axNodes = nodes.filter((node) => node.source.includes("ax")).length;
    const visualNodes = nodes.filter((node) => node.source.includes("visual")).length;
    return {
      nodes,
      edges: [...edges, ...frameEdges],
      frames: frameGraph.frames,
      warnings,
      coverage: {
        domCoverage: normalizeUnitCoverage(elements.length > 0 ? 1 : 0),
        axCoverage: normalizeUnitCoverage(axNodes > 0 ? 1 : 0),
        frameCoverage: normalizeUnitCoverage(frameGraph.frames.length === 0 ? 1 : framesWithBounds / frameGraph.frames.length),
        shadowCoverage: normalizeUnitCoverage(
          warnings.some((warning) => warning.includes("closed_shadow"))
            ? (shadowNodes > 0 ? 0.5 : 0)
            : 1
        ),
        visualCoverage: normalizeUnitCoverage(visualNodes > 0 ? 1 : 0)
      },
      blockedRegions
    };
  };

  const createVisualFallbackElement = ({
    tabId,
    rawUrl,
    mapEpoch,
    observedAt,
    frame,
    elementId
  }: {
    readonly tabId: string;
    readonly rawUrl: string;
    readonly mapEpoch: number;
    readonly observedAt: number;
    readonly frame: WorkbenchBrowserSemanticFrame;
    readonly elementId: number;
  }): WorkbenchBrowserAgentElement => {
    const frameBounds = frame.bounds ?? { x: 0, y: 0, width: 1_280, height: 720 };
    const center = boundsCenter(frameBounds);
    const bounds = {
      x: Math.max(frameBounds.x, center.x - 20),
      y: Math.max(frameBounds.y, center.y - 20),
      width: 40,
      height: 40
    };
    const baseElement = {
      id: elementId,
      frameTreeNodeId: frame.frameTreeNodeId,
      frameRef: frame.frameRef,
      tagName: "visual",
      role: "visual",
      label: "Visual fallback target",
      selectorPreview: "visual:center",
      bounds,
      localBounds: {
        x: bounds.x - frameBounds.x,
        y: bounds.y - frameBounds.y,
        width: bounds.width,
        height: bounds.height
      },
      frameBounds,
      focusable: false,
      disabled: false,
      editable: false,
      discoveryScope: "visual" as const,
      actionHint: "visual_click_requires_risk_review",
      textSnippet: "Screenshot is available through lyra_lumen.see; action requires risk review.",
      confidence: 0.25
    } satisfies Omit<
      WorkbenchBrowserAgentElement,
      "stableId" | "targetRef" | "target" | "elementFingerprint" | "semanticNodeKey" | "actionCapabilities"
    >;
    const targetRef = createBrowserAgentTargetRef(rawUrl, baseElement);
    const targetMetadata: WorkbenchLumenTargetRef = {
      targetRef: targetRef.targetRef,
      targetKind: "visual",
      tabId,
      frameRef: frame.frameRef,
      frameChain: [frame.frameRef],
      elementFingerprint: targetRef.elementFingerprint,
      mapEpoch,
      expiresAt: observedAt + lumenTargetRegistry.targetTtlMs()
    };
    return {
      ...baseElement,
      semanticNodeKey: semanticNodeKeyForTarget(targetRef.targetRef, "visual", frame.frameRef),
      actionCapabilities: ["click"],
      stableId: targetRef.stableId,
      targetRef: targetRef.targetRef,
      target: targetMetadata,
      elementFingerprint: targetRef.elementFingerprint
    };
  };

  const readBrowserAgentAxOnlyElements = async ({
    tabId,
    target,
    rawUrl,
    frameGraph,
    mapEpoch,
    observedAt,
    existingElements,
    startingElementId
  }: {
    readonly tabId: string;
    readonly target: BrowserAgentPageTarget;
    readonly rawUrl: string;
    readonly frameGraph: BrowserAgentSemanticFrameGraph;
    readonly mapEpoch: number;
    readonly observedAt: number;
    readonly existingElements: readonly WorkbenchBrowserAgentElement[];
    readonly startingElementId: number;
  }): Promise<readonly WorkbenchBrowserAgentElement[]> => {
    let debuggerSession: WorkbenchBrowserDebuggerSession | null = null;
    try {
      debuggerSession = await openDebuggerSessionForTarget(target);
      await debuggerSession.sendCommand("Accessibility.enable").catch(() => ({}));
      await debuggerSession.sendCommand("DOM.enable").catch(() => ({}));
      const response = await debuggerSession.sendCommand("Accessibility.getFullAXTree");
      const axNodes = Array.isArray(response.nodes) ? response.nodes : [];
      const mainFrame = frameGraph.frames.find((frame) => frame.isMainFrame) ?? frameGraph.frames[0];
      if (mainFrame === undefined) {
        return [];
      }
      const existingSignatures = new Set(
        existingElements.map((element) => `${element.role.toLowerCase()}|${element.label.toLowerCase()}`)
      );
      const elements: WorkbenchBrowserAgentElement[] = [];
      let nextElementId = startingElementId;
      for (const axNode of axNodes.slice(0, 160)) {
        if (axNode === null || typeof axNode !== "object") {
          continue;
        }
        const record = axNode as Record<string, unknown>;
        if (record.ignored === true) {
          continue;
        }
        const role = readAxValueText(record.role).toLowerCase();
        const label = readAxValueText(record.name) || readAxValueText(record.value);
        const actionable = role === "button"
          || role === "link"
          || role === "textbox"
          || role === "searchbox"
          || role === "checkbox"
          || role === "menuitem"
          || role === "combobox"
          || role === "switch";
        if (!actionable || label.length === 0 || existingSignatures.has(`${role}|${label.toLowerCase()}`)) {
          continue;
        }
        const backendNodeId = Number(record.backendDOMNodeId);
        if (!Number.isFinite(backendNodeId)) {
          continue;
        }
        const box = await debuggerSession.sendCommand("DOM.getBoxModel", {
          backendNodeId: Math.round(backendNodeId)
        }).catch(() => ({}));
        const bounds = boundsFromCdpBoxModel(box);
        if (bounds === null) {
          continue;
        }
        const frameBounds = mainFrame.bounds ?? { x: 0, y: 0, width: 1_280, height: 720 };
        const baseElement = {
          id: nextElementId,
          frameTreeNodeId: mainFrame.frameTreeNodeId,
          frameRef: mainFrame.frameRef,
          tagName: "ax",
          role,
          label,
          selectorPreview: `ax[role="${role}"]`,
          bounds,
          localBounds: {
            x: bounds.x - frameBounds.x,
            y: bounds.y - frameBounds.y,
            width: bounds.width,
            height: bounds.height
          },
          frameBounds,
          focusable: true,
          disabled: false,
          editable: role === "textbox" || role === "searchbox",
          discoveryScope: "ax" as const,
          actionHint: role === "textbox" || role === "searchbox" ? "type" : "click",
          confidence: 0.72
        } satisfies Omit<
          WorkbenchBrowserAgentElement,
          "stableId" | "targetRef" | "target" | "elementFingerprint" | "semanticNodeKey" | "actionCapabilities"
        >;
        const targetRef = createBrowserAgentTargetRef(rawUrl, baseElement);
        const targetMetadata: WorkbenchLumenTargetRef = {
          targetRef: targetRef.targetRef,
          targetKind: browserAgentTargetKind(baseElement),
          tabId,
          frameRef: mainFrame.frameRef,
          frameChain: [mainFrame.frameRef],
          elementFingerprint: targetRef.elementFingerprint,
          mapEpoch,
          expiresAt: observedAt + lumenTargetRegistry.targetTtlMs()
        };
        elements.push({
          ...baseElement,
          semanticNodeKey: semanticNodeKeyForTarget(targetRef.targetRef, "ax", mainFrame.frameRef),
          actionCapabilities: actionCapabilitiesForElement(baseElement),
          stableId: targetRef.stableId,
          targetRef: targetRef.targetRef,
          target: targetMetadata,
          elementFingerprint: targetRef.elementFingerprint
        });
        existingSignatures.add(`${role}|${label.toLowerCase()}`);
        nextElementId += 1;
        if (elements.length >= 24) {
          break;
        }
      }
      return elements;
    } catch {
      return [];
    } finally {
      await debuggerSession?.close().catch(() => undefined);
    }
  };

  const observeAgentPage = async (
    tabId: string,
    request?: WorkbenchBrowserAgentModeRequest & {
      readonly strategy?: WorkbenchBrowserAgentObserveStrategy;
      readonly timeoutMs?: number;
      readonly suppressActivity?: boolean;
    }
  ): Promise<WorkbenchBrowserAgentObservation> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request?.timeoutMs);
    const strategy = normalizeAgentObserveStrategy(request?.strategy);
    const timeoutMs = normalizeExecuteScriptTimeoutMs(request?.timeoutMs, 8_000);
    const lightweightObservation = isLightweightAgentObserveStrategy(strategy);
    if (request?.suppressActivity !== true) {
      publishBrowserAgentActivity({
        tabId,
        targetMode: target.targetMode,
        action: "observe",
        visibleFollow: target.browserMode.visibleFollow,
        durationMs: lightweightObservation
          ? Math.max(650, Math.min(1_600, timeoutMs))
          : Math.max(1_250, Math.min(3_200, timeoutMs))
      });
    }
    const frameObservations: BrowserAgentRawFrameObservation[] = [];
    let frameGraph: BrowserAgentSemanticFrameGraph;
    let graphWarnings: string[] = [];
    let graphBlockedRegions: WorkbenchBrowserSemanticBlockedRegion[] = [];
    if (lightweightObservation) {
      const mainFrame = target.webContents.mainFrame;
      const mainFrameBounds = { x: 0, y: 0, width: 1_280, height: 720 };
      const mainSemanticFrame: WorkbenchBrowserSemanticFrame = {
        frameRef: createBrowserAgentFrameRef(mainFrame.frameTreeNodeId, mainFrame.url),
        frameTreeNodeId: mainFrame.frameTreeNodeId,
        isMainFrame: true,
        url: mainFrame.url,
        origin: mainFrame.origin,
        name: mainFrame.name,
        bounds: mainFrameBounds,
        domAccess: "direct",
        accessibilityStatus: "unknown"
      };
      frameGraph = {
        frames: [mainSemanticFrame],
        framesByTreeNodeId: new Map([[mainSemanticFrame.frameTreeNodeId, mainSemanticFrame]]),
        warnings: [],
        blockedRegions: []
      };
      try {
        const rawFrame = await runFrameScriptWithTimeout(
          () => mainFrame.executeJavaScript(
            buildBrowserAgentObservationScript({
              frameTreeNodeId: mainSemanticFrame.frameTreeNodeId,
              frameRef: mainSemanticFrame.frameRef,
              frameBounds: mainFrameBounds,
              strategy,
              includeChildFrames: true
            }),
            true
          ),
          Math.max(350, Math.min(1_500, timeoutMs))
        );
        frameObservations.push({
          frame: mainSemanticFrame,
          raw: rawFrame !== null && typeof rawFrame === "object" ? rawFrame as Record<string, unknown> : {}
        });
      } catch (error) {
        graphWarnings.push(`frame_observe_failed:${mainSemanticFrame.frameTreeNodeId}`);
        graphBlockedRegions.push({
          id: `frame-observe-${mainSemanticFrame.frameTreeNodeId}`,
          kind: "frame-unavailable",
          frameRef: mainSemanticFrame.frameRef,
          frameTreeNodeId: mainSemanticFrame.frameTreeNodeId,
          bounds: mainFrameBounds,
          reason: error instanceof Error ? error.message : String(error),
          ...(mainSemanticFrame.url.length > 0 ? { url: mainSemanticFrame.url } : {}),
          fallback: "visual",
          confidence: "medium"
        });
      }
    } else {
      frameGraph = await buildBrowserAgentSemanticFrameGraph(target, timeoutMs);
      graphWarnings = [...frameGraph.warnings];
      graphBlockedRegions = [...frameGraph.blockedRegions];
      for (const semanticFrame of frameGraph.frames.slice(0, 48)) {
        const frame = findFrameInWebContents(target.webContents, semanticFrame.frameTreeNodeId);
        if (frame === null) {
          graphWarnings.push(`frame_missing:${semanticFrame.frameTreeNodeId}`);
          continue;
        }
        try {
          const rawFrame = await runFrameScriptWithTimeout(
            () => frame.executeJavaScript(
              buildBrowserAgentObservationScript({
                frameTreeNodeId: semanticFrame.frameTreeNodeId,
                frameRef: semanticFrame.frameRef,
                frameBounds: semanticFrame.bounds ?? { x: 0, y: 0, width: 1, height: 1 },
                strategy,
                includeChildFrames: false
              }),
              true
            ),
            Math.max(500, Math.min(3_000, timeoutMs))
          );
          frameObservations.push({
            frame: semanticFrame,
            raw: rawFrame !== null && typeof rawFrame === "object" ? rawFrame as Record<string, unknown> : {}
          });
        } catch (error) {
          graphWarnings.push(`frame_observe_failed:${semanticFrame.frameTreeNodeId}`);
          graphBlockedRegions.push({
            id: `frame-observe-${semanticFrame.frameTreeNodeId}`,
            kind: semanticFrame.domAccess === "cdp" ? "cross-origin" : "frame-unavailable",
            frameRef: semanticFrame.frameRef,
            frameTreeNodeId: semanticFrame.frameTreeNodeId,
            ...(semanticFrame.bounds === undefined ? {} : { bounds: semanticFrame.bounds }),
            reason: error instanceof Error ? error.message : String(error),
            ...(semanticFrame.url.length > 0 ? { url: semanticFrame.url } : {}),
            fallback: "visual",
            confidence: semanticFrame.domAccess === "cdp" ? "high" : "medium"
          });
        }
      }
    }

    const mainRaw = frameObservations.find((entry) => entry.frame.isMainFrame)?.raw ?? {};
    const rawUrl = typeof mainRaw.url === "string" ? mainRaw.url : agentTargetAddress(target);
    const observedAt = Date.now();
    const mapEpoch = lumenTargetRegistry.nextMapEpoch(tabId, target.targetMode);
    const rawElements = frameObservations.flatMap((entry) => {
      const rawItems = Array.isArray(entry.raw.elements) ? entry.raw.elements : [];
      const activeLocalId = Number.isFinite(Number(entry.raw.activeElementId))
        ? Math.round(Number(entry.raw.activeElementId))
        : null;
      return rawItems.map((item) => ({
        item,
        frame: entry.frame,
        activeLocalId
      }));
    });
    let nextElementId = 1;
    let activeElementId: number | null = null;
    const domElements = rawElements
      .map((entry): WorkbenchBrowserAgentElement | null => {
        const { item, frame, activeLocalId } = entry;
        if (item === null || typeof item !== "object") {
          return null;
        }
        const record = item as Record<string, unknown>;
        const bounds = record.bounds !== null && typeof record.bounds === "object"
          ? record.bounds as Record<string, unknown>
          : {};
        const localId = Number(record.id);
        const x = Number(bounds.x);
        const y = Number(bounds.y);
        const width = Number(bounds.width);
        const height = Number(bounds.height);
        if (
          Number.isFinite(localId) === false
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
          record.discoveryScope === "shadow" || record.discoveryScope === "frame" || record.discoveryScope === "visual"
            ? record.discoveryScope
            : "document";
        const frameTreeNodeId = Number.isFinite(Number(record.frameTreeNodeId))
          ? Math.round(Number(record.frameTreeNodeId))
          : frame.frameTreeNodeId;
        const frameUrl = typeof record.frameUrl === "string" && record.frameUrl.length > 0
          ? record.frameUrl
          : frame.url || rawUrl;
        const frameRef = typeof record.frameRef === "string" && record.frameRef.length > 0
          ? record.frameRef
          : frame.frameRef;
        const localBounds = coerceFrameBounds(record.localBounds) ?? {
          x: Math.round(x - (frame.bounds?.x ?? 0)),
          y: Math.round(y - (frame.bounds?.y ?? 0)),
          width: Math.round(width),
          height: Math.round(height)
        };
        const frameBounds = coerceFrameBounds(record.frameBounds) ?? frame.bounds;
        const hostChain = Array.isArray(record.hostChain)
          ? record.hostChain.filter((value): value is string => typeof value === "string" && value.length > 0)
          : [];
        const hostChainFingerprint = typeof record.hostChainFingerprint === "string" && record.hostChainFingerprint.length > 0
          ? record.hostChainFingerprint
          : (hostChain.length > 0 ? hashStableString(hostChain.join(">")) : undefined);
        const visibility = coerceElementVisibility(record.visibility);
        const elementId = nextElementId;
        nextElementId += 1;
        if (activeLocalId !== null && Math.round(localId) === activeLocalId) {
          activeElementId = elementId;
        }
        const baseElement = {
          id: elementId,
          frameTreeNodeId,
          frameRef,
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
          localBounds,
          ...(frameBounds === undefined ? {} : { frameBounds }),
          focusable: record.focusable === true,
          disabled: record.disabled === true,
          editable: record.editable === true,
          ...(visibility === undefined ? {} : { visibility }),
          ...(typeof record.checked === "boolean" ? { checked: record.checked } : {}),
          ...(typeof record.expanded === "boolean" ? { expanded: record.expanded } : {}),
          discoveryScope,
          ...(hostChain.length > 0 ? { hostChain } : {}),
          ...(hostChainFingerprint === undefined ? {} : { hostChainFingerprint }),
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
          ...(frameUrl.length > 0
            ? { frameUrl }
            : {})
        } satisfies Omit<
          WorkbenchBrowserAgentElement,
          "stableId" | "targetRef" | "target" | "elementFingerprint" | "semanticNodeKey" | "actionCapabilities"
        >;
        const targetRef = createBrowserAgentTargetRef(rawUrl, baseElement);
        const actionCapabilities = actionCapabilitiesForElement(baseElement);
        const semanticNodeKey = semanticNodeKeyForTarget(targetRef.targetRef, "dom", frameRef);
        const targetMetadata: WorkbenchLumenTargetRef = {
          targetRef: targetRef.targetRef,
          targetKind: browserAgentTargetKind(baseElement),
          tabId,
          frameRef,
          frameChain: [frameRef],
          elementFingerprint: targetRef.elementFingerprint,
          mapEpoch,
          expiresAt: observedAt + lumenTargetRegistry.targetTtlMs()
        };
        const element: WorkbenchBrowserAgentElement = {
          ...baseElement,
          semanticNodeKey,
          actionCapabilities,
          stableId: targetRef.stableId,
          targetRef: targetRef.targetRef,
          target: targetMetadata,
          elementFingerprint: targetRef.elementFingerprint
        };
        return element;
      })
      .filter((item): item is WorkbenchBrowserAgentElement => item !== null);
    const axElements = lightweightObservation
      ? []
      : await readBrowserAgentAxOnlyElements({
          tabId,
          target,
          rawUrl,
          frameGraph,
          mapEpoch,
          observedAt,
          existingElements: domElements,
          startingElementId: nextElementId
        });
    let elements: readonly WorkbenchBrowserAgentElement[] = axElements.length > 0
      ? [...domElements, ...axElements]
      : domElements;
    const visualFallbackFrames = lightweightObservation ? [] : graphBlockedRegions
      .filter((region) =>
        (region.kind === "cross-origin" || region.kind === "frame-unavailable")
        && region.fallback === "visual"
        && region.frameRef !== undefined
      )
      .map((region) => frameGraph.frames.find((frame) => frame.frameRef === region.frameRef && frame.bounds !== undefined))
      .filter((frame): frame is WorkbenchBrowserSemanticFrame => frame !== undefined)
      .filter((frame, index, frames) =>
        frames.findIndex((candidate) => candidate.frameRef === frame.frameRef) === index
        && elements.some((element) => element.frameRef === frame.frameRef) === false
      )
      .slice(0, 4);
    let nextVisualElementId = nextElementId + axElements.length;
    if (visualFallbackFrames.length > 0) {
      const visualElements = visualFallbackFrames.map((frame) => {
        const element = createVisualFallbackElement({
          tabId,
          rawUrl,
          mapEpoch,
          observedAt,
          frame,
          elementId: nextVisualElementId
        });
        nextVisualElementId += 1;
        graphBlockedRegions.push({
          id: `visual-fallback-${frame.frameRef}`,
          kind: "visual-fallback",
          frameRef: frame.frameRef,
          frameTreeNodeId: frame.frameTreeNodeId,
          ...(frame.bounds === undefined ? {} : { bounds: frame.bounds }),
          reason: "DOM access is blocked for this frame; compact screenshot fallback is required before acting.",
          fallback: "visual",
          confidence: "medium"
        });
        return element;
      });
      elements = [...elements, ...visualElements];
    }
    if (!lightweightObservation && elements.length === 0) {
      const mainFrame = frameGraph.frames.find((frame) => frame.isMainFrame) ?? frameGraph.frames[0];
      if (mainFrame !== undefined) {
        elements = [
          createVisualFallbackElement({
            tabId,
            rawUrl,
            mapEpoch,
            observedAt,
            frame: mainFrame,
            elementId: nextVisualElementId
          })
        ];
        graphBlockedRegions.push({
          id: `visual-fallback-${mainFrame.frameRef}`,
          kind: "visual-fallback",
          frameRef: mainFrame.frameRef,
          frameTreeNodeId: mainFrame.frameTreeNodeId,
          ...(mainFrame.bounds === undefined ? {} : { bounds: mainFrame.bounds }),
          reason: "DOM and Accessibility maps produced no targetable controls; compact screenshot fallback is required.",
          fallback: "visual",
          confidence: "medium"
        });
      }
    }
    const targets = elements.map((element) => element.target);

    const focusOrder = elements
      .filter((element) => element.focusable)
      .slice()
      .sort((left, right) => {
        const leftTab = (left.tabIndex ?? -1) > 0 ? left.tabIndex ?? 0 : Number.MAX_SAFE_INTEGER;
        const rightTab = (right.tabIndex ?? -1) > 0 ? right.tabIndex ?? 0 : Number.MAX_SAFE_INTEGER;
        return leftTab - rightTab || left.id - right.id;
      })
      .map((element) => element.id);
    const rawWarnings = frameObservations.flatMap((entry) =>
      Array.isArray(entry.raw.warnings)
        ? entry.raw.warnings.filter((value): value is string => typeof value === "string")
        : []
    );
    for (const rawBlockedRegion of frameObservations.flatMap((entry) =>
      Array.isArray(entry.raw.blockedRegions) ? entry.raw.blockedRegions : []
    )) {
      if (rawBlockedRegion === null || typeof rawBlockedRegion !== "object") {
        continue;
      }
      const record = rawBlockedRegion as Record<string, unknown>;
      if (record.kind !== "closed-shadow") {
        continue;
      }
      graphBlockedRegions.push({
        id: typeof record.id === "string" && record.id.length > 0
          ? record.id
          : `closed-shadow-${graphBlockedRegions.length + 1}`,
        kind: "closed-shadow",
        ...(typeof record.frameRef === "string" ? { frameRef: record.frameRef } : {}),
        ...(Number.isFinite(Number(record.frameTreeNodeId))
          ? { frameTreeNodeId: Math.round(Number(record.frameTreeNodeId)) }
          : {}),
        ...(coerceFrameBounds(record.bounds) === null ? {} : { bounds: coerceFrameBounds(record.bounds)! }),
        reason: typeof record.reason === "string" ? record.reason : "closed shadow boundary",
        fallback: "visual",
        confidence: record.confidence === "high" || record.confidence === "medium" ? record.confidence : "low"
      });
    }
    const warnings = [...new Set([...graphWarnings, ...rawWarnings])];
    const rawAuthChallengeSignals = frameObservations.flatMap((entry) =>
      Array.isArray(entry.raw.authChallengeSignals) ? entry.raw.authChallengeSignals : []
    );
    const diagnosticAuthChallengeSignals: WorkbenchBrowserAuthChallengeSignal[] =
      (pageDiagnostics.get(tabId) ?? []).flatMap((entry): WorkbenchBrowserAuthChallengeSignal[] => {
        if (entry.status === 401 || entry.status === 403) {
          return [{
            kind: "login_wall",
            confidence: entry.status === 401 ? "high" : "medium",
            source: "diagnostic",
            label: `http ${entry.status}`,
            ...(entry.url === undefined ? {} : { url: entry.url })
          }];
        }
        if (entry.resourceType === "Document" && entry.mimeType?.includes("octet-stream")) {
          return [{
            kind: "download_prompt",
            confidence: "medium",
            source: "diagnostic",
            label: "download response",
            ...(entry.url === undefined ? {} : { url: entry.url })
          }];
        }
        return [];
      });
    const authChallengeSignals = rawAuthChallengeSignals.length > 0
      ? [...rawAuthChallengeSignals, ...diagnosticAuthChallengeSignals]
          .map((value): NonNullable<WorkbenchBrowserAgentObservation["authChallengeSignals"]>[number] | null => {
            if (value === null || typeof value !== "object") {
              return null;
            }
            const record = value as Record<string, unknown>;
            const kind = record.kind;
            const confidence = record.confidence;
            const source = record.source;
            if (
              (
                kind !== "captcha"
                && kind !== "mfa"
                && kind !== "oauth_popup"
                && kind !== "permission_prompt"
                && kind !== "login_wall"
                && kind !== "download_prompt"
                && kind !== "payment_auth"
              )
              || (confidence !== "high" && confidence !== "medium" && confidence !== "low")
              || (source !== "dom" && source !== "attribute" && source !== "frame" && source !== "browser" && source !== "diagnostic")
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
      : diagnosticAuthChallengeSignals;
    const observedFrameGraph: BrowserAgentSemanticFrameGraph = {
      ...frameGraph,
      warnings: graphWarnings,
      blockedRegions: graphBlockedRegions
    };
    const semanticTree = buildBrowserAgentSemanticTree({
      elements,
      frameGraph: observedFrameGraph,
      warnings,
      authChallengeSignals
    });
    const observation: WorkbenchBrowserAgentObservation = {
      ok: true,
      kind: "lyraLumenMap",
      tabId,
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      observationId: createBrowserAgentObservationId(tabId),
      mapEpoch,
      strategy,
      url: rawUrl,
      title: typeof mainRaw.title === "string" && mainRaw.title.length > 0 ? mainRaw.title : agentTargetTitle(target),
      targets,
      elements,
      semanticTree,
      coverage: semanticTree.coverage,
      blockedRegions: semanticTree.blockedRegions,
      activeElementId,
      focusOrder,
      ...(authChallengeSignals.length > 0 ? { authChallengeSignals } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      nextRecommendedAction:
        authChallengeSignals.some((signal) => signal.confidence === "high")
          || semanticTree.blockedRegions.some((region) => region.fallback === "elevate")
          ? "lyra_lumen_elevate"
          : semanticTree.coverage.visualCoverage > 0 ? "lyra_lumen.see" : elements.length > 0 ? "lyra_lumen.act" : "lyra_lumen.read"
    };
    browserAgentCache.set(browserAgentCacheKey(tabId, target.targetMode), {
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
    lumenTargetRegistry.registerObservation({
      tabId,
      targetMode: target.targetMode,
      observationId: observation.observationId,
      mapEpoch: observation.mapEpoch,
      url: observation.url,
      title: observation.title,
      elements: observation.elements,
      observedAt
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

  const scheduleBrowserTargetRegistryWarmup = (
    entry: BrowserPageEntry,
    restoreState: NonNullable<WorkbenchBrowserPageRuntimeState["restoreState"]>
  ): void => {
    if (entry.isDestroyed || entry.webContents.isDestroyed()) {
      return;
    }
    if (restoreState.targetRegistry?.warmed === true) {
      return;
    }
    void observeAgentPage(entry.tabId, {
      strategy: "interactiveOnly",
      targetMode: "live",
      timeoutMs: 2_500,
      suppressActivity: true
    }).then((observation) => {
      const activeTargetRef =
        observation.activeElementId === null
          ? undefined
          : observation.elements.find((element) => element.id === observation.activeElementId)?.targetRef;
      const nextRestoreState = sanitizeBrowserPageRestoreState({
        ...entry.runtime.restoreState,
        targetRegistry: {
          warmed: true,
          targetCount: observation.targets.length,
          ...(activeTargetRef === undefined ? {} : { activeTargetRef }),
          capturedAt: Date.now()
        },
        capturedAt: Date.now()
      });
      if (nextRestoreState !== undefined) {
        browserSessionSnapshots.set(entry.tabId, nextRestoreState);
        updateRuntimeState(entry, { restoreState: nextRestoreState });
      }
    }).catch((error: unknown) => {
      updateRuntimeState(entry, {
        recoveryFailure: {
          reason: "target_stale",
          message: error instanceof Error ? error.message : String(error),
          at: Date.now()
        }
      });
    });
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
    readonly staleTarget?: WorkbenchLumenStaleTarget;
  }> => {
    if (request.targetRef !== undefined) {
      const resolved = lumenTargetRegistry.resolveTargetRef(tabId, targetMode, request.targetRef);
      if (resolved.ok) {
        return {
          element: resolved.entry.element,
          observationId: resolved.entry.observationId
        };
      }
      const observed = await observeAgentPage(tabId, {
        strategy: "interactiveOnly",
        targetMode,
        suppressActivity: true,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const rebound = lumenTargetRegistry.resolveTargetRef(tabId, targetMode, request.targetRef);
      if (rebound.ok) {
        return {
          element: rebound.entry.element,
          observationId: rebound.entry.observationId
        };
      }
      return {
        element: null,
        observationId: observed.observationId,
        staleTarget: rebound.staleTarget
      };
    }
    if (request.elementId !== undefined) {
      const resolved = lumenTargetRegistry.resolveElementId(tabId, targetMode, request.elementId);
      if (resolved.ok) {
        return {
          element: resolved.entry.element,
          observationId: resolved.entry.observationId
        };
      }
      return {
        element: null,
        staleTarget: resolved.staleTarget
      };
    }
    return {
      element: null,
      staleTarget: {
        reason: "notFound",
        lastSeenAt: null,
        recommendedAction: "lyra_lumen.map",
        nearestCandidates: []
      }
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

  const scrollAgentViewportByDelta = async ({
    tabId,
    target,
    deltaX,
    deltaY,
    point,
    reason,
    timeoutMs
  }: {
    readonly tabId: string;
    readonly target: BrowserAgentPageTarget;
    readonly deltaX: number;
    readonly deltaY: number;
    readonly point: {
      readonly x: number;
      readonly y: number;
    };
    readonly reason: WorkbenchBrowserAgentScrollEffect["reason"];
    readonly timeoutMs: number | undefined;
  }): Promise<WorkbenchBrowserAgentScrollEffect> => {
    const beforeViewport = await readAgentViewportState(target, timeoutMs);
    const cursor = clampAgentPointToViewport(point, beforeViewport);
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
      return {
        reason,
        scrolled: false,
        method: "none",
        before: point,
        after: point,
        deltaX: 0,
        deltaY: 0
      };
    }

    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "scroll",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      cursor,
      durationMs: 1_600
    });
    target.webContents.focus();
    sendAgentInputEvent(target, {
      type: "mouseWheel",
      x: cursor.x,
      y: cursor.y,
      deltaX,
      deltaY
    });
    await delay(90);
    let afterViewport = await readAgentViewportState(target, timeoutMs);
    let actualDeltaX = Math.round(afterViewport.scrollX - beforeViewport.scrollX);
    let actualDeltaY = Math.round(afterViewport.scrollY - beforeViewport.scrollY);
    let method: WorkbenchBrowserAgentScrollEffect["method"] = "wheel";

    if (Math.abs(actualDeltaX) < 1 && Math.abs(actualDeltaY) < 1) {
      if (target.targetMode === "live") {
        assertSharedControlCanContinue(target.tabId);
      }
      markSyntheticInput(target.tabId);
      await runFrameScriptWithTimeout(
        () => target.webContents.executeJavaScript(`
          (() => {
            window.scrollBy({
              left: ${JSON.stringify(deltaX)},
              top: ${JSON.stringify(deltaY)},
              behavior: "instant"
            });
            return {
              scrollX: Number(window.scrollX || window.pageXOffset || 0),
              scrollY: Number(window.scrollY || window.pageYOffset || 0)
            };
          })()
        `, true),
        normalizeExecuteScriptTimeoutMs(timeoutMs, 1_500)
      ).catch(() => null);
      await delay(70);
      afterViewport = await readAgentViewportState(target, timeoutMs);
      actualDeltaX = Math.round(afterViewport.scrollX - beforeViewport.scrollX);
      actualDeltaY = Math.round(afterViewport.scrollY - beforeViewport.scrollY);
      method = Math.abs(actualDeltaX) < 1 && Math.abs(actualDeltaY) < 1 ? "none" : "scrollBy";
    }

    const afterPoint = {
      x: Math.round(point.x - actualDeltaX),
      y: Math.round(point.y - actualDeltaY)
    };
    return {
      reason,
      scrolled: method !== "none",
      method,
      before: {
        x: Math.round(point.x),
        y: Math.round(point.y)
      },
      after: afterPoint,
      deltaX: actualDeltaX,
      deltaY: actualDeltaY
    };
  };

  const autoScrollPointIntoViewport = async ({
    tabId,
    target,
    point,
    reason,
    block,
    timeoutMs
  }: {
    readonly tabId: string;
    readonly target: BrowserAgentPageTarget;
    readonly point: {
      readonly x: number;
      readonly y: number;
    };
    readonly reason: WorkbenchBrowserAgentScrollEffect["reason"];
    readonly block: WorkbenchBrowserAgentScrollBlock | undefined;
    readonly timeoutMs: number | undefined;
  }): Promise<BrowserAgentAutoScrollResult> => {
    const viewport = await readAgentViewportState(target, timeoutMs);
    const normalizedBlock = normalizeAgentScrollBlock(block);
    const { deltaX, deltaY } = scrollDeltaToPlacePoint(point, viewport, normalizedBlock);
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
      return { point };
    }
    const effect = await scrollAgentViewportByDelta({
      tabId,
      target,
      deltaX,
      deltaY,
      point,
      reason,
      timeoutMs
    });
    return {
      point: effect.after,
      effect
    };
  };

  const ensureAgentElementVisible = async ({
    tabId,
    target,
    element,
    observationId,
    reason,
    block,
    timeoutMs
  }: {
    readonly tabId: string;
    readonly target: BrowserAgentPageTarget;
    readonly element: WorkbenchBrowserAgentElement;
    readonly observationId: string | undefined;
    readonly reason: WorkbenchBrowserAgentScrollEffect["reason"];
    readonly block: WorkbenchBrowserAgentScrollBlock | undefined;
    readonly timeoutMs: number | undefined;
  }): Promise<BrowserAgentAutoScrollResult> => {
    const point = centerOfAgentElement(element);
    const scrolled = await autoScrollPointIntoViewport({
      tabId,
      target,
      point,
      reason,
      block: block ?? "center",
      timeoutMs
    });
    if (scrolled.effect === undefined || scrolled.effect.scrolled === false) {
      return {
        element,
        point,
        ...(scrolled.effect === undefined ? {} : { effect: {
          ...scrolled.effect,
          targetRef: element.targetRef,
          elementId: element.id,
          ...(observationId === undefined ? {} : { beforeObservationId: observationId })
        } })
      };
    }
    const observed = await observeAgentPage(tabId, {
      strategy: "interactiveOnly",
      targetMode: target.targetMode,
      suppressActivity: true,
      ...(timeoutMs === undefined ? {} : { timeoutMs })
    });
    const rebound = await findAgentElement(
      tabId,
      { targetRef: element.targetRef },
      target.targetMode,
      timeoutMs
    );
    const nextElement = rebound.element ?? element;
    return {
      element: nextElement,
      point: centerOfAgentElement(nextElement),
      effect: {
        ...scrolled.effect,
        targetRef: element.targetRef,
        elementId: element.id,
        ...(observationId === undefined ? {} : { beforeObservationId: observationId }),
        afterObservationId: rebound.observationId ?? observed.observationId
      }
    };
  };

  const nextRecommendedActionAfterAgentAction = ({
    navigationStarted,
    pageChanged
  }: {
    readonly navigationStarted: boolean;
    readonly pageChanged: boolean;
  }): string => {
    if (navigationStarted) {
      return "lyra_lumen.wait";
    }
    if (pageChanged) {
      return "lyra_lumen.map";
    }
    return "continue_with_cached_targets";
  };

  const staleElementResult = (
    tabId: string,
    elementId: number | undefined,
    targetRef: string | undefined,
    targetMode: WorkbenchBrowserAgentTargetMode,
    browserMode: WorkbenchBrowserAgentModeInfo | undefined,
    observationId?: string,
    staleTarget?: WorkbenchLumenStaleTarget,
    action: BrowserAgentCursorOverlayAction = "act"
  ): WorkbenchBrowserAgentActionResult => {
    recordFollowAction(tabId, targetMode, action, {
      ...(browserMode === undefined ? {} : { visibleFollow: browserMode.visibleFollow }),
      inputActive: false,
      result: "failure"
    });
    return {
      ok: false,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode,
      ...(browserMode === undefined ? {} : { browserMode }),
      ...(elementId === undefined ? {} : { elementId }),
      ...(targetRef === undefined ? {} : { targetRef }),
      ...(observationId === undefined ? {} : { beforeObservationId: observationId }),
      ...(staleTarget === undefined ? {} : { staleTarget }),
      staleElement: true,
      nextRecommendedAction: "lyra_lumen.map",
      error: {
        kind: staleTarget === undefined ? "staleElement" : "staleTarget",
        message:
          targetRef === undefined
            ? `Element ${elementId ?? "(unspecified)"} is an observation-local Lyra Lumen id and is not valid in the current observation.`
            : `Target ${targetRef} is not available in the current Lyra Lumen target registry.`
      }
    };
  };

  const noEditableTargetResult = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    browserMode: WorkbenchBrowserAgentModeInfo | undefined,
    beforeObservationId?: string
  ): WorkbenchBrowserAgentActionResult => {
    recordFollowAction(tabId, targetMode, "type", {
      ...(browserMode === undefined ? {} : { visibleFollow: browserMode.visibleFollow }),
      inputActive: false,
      result: "failure"
    });
    return {
      ok: false,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode,
      ...(browserMode === undefined ? {} : { browserMode }),
      ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
      nextRecommendedAction: "lyra_lumen.map",
      error: {
        kind: "noEditableTarget",
        message:
          "No focused or previously selected editable browser element is available. Map the page and pass the editable elementId to lyra_lumen_type."
      }
    };
  };

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
          for (const host of Array.from(doc.querySelectorAll("*"))) {
            if (host.shadowRoot) {
              for (const element of Array.from(host.shadowRoot.querySelectorAll(selector))) {
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
            }
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

      const dispatchTextEvents = (element, data = TEXT) => {
        const win = element?.ownerDocument?.defaultView || window;
        try {
          element.dispatchEvent(new win.InputEvent("input", {
            bubbles: true,
            composed: true,
            data,
            inputType: "insertText"
          }));
        } catch (_error) {
          element.dispatchEvent(new win.Event("input", { bubbles: true }));
        }
        element.dispatchEvent(new win.Event("change", { bubbles: true }));
      };

      const isTextLikeInput = (element) => {
        const win = element?.ownerDocument?.defaultView || window;
        if (!(element instanceof win.HTMLInputElement)) return false;
        const type = String(element.getAttribute("type") || element.type || "text").toLowerCase();
        return [
          "",
          "email",
          "number",
          "password",
          "search",
          "tel",
          "text",
          "url"
        ].includes(type);
      };

      const hasSingleCharacterLimit = (element) =>
        element.maxLength === 1 || element.getAttribute("maxlength") === "1";

      const hasSegmentPositionHint = (element) => {
        const label = [
          element.getAttribute("aria-label"),
          element.getAttribute("name"),
          element.getAttribute("id"),
          element.getAttribute("placeholder")
        ].filter(Boolean).join(" ").toLowerCase();
        return /\\b(?:code|digit|character|char)\\b.*\\b\\d+\\b/.test(label)
          || /\\b\\d+\\b.*\\b(?:code|digit|character|char)\\b/.test(label)
          || /\\b\\d+\\s*(?:of|\\/)\\s*\\d+\\b/.test(label);
      };

      const isSingleCharacterSegmentInput = (element) =>
        isTextLikeInput(element)
        && (hasSingleCharacterLimit(element) || hasSegmentPositionHint(element));

      const inputCenterY = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.top + rect.height / 2;
      };

      const sameSegmentGroup = (targetInput, candidate) => {
        if (candidate.ownerDocument !== targetInput.ownerDocument) return false;
        if (targetInput.form !== null || candidate.form !== null) {
          return candidate.form === targetInput.form;
        }
        const targetRect = targetInput.getBoundingClientRect();
        return Math.abs(inputCenterY(candidate) - inputCenterY(targetInput))
          <= Math.max(36, targetRect.height * 1.75);
      };

      const maybeInsertSegmentedText = (targetInput) => {
        const win = targetInput?.ownerDocument?.defaultView || window;
        if (!(targetInput instanceof win.HTMLInputElement)) return null;
        const segmentText = TEXT.replace(/[\\s-]+/g, "");
        if (segmentText.length <= 1 || !isSingleCharacterSegmentInput(targetInput)) {
          return null;
        }

        const seenInputs = new Set();
        const candidates = [];
        for (const item of collectCandidates()) {
          const editable = editableNear(item.element);
          if (
            editable instanceof win.HTMLInputElement
            && !seenInputs.has(editable)
            && isSingleCharacterSegmentInput(editable)
            && sameSegmentGroup(targetInput, editable)
          ) {
            seenInputs.add(editable);
            candidates.push(editable);
          }
        }
        const startIndex = candidates.indexOf(targetInput);
        if (startIndex < 0) return null;
        const segmentTargets = candidates.slice(startIndex, startIndex + segmentText.length);
        if (segmentTargets.length < segmentText.length) {
          if (!hasSingleCharacterLimit(targetInput)) {
            return null;
          }
          return {
            ok: false,
            errorKind: "segmented_input_too_short",
            message: "Only found " + segmentTargets.length
              + " segmented input fields for " + segmentText.length + " characters."
          };
        }

        const beforeValues = segmentTargets.map((input) => input.value);
        for (let index = 0; index < segmentTargets.length; index += 1) {
          const input = segmentTargets[index];
          const char = segmentText[index];
          input.focus({ preventScroll: true });
          if (typeof input.setRangeText === "function") {
            input.setRangeText(char, 0, input.value.length, "end");
          } else {
            input.value = char;
          }
          dispatchTextEvents(input, char);
        }
        segmentTargets.at(-1)?.focus({ preventScroll: true });
        const afterValues = segmentTargets.map((input) => input.value);
        return {
          ok: afterValues.join("") === segmentText,
          method: "segmentedInput",
          tagName: "input",
          role: normalizeText(targetInput.getAttribute?.("role") || "", 40),
          textChanged: beforeValues.join("") !== afterValues.join(""),
          textPreview: normalizeText(afterValues.join(""), 120),
          segmentCount: segmentTargets.length
        };
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
        if (!CLEAR && before === TEXT) {
          return {
            ok: true,
            method: "alreadyMatched",
            tagName: String(target.tagName || "element").toLowerCase(),
            role: normalizeText(target.getAttribute?.("role") || "", 40),
            textChanged: false,
            textPreview: normalizeText(before, 120),
            alreadyMatched: true
          };
        }
        const segmented = maybeInsertSegmentedText(target);
        if (segmented !== null) {
          return segmented;
        }
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
    readonly textPreview?: string;
    readonly alreadyMatched?: boolean;
    readonly errorKind?: string;
    readonly message?: string;
  }> => {
    if (target.targetMode === "live") {
      assertSharedControlCanContinue(target.tabId);
    }
    const frame = findFrameInWebContents(target.webContents, element.frameTreeNodeId)
      ?? target.webContents.mainFrame;
    const { x, y } = centerOfAgentElement(element);
    const localPoint = element.localBounds === undefined
      ? {
          x: x - (element.frameBounds?.x ?? 0),
          y: y - (element.frameBounds?.y ?? 0)
        }
      : boundsCenter(element.localBounds);
    const raw = await runFrameScriptWithTimeout(
      () => frame.executeJavaScript(
        buildBrowserAgentTextInsertionScript({
          elementId: element.id,
          x: localPoint.x,
          y: localPoint.y,
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
      ...(typeof record.textPreview === "string" ? { textPreview: record.textPreview } : {}),
      ...(typeof record.alreadyMatched === "boolean" ? { alreadyMatched: record.alreadyMatched } : {}),
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
    request: WorkbenchBrowserAgentModeRequest & {
      readonly direction: WorkbenchBrowserAgentFocusDirection;
      readonly steps?: number;
      readonly restoreFocus?: boolean;
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserAgentFocusResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const direction = normalizeAgentFocusDirection(request.direction);
    const steps = normalizeAgentFocusSteps(direction, request.steps);
    const restoreFocus = request.restoreFocus ?? direction === "scan";
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "focus",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
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
      browserMode: target.browserMode,
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
    request: WorkbenchBrowserAgentModeRequest & {
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly interaction: WorkbenchBrowserAgentInteraction;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const verification = normalizeAgentVerification(request.verification);
    const { element, observationId, staleTarget } = await findAgentElement(
      tabId,
      {
        ...(request.elementId === undefined ? {} : { elementId: request.elementId }),
        ...(request.targetRef === undefined ? {} : { targetRef: request.targetRef })
      },
      target.targetMode,
      request.timeoutMs
    );
    if (element === null) {
      return staleElementResult(
        tabId,
          request.elementId,
          request.targetRef,
          target.targetMode,
          target.browserMode,
          observationId,
          staleTarget
      );
    }
    if (element.discoveryScope === "visual" && request.interaction !== "hover") {
      recordFollowAction(tabId, target.targetMode, "act", {
        visibleFollow: target.browserMode.visibleFollow,
        interaction: request.interaction,
        inputActive: false,
        result: "failure"
      });
      return {
        ok: false,
        kind: "lyraLumenActionResult",
        tabId,
        inputMode: "chromium",
        targetMode: target.targetMode,
        browserMode: target.browserMode,
        elementId: element.id,
        targetRef: element.targetRef,
        ...(observationId === undefined ? {} : { beforeObservationId: observationId }),
        nextRecommendedAction: "lyra_lumen.see",
        error: {
          kind: "visualFallbackRiskReviewRequired",
          message:
            "Visual fallback targets require an explicit risk review before clicking. Capture the page with lyra_lumen.see and use a point action with a concrete reason if the click is still appropriate."
        }
      };
    }

    const visibleTarget = await ensureAgentElementVisible({
      tabId,
      target,
      element,
      observationId,
      reason: "target_offscreen",
      block: "center",
      timeoutMs: request.timeoutMs
    });
    const interactionElement = visibleTarget.element ?? element;
    const autoScroll = visibleTarget.effect;
    const beforeUrl = agentTargetAddress(target);
    const beforeFocus = verification === "full"
      ? await readFocusedElementSignature(target, request.timeoutMs)
      : "";
    const { x, y } = centerOfAgentElement(interactionElement);
    const interaction = request.interaction;
    await performAgentPointerInteraction({
      tabId,
      target,
      x,
      y,
      interaction,
    });
    await delay(interaction === "hover" ? 40 : 30);

    const after = verification === "full"
      ? await observeAfterAgentInput(tabId, target.targetMode, request.timeoutMs)
      : null;
    if (isAgentEditableElement(interactionElement)) {
      cacheBrowserAgentInputTarget(
        tabId,
        target.targetMode,
        interactionElement,
        after?.url ?? agentTargetAddress(target),
        after?.observationId ?? observationId
      );
    }
    const afterFocus = verification === "full"
      ? await readFocusedElementSignature(target, request.timeoutMs)
      : "";
    const pageChanged = beforeUrl !== agentTargetAddress(target);
    const navigationStarted = agentTargetIsLoading(target);
    return {
      ok: true,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      elementId: interactionElement.id,
      targetRef: interactionElement.targetRef,
      x,
      y,
      verification,
      ...(observationId === undefined ? {} : { beforeObservationId: observationId }),
      ...(after === null ? {} : { afterObservationId: after.observationId }),
      ...(autoScroll === undefined ? {} : { autoScroll }),
      pageChanged,
      ...(verification === "full" ? { focusChanged: beforeFocus !== afterFocus } : {}),
      navigationStarted,
      message: `${interaction} sent to element ${interactionElement.id} (${interactionElement.targetRef}) with Chromium virtual input.`,
      nextRecommendedAction: nextRecommendedActionAfterAgentAction({ navigationStarted, pageChanged })
    };
  };

  const scrollAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly direction?: WorkbenchBrowserAgentScrollDirection;
      readonly amount?: number;
      readonly pages?: number;
      readonly block?: WorkbenchBrowserAgentScrollBlock;
      readonly behavior?: "instant" | "smooth";
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly point?: WorkbenchBrowserAgentPoint;
      readonly autoMap?: boolean;
      readonly timeoutMs?: number;
      readonly reason?: "explicit_scroll" | "ensure_visible";
    }
  ): Promise<WorkbenchBrowserAgentScrollResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const targetLocator = {
      ...(request.elementId === undefined ? {} : { elementId: request.elementId }),
      ...(request.targetRef === undefined ? {} : { targetRef: request.targetRef })
    };
    let point = request.point === undefined
      ? undefined
      : { x: Math.round(request.point.x), y: Math.round(request.point.y) };
    let element: WorkbenchBrowserAgentElement | undefined;
    let beforeObservationId: string | undefined;
    let autoScroll: WorkbenchBrowserAgentScrollEffect | undefined;
    const ensureReason: WorkbenchBrowserAgentScrollEffect["reason"] =
      request.reason === "ensure_visible" ? "ensure_visible" : "explicit_scroll";

    if (request.elementId !== undefined || request.targetRef !== undefined) {
      const found = await findAgentElement(
        tabId,
        targetLocator,
        target.targetMode,
        request.timeoutMs
      );
      beforeObservationId = found.observationId;
      if (found.element === null) {
        return {
          ok: false,
          kind: "lyraLumenScrollResult",
          tabId,
          inputMode: "chromium",
          targetMode: target.targetMode,
          browserMode: target.browserMode,
          ...(request.elementId === undefined ? {} : { elementId: request.elementId }),
          ...(request.targetRef === undefined ? {} : { targetRef: request.targetRef }),
          ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
          scrolled: false,
          method: "none",
          deltaX: 0,
          deltaY: 0,
          nextRecommendedAction: "lyra_lumen.map",
          error: {
            kind: found.staleTarget === undefined ? "staleElement" : "staleTarget",
            message: request.targetRef === undefined
              ? `Element ${request.elementId ?? "(unspecified)"} is not valid in the current browser observation.`
              : `Target ${request.targetRef} is not available in the current Lyra Lumen target registry.`
          }
        };
      }
      const visible = await ensureAgentElementVisible({
        tabId,
        target,
        element: found.element,
        observationId: found.observationId,
        reason: ensureReason,
        block: request.block,
        timeoutMs: request.timeoutMs
      });
      element = visible.element ?? found.element;
      point = visible.point ?? centerOfAgentElement(element);
      autoScroll = visible.effect;
      beforeObservationId = autoScroll?.beforeObservationId ?? beforeObservationId;
    } else if (point !== undefined) {
      const visible = await autoScrollPointIntoViewport({
        tabId,
        target,
        point,
        reason: request.reason === "ensure_visible" ? "ensure_visible" : "point_offscreen",
        block: request.block,
        timeoutMs: request.timeoutMs
      });
      point = visible.point ?? point;
      autoScroll = visible.effect;
    }

    let effect = autoScroll;
    if (
      request.direction !== undefined
      || (request.elementId === undefined && request.targetRef === undefined && request.point === undefined)
    ) {
      const viewport = await readAgentViewportState(target, request.timeoutMs);
      const scrollPoint = point ?? {
        x: Math.round(viewport.width * 0.5),
        y: Math.round(viewport.height * 0.5)
      };
      const direction = request.direction ?? "down";
      const { deltaX, deltaY } = scrollDeltaForDirection(
        direction,
        viewport,
        request.amount,
        request.pages
      );
      const explicitEffect = await scrollAgentViewportByDelta({
        tabId,
        target,
        deltaX,
        deltaY,
        point: scrollPoint,
        reason: "explicit_scroll",
        timeoutMs: request.timeoutMs
      });
      effect = {
        ...explicitEffect,
        ...(element === undefined ? {} : {
          targetRef: element.targetRef,
          elementId: element.id
        }),
        ...(beforeObservationId === undefined ? {} : { beforeObservationId })
      };
      point = explicitEffect.after;
    }

    let afterObservationId = effect?.afterObservationId;
    if (request.autoMap !== false && (effect?.scrolled === true || effect === undefined)) {
      const observed = await observeAgentPage(tabId, {
        strategy: "interactiveOnly",
        targetMode: target.targetMode,
        suppressActivity: true,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      }).catch(() => null);
      afterObservationId = observed?.observationId ?? afterObservationId;
    }

    const finalPoint = point ?? effect?.after ?? effect?.before;
    const scrolled = effect?.scrolled === true;
    return {
      ok: true,
      kind: "lyraLumenScrollResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      ...(request.direction === undefined ? {} : { direction: request.direction }),
      ...(request.amount === undefined ? {} : { amount: request.amount }),
      ...(request.pages === undefined ? {} : { pages: request.pages }),
      ...(finalPoint === undefined ? {} : { x: finalPoint.x, y: finalPoint.y }),
      ...(element === undefined ? {} : {
        elementId: element.id,
        targetRef: element.targetRef
      }),
      ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
      ...(afterObservationId === undefined ? {} : { afterObservationId }),
      scrolled,
      method: effect?.method ?? "none",
      deltaX: effect?.deltaX ?? 0,
      deltaY: effect?.deltaY ?? 0,
      ...(effect === undefined ? {} : { autoScroll: { ...effect, ...(afterObservationId === undefined ? {} : { afterObservationId }) } }),
      message: scrolled
        ? `Scrolled browser viewport by ${effect?.deltaX ?? 0}, ${effect?.deltaY ?? 0}.`
        : "Browser target was already visible or the page could not scroll further.",
      nextRecommendedAction:
        element !== undefined || request.point !== undefined ? "lyra_lumen.act" : "lyra_lumen.map"
    };
  };

  const actOnAgentPoint = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly point: WorkbenchBrowserAgentPoint;
      readonly interaction: WorkbenchBrowserAgentInteraction;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const verification = normalizeAgentVerification(request.verification);
    const beforeUrl = agentTargetAddress(target);
    const beforeFocus = verification === "full"
      ? await readFocusedElementSignature(target, request.timeoutMs)
      : "";
    const initialPoint = {
      x: Math.max(0, Math.round(request.point.x)),
      y: Math.max(0, Math.round(request.point.y))
    };
    const visiblePoint = await autoScrollPointIntoViewport({
      tabId,
      target,
      point: initialPoint,
      reason: "point_offscreen",
      block: "center",
      timeoutMs: request.timeoutMs
    });
    const x = Math.max(0, Math.round(visiblePoint.point?.x ?? initialPoint.x));
    const y = Math.max(0, Math.round(visiblePoint.point?.y ?? initialPoint.y));
    const autoScroll = visiblePoint.effect;
    const interaction = request.interaction;
    await performAgentPointerInteraction({
      tabId,
      target,
      x,
      y,
      interaction,
    });
    await delay(interaction === "hover" ? 40 : 30);

    const after = verification === "full"
      ? await observeAfterAgentInput(tabId, target.targetMode, request.timeoutMs)
      : null;
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
    const afterFocus = verification === "full"
      ? await readFocusedElementSignature(target, request.timeoutMs)
      : "";
    const pageChanged = beforeUrl !== agentTargetAddress(target);
    const navigationStarted = agentTargetIsLoading(target);
    return {
      ok: true,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      x,
      y,
      verification,
      ...(after === null ? {} : { afterObservationId: after.observationId }),
      ...(autoScroll === undefined ? {} : { autoScroll }),
      pageChanged,
      ...(verification === "full" ? { focusChanged: beforeFocus !== afterFocus } : {}),
      navigationStarted,
      message:
        `${interaction} sent to visual fallback point (${x}, ${y})` +
        (request.point.reason === undefined ? "." : `: ${request.point.reason}`),
      nextRecommendedAction: nextRecommendedActionAfterAgentAction({ navigationStarted, pageChanged })
    };
  };

  const typeIntoAgentElement = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly text: string;
      readonly clear?: boolean;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const verification = normalizeAgentVerification(request.verification);
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
        return staleElementResult(
          tabId,
          request.elementId,
          request.targetRef,
          target.targetMode,
          target.browserMode,
          found.observationId,
          found.staleTarget,
          "type"
        );
      }
      beforeObservationId = found.observationId ?? beforeObservationId;
      element = found.element;
    } else {
      const observed = await observeAgentPage(tabId, {
        strategy: "interactiveOnly",
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
      return noEditableTargetResult(tabId, target.targetMode, target.browserMode, beforeObservationId);
    }

    const visibleTarget = await ensureAgentElementVisible({
      tabId,
      target,
      element,
      observationId: beforeObservationId,
      reason: "target_offscreen",
      block: "center",
      timeoutMs: request.timeoutMs
    });
    element = visibleTarget.element ?? element;
    const autoScroll = visibleTarget.effect;
    const { x, y } = centerOfAgentElement(element);
    const beforeUrl = agentTargetAddress(target);
    const beforeFocus = verification === "full"
      ? await readFocusedElementSignature(target, request.timeoutMs)
      : "";
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
      visibleFollow: target.browserMode.visibleFollow,
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
      recordFollowAction(tabId, target.targetMode, "type", {
        visibleFollow: target.browserMode.visibleFollow,
        inputActive: false,
        result: "failure"
      });
      return {
        ok: false,
        kind: "lyraLumenActionResult",
        tabId,
        inputMode: "chromium",
        targetMode: target.targetMode,
        browserMode: target.browserMode,
        elementId: element.id,
        targetRef: element.targetRef,
        x,
        y,
        ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
        ...(autoScroll === undefined ? {} : { autoScroll }),
        nextRecommendedAction: "lyra_lumen.map",
        error: {
          kind: "insertFailed",
          message: String(error instanceof Error ? error.message : error)
        }
      };
    }
    if (insertion.ok !== true) {
      recordFollowAction(tabId, target.targetMode, "type", {
        visibleFollow: target.browserMode.visibleFollow,
        inputActive: false,
        result: "failure"
      });
      return {
        ok: false,
        kind: "lyraLumenActionResult",
        tabId,
        inputMode: "chromium",
        targetMode: target.targetMode,
        browserMode: target.browserMode,
        elementId: element.id,
        targetRef: element.targetRef,
        x,
        y,
        ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
        ...(autoScroll === undefined ? {} : { autoScroll }),
        nextRecommendedAction: "lyra_lumen.map",
        error: {
          kind: insertion.errorKind ?? "insertFailed",
          message: insertion.message ?? `Unable to insert text into editable element ${element.id}.`
        }
      };
    }

    await delay(30);
    const after = verification === "full"
      ? await observeAfterAgentInput(tabId, target.targetMode, request.timeoutMs)
      : null;
    cacheBrowserAgentInputTarget(
      tabId,
      target.targetMode,
      element,
      after?.url ?? currentUrl,
      after?.observationId ?? beforeObservationId
    );
    const afterFocus = verification === "full"
      ? await readFocusedElementSignature(target, request.timeoutMs)
      : "";
    const pageChanged = beforeUrl !== agentTargetAddress(target);
    const navigationStarted = agentTargetIsLoading(target);
    const inputValuePreview = insertion.textPreview;
    return {
      ok: true,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      elementId: element.id,
      targetRef: element.targetRef,
      x,
      y,
      verification,
      ...(inputValuePreview === undefined ? {} : { inputValuePreview }),
      ...(typeof insertion.textChanged === "boolean" ? { inputTextChanged: insertion.textChanged } : {}),
      ...(insertion.alreadyMatched === true ? { inputAlreadyMatched: true } : {}),
      ...(insertion.method === undefined ? {} : { inputInsertionMethod: insertion.method }),
      ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
      ...(after === null ? {} : { afterObservationId: after.observationId }),
      ...(autoScroll === undefined ? {} : { autoScroll }),
      pageChanged,
      ...(verification === "full" ? { focusChanged: beforeFocus !== afterFocus } : {}),
      navigationStarted,
      message:
        insertion.alreadyMatched === true
          ? `Editable element ${element.id} already contained the requested text.`
          : `Typed into editable element ${element.id}` +
            (insertion.method === undefined ? "." : ` via ${insertion.method}.`),
      nextRecommendedAction: nextRecommendedActionAfterAgentAction({ navigationStarted, pageChanged })
    };
  };

  const pressAgentKey = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly key: string;
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const verification = normalizeAgentVerification(request.verification);
    let beforeObservationId = browserAgentCache.get(browserAgentCacheKey(tabId, target.targetMode))?.observationId;
    let elementId = request.elementId;
    let targetRef = request.targetRef;
    let x: number | undefined;
    let y: number | undefined;
    let autoScroll: WorkbenchBrowserAgentScrollEffect | undefined;
    if (elementId !== undefined || targetRef !== undefined) {
      const focused = await actOnAgentElement(tabId, {
        ...(elementId === undefined ? {} : { elementId }),
        ...(targetRef === undefined ? {} : { targetRef }),
        interaction: "click",
        targetMode: target.targetMode,
        visibleFollow: target.browserMode.visibleFollow,
        authState: target.browserMode.authState === "borrowedLiveLogin" ? "borrowLiveLogin" : "none",
        useLiveLoginState: target.browserMode.authState === "borrowedLiveLogin",
        verification: "none",
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      });
      if (focused.ok === false) {
        recordFollowAction(tabId, target.targetMode, "press", {
          visibleFollow: target.browserMode.visibleFollow,
          inputActive: false,
          result: "failure"
        });
        return focused;
      }
      beforeObservationId = focused.beforeObservationId;
      elementId = focused.elementId;
      targetRef = focused.targetRef;
      x = focused.x;
      y = focused.y;
      autoScroll = focused.autoScroll;
    }
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "press",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      ...(x === undefined || y === undefined ? {} : { cursor: { x, y } }),
      durationMs: 1_550
    });
    const beforeUrl = agentTargetAddress(target);
    const beforeFocus = verification === "full"
      ? await readFocusedElementSignature(target, request.timeoutMs)
      : "";
    target.webContents.focus();
    sendAgentInputEvent(target, { type: "keyDown", keyCode: request.key });
    if (request.key.length === 1) {
      sendAgentInputEvent(target, { type: "char", keyCode: request.key });
    }
    sendAgentInputEvent(target, { type: "keyUp", keyCode: request.key });
    await delay(30);
    const after = verification === "full"
      ? await observeAfterAgentInput(tabId, target.targetMode, request.timeoutMs)
      : null;
    const afterFocus = verification === "full"
      ? await readFocusedElementSignature(target, request.timeoutMs)
      : "";
    const pageChanged = beforeUrl !== agentTargetAddress(target);
    const navigationStarted = agentTargetIsLoading(target);
    return {
      ok: true,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      ...(elementId === undefined ? {} : { elementId }),
      ...(targetRef === undefined ? {} : { targetRef }),
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
      ...(autoScroll === undefined ? {} : { autoScroll }),
      verification,
      ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
      ...(after === null ? {} : { afterObservationId: after.observationId }),
      pageChanged,
      ...(verification === "full" ? { focusChanged: beforeFocus !== afterFocus } : {}),
      navigationStarted,
      message: `Pressed ${request.key} with Chromium virtual keyboard.`,
      nextRecommendedAction: nextRecommendedActionAfterAgentAction({ navigationStarted, pageChanged })
    };
  };

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
    await waitForAgentPageLoad(shadow.webContents, address, request.timeoutMs ?? 8_000);
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

  const pageFindTargetForAgentTarget = (target: BrowserAgentPageTarget): BrowserPageFindTarget => ({
    tabId: target.tabId,
    webContents: target.webContents,
    address: agentTargetAddress(target),
    title: agentTargetTitle(target)
  });

  const readAgentPlainTextForLocate = async (
    target: BrowserAgentPageTarget,
    timeoutMs: number | undefined
  ): Promise<{
    readonly title: string;
    readonly text: string;
  }> => {
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
          return {
            title: normalizeText(document.title ?? ""),
            text: normalizeText(document.body?.innerText ?? document.body?.textContent ?? "")
          };
        })()
      `, true),
      normalizeExecuteScriptTimeoutMs(timeoutMs, 4_000)
    ) as Record<string, unknown>;
    return {
      title: typeof raw.title === "string" ? raw.title : agentTargetTitle(target),
      text: typeof raw.text === "string" ? raw.text : ""
    };
  };

  const distanceFromRectToElement = (
    rect: NonNullable<WorkbenchBrowserAgentFindResult["revealRect"]>,
    element: WorkbenchBrowserAgentElement
  ): number => {
    const centerX = element.bounds.x + element.bounds.width / 2;
    const centerY = element.bounds.y + element.bounds.height / 2;
    const rectCenterX = (rect.left + rect.right) / 2;
    const rectCenterY = (rect.top + rect.bottom) / 2;
    const verticalGap = centerY < rect.top ? rect.top - centerY : centerY > rect.bottom ? centerY - rect.bottom : 0;
    return verticalGap * 3 + Math.hypot(centerX - rectCenterX, centerY - rectCenterY);
  };

  const nearbyElementsFromObservation = (
    observation: WorkbenchBrowserAgentObservation,
    revealRect: WorkbenchBrowserAgentFindResult["revealRect"],
    limit: number
  ): readonly WorkbenchBrowserAgentElement[] => {
    const elements = observation.elements
      .filter((element) => element.disabled !== true)
      .filter((element) => element.actionCapabilities?.length !== 0);
    const sorted = revealRect === undefined
      ? elements
      : [...elements].sort((left, right) =>
          distanceFromRectToElement(revealRect, left) - distanceFromRectToElement(revealRect, right)
        );
    return sorted.slice(0, Math.max(1, Math.min(20, Math.round(limit))));
  };

  const findAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & WorkbenchBrowserSearchInPageRequest & {
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserAgentFindResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "read",
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: 1_200
    });
    const result = await performSearchInPage(pageFindTargetForAgentTarget(target), request);
    const { revealRect, ...baseResult } = result;
    return {
      ok: true,
      kind: "lyraLumenFind",
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      ...baseResult,
      ...(revealRect === undefined ? {} : { revealRect }),
      nextRecommendedAction: "lyra_lumen.map"
    };
  };

  const locateAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly query: string;
      readonly matchMode?: "exact" | "semantic";
      readonly autoMap?: boolean;
      readonly nearbyLimit?: number;
      readonly reveal?: boolean;
      readonly caseSensitive?: boolean;
      readonly maxMatches?: number;
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserAgentLocateResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const query = request.query.trim();
    const matchMode = request.matchMode === "exact" ? "exact" : "semantic";
    const pageText = await readAgentPlainTextForLocate(target, request.timeoutMs);
    const semantic = matchMode === "semantic"
      ? selectSemanticLocateCandidate(pageText.text, query)
      : null;
    const anchorQuery = matchMode === "exact" ? query : semantic?.anchorQuery;
    if (anchorQuery === undefined || anchorQuery.trim().length === 0) {
      return {
        ok: true,
        kind: "lyraLumenLocate",
        tabId,
        address: normalizeAddress(target.webContents.getURL()) ?? agentTargetAddress(target),
        title: pageText.title,
        targetMode: target.targetMode,
        browserMode: target.browserMode,
        matched: false,
        matchMode,
        query,
        nextRecommendedAction: "lyra_lumen.read"
      };
    }
    const findResult = await findAgentPage(tabId, {
      ...request,
      query: anchorQuery,
      direction: "current",
      reveal: request.reveal !== false,
      maxMatches: request.maxMatches ?? 20
    });
    const matched = findResult.totalMatches > 0;
    let observation: WorkbenchBrowserAgentObservation | null = null;
    let nearbyElements: readonly WorkbenchBrowserAgentElement[] | undefined;
    if (matched && request.autoMap !== false) {
      observation = await observeAgentPage(tabId, {
        strategy: "interactiveOnly",
        targetMode: target.targetMode,
        suppressActivity: true,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      });
      nearbyElements = nearbyElementsFromObservation(
        observation,
        findResult.revealRect,
        request.nearbyLimit ?? 8
      );
    }
    return {
      ok: true,
      kind: "lyraLumenLocate",
      tabId,
      address: findResult.address,
      title: findResult.title,
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      matched,
      matchMode,
      query,
      anchorQuery,
      ...(semantic === null ? {} : {
        semanticScore: semantic.score,
        semanticReason: semantic.reason
      }),
      findResult,
      ...(observation === null ? {} : { observationId: observation.observationId }),
      ...(nearbyElements === undefined ? {} : { nearbyElements }),
      nextRecommendedAction:
        matched === false
          ? "lyra_lumen.read"
          : nearbyElements !== undefined && nearbyElements.length > 0 ? "lyra_lumen.act" : "lyra_lumen.map"
    };
  };

  const captureAgentPage = async (
    tabId: string,
    request?: WorkbenchBrowserAgentModeRequest
  ): Promise<WorkbenchVisualCaptureResult & {
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly browserMode?: WorkbenchBrowserAgentModeInfo;
  }> => {
    const target = await resolveBrowserAgentTarget(tabId, request, undefined);
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "capture",
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: 1_500
    });
    if (target.targetMode === "live") {
      return {
        ...(await capturePage(tabId)),
        targetMode: "live",
        browserMode: target.browserMode
      };
    }
    const image = await target.webContents.capturePage();
    const size = image.getSize();
    return {
      tabId,
      targetMode: target.targetMode,
      browserMode: target.browserMode,
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
    const shadow = browserAgentShadows.get(tabId);
    if (shadow === undefined || shadow.webContents.isDestroyed()) {
      return null;
    }
    return {
      address: normalizeAddress(shadow.webContents.getURL()) ?? shadow.address,
      title: normalizeString(shadow.webContents.getTitle()) ?? shadow.title,
      isLoading: shadow.isLoading
    };
  };

  const readAgentFollowAudit: WorkbenchBrowserViewManager["readAgentFollowAudit"] = async (
    tabId,
    request
  ) => {
    const requestedTargetMode = request?.targetMode ?? "live";
    const session = request?.sessionId === undefined
      ? followSessions.get(followSessionKey(tabId, requestedTargetMode)) ?? null
      : [...followSessions.values()].find((entry) => entry.sessionId === request.sessionId) ?? null;
    const targetMode = session?.targetMode ?? requestedTargetMode;
    if (session !== null && session.turnId === null && request?.turnId !== undefined) {
      session.turnId = request.turnId;
    }
    const maxActions = Math.max(1, Math.min(400, Math.round(request?.maxActions ?? 80)));
    const finalPageState = readAgentFollowFinalPageState(tabId, targetMode);
    const compact = compactFollowSession({
      actions: session?.actions ?? [],
      interruptedCount: session?.interruptedCount ?? 0,
      finalPageState
    }, { maxActions });
    const frames = request?.includeFrames === true ? session?.frames.slice(-maxActions * 2) ?? [] : undefined;
    return {
      ok: true,
      kind: "lyraLumenFollowAudit",
      tabId,
      targetMode,
      sessionId: session?.sessionId ?? null,
      turnId: session?.turnId ?? request?.turnId ?? null,
      startedAt: session?.startedAt ?? null,
      endedAt: session?.endedAt ?? null,
      updatedAt: session?.updatedAt ?? null,
      status: session?.status ?? null,
      reason: session?.reason ?? null,
      totalActions: session?.totalActions ?? 0,
      actions: compact.actions,
      ...(frames === undefined ? {} : { frames }),
      finalPageState,
      compactSummary: compact.compactSummary,
      compactText: compact.compactText,
      chunks: compact.chunks
    };
  };

  const finishAgentFollowSessions: WorkbenchBrowserViewManager["finishAgentFollowSessions"] = (
    request
  ) => {
    const endedAt = Date.now();
    for (const session of followSessions.values()) {
      if (session.status !== "running") {
        continue;
      }
      if (request.turnId !== undefined && session.turnId !== null && session.turnId !== request.turnId) {
        continue;
      }
      if (session.turnId === null && request.turnId !== undefined) {
        session.turnId = request.turnId;
      }
      session.status = request.status;
      session.endedAt = endedAt;
      session.updatedAt = endedAt;
      session.reason = request.reason ?? null;
    }
  };

  const explainAgentTargetRef: WorkbenchBrowserViewManager["explainAgentTargetRef"] = async (
    tabId,
    request
  ) => {
    const targetMode = request.targetMode ?? "live";
    return lumenTargetRegistry.explainTargetRef({
      tabId,
      targetMode,
      targetRef: request.targetRef,
      ...(request.maxCandidates === undefined ? {} : { maxCandidates: request.maxCandidates })
    });
  };

  const auditAgentPageDiagnostics: WorkbenchBrowserViewManager["auditAgentPageDiagnostics"] = async (
    tabId,
    request
  ) => {
    const target = await resolveBrowserAgentTarget(tabId, request, undefined);
    const maxEntries = Math.max(1, Math.min(300, Math.round(request?.maxEntries ?? 80)));
    const cdpSession = ensureCdpAuditSessionForTarget(target);
    const cdpSnapshot = await cdpSession.readDiagnostics({
      ...(request as CdpAuditSessionReadRequest | undefined),
      maxEntries
    });
    const buffered = pageDiagnostics.get(tabId) ?? [];
    const entriesForResult = filterBrowserDiagnostics(buffered, {
      ...(request as CdpAuditSessionReadRequest | undefined),
      maxEntries
    });
    const summary = buildBrowserDiagnosticsSummary(entriesForResult);
    const evidenceRefs = entriesForResult
      .filter((entry) =>
        entry.severity === "error"
        || entry.stackTruncated === true
        || entry.responseBody !== undefined
      )
      .map((entry) => entry.evidenceRef ?? entry.id)
      .slice(0, 40);
    return {
      ok: true,
      kind: "lyraLumenPageDiagnostics",
      tabId,
      targetMode: target.targetMode,
      address: agentTargetAddress(target),
      title: agentTargetTitle(target),
      available: cdpSnapshot.available,
      ...(cdpSnapshot.unavailableReason === undefined
        ? {}
        : { unavailableReason: cdpSnapshot.unavailableReason }),
      entries: entriesForResult,
      diagnostics: entriesForResult,
      summary,
      recommendedNextAction: recommendBrowserDiagnosticAction(summary, cdpSnapshot.available),
      evidenceRefs
    };
  };

  const elevateAgentPage: WorkbenchBrowserViewManager["elevateAgentPage"] = async (
    tabId,
    request
  ) => {
    const target = await resolveBrowserAgentTarget(
      tabId,
      { ...request, targetMode: request?.targetMode ?? "isolated" },
      undefined
    );
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
    const liveTabId = `browser-elevated-${hashStableString(`${tabId}:${Date.now()}`)}`;
    const elevationSession: WorkbenchBrowserElevationSession = {
      sessionId: `elevation-${tabId}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      isolatedTarget: {
        tabId,
        address,
        title
      },
      liveTabId,
      storageRelation: "shared_default_session",
      startedAt: Date.now(),
      updatedAt: Date.now(),
      status: "awaiting_user",
      cloneStrategy: "storage_preserving_foreground_clone",
      differences: [
        "electron_webcontents_handle_not_reattached",
        "visible_tab_uses_shared_session_storage_clone"
      ],
      ...(typeof request?.reason === "string" && request.reason.length > 0
        ? { reason: request.reason }
        : {})
    };
    elevationSessions.set(elevationSession.sessionId, elevationSession);
    elevationSessionByIsolatedTabId.set(tabId, elevationSession.sessionId);
    publishEvent({
      kind: "request-open-tab",
      address,
      title,
      tabId: liveTabId
    });
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "navigate",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: 2_000
    });
    return {
      ok: true,
      kind: "lyraLumenElevation",
      tabId,
      targetMode: target.targetMode,
      liveTabId,
      address,
      title,
      userActionRequired: true,
      elevationSession,
      message:
        "Lyra opened the isolated browser state in a visible tab so the user can complete CAPTCHA, OAuth, MFA, or another auth wall."
    };
  };

  const completeElevationSession: WorkbenchBrowserViewManager["completeElevationSession"] = async (
    tabId,
    request
  ) => {
    const sessionId =
      request?.elevationSessionId
      ?? elevationSessionByIsolatedTabId.get(tabId)
      ?? [...elevationSessions.values()].find((entry) => entry.liveTabId === request?.liveTabId)?.sessionId;
    const existing = sessionId === undefined ? undefined : elevationSessions.get(sessionId);
    if (existing === undefined) {
      return {
        ok: false,
        kind: "lyraLumenElevationCompletion",
        tabId,
        targetMode: "isolated",
        liveTabId: request?.liveTabId ?? "",
        address: "",
        title: "",
        verified: false,
        message: "No active browser elevation session was found."
      };
    }
    const liveEntry = entries.get(request?.liveTabId ?? existing.liveTabId);
    const liveAddress = liveEntry === undefined
      ? existing.isolatedTarget.address
      : normalizeAddress(liveEntry.webContents.getURL()) ?? liveEntry.runtime.address;
    const liveTitle = liveEntry === undefined
      ? existing.isolatedTarget.title
      : normalizeString(liveEntry.webContents.getTitle()) ?? liveEntry.runtime.title;
    const verifyingSession: WorkbenchBrowserElevationSession = {
      ...existing,
      updatedAt: Date.now(),
      status: "verifying"
    };
    elevationSessions.set(existing.sessionId, verifyingSession);
    const target = await resolveBrowserAgentTarget(tabId, "isolated", request?.timeoutMs);
    await waitForAgentPageLoad(target.webContents, liveAddress, request?.timeoutMs ?? 8_000);
    const observation = await observeAgentPage(tabId, {
      targetMode: "isolated",
      strategy: "hybrid",
      suppressActivity: true,
      ...(request?.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
    });
    const remainingSignals = observation.authChallengeSignals?.filter((signal) =>
      signal.confidence === "high"
    ) ?? [];
    const verified = remainingSignals.length === 0;
    const completedSession: WorkbenchBrowserElevationSession = {
      ...verifyingSession,
      updatedAt: Date.now(),
      status: verified ? "completed" : "awaiting_user"
    };
    elevationSessions.set(existing.sessionId, completedSession);
    return {
      ok: verified,
      kind: "lyraLumenElevationCompletion",
      tabId,
      targetMode: "isolated",
      liveTabId: existing.liveTabId,
      address: liveAddress,
      title: liveTitle,
      verified,
      ...(remainingSignals.length === 0 ? {} : { authChallengeSignals: remainingSignals }),
      elevationSession: completedSession,
      message: verified
        ? "Lyra verified the auth challenge is no longer present and refreshed the isolated browser state."
        : "The visible tab still appears to require user action before Lyra can continue."
    };
  };

  const resolveSharedControlDecision: WorkbenchBrowserViewManager["resolveSharedControlDecision"] = async (
    tabId,
    request
  ) => {
    const session = ensureFollowSession(tabId, "live");
    const current = sharedControlForTab(tabId, session.sessionId);
    if (request.decision !== "continue_agent") {
      const pausedSnapshot: SharedControlSnapshot = {
        ...current,
        state: "awaiting_user_decision",
        criticalInput: false,
        updatedAt: Date.now()
      };
      applySharedControlTransition(
        {
          snapshot: pausedSnapshot,
          previousState: current.state,
          changed: current.state !== pausedSnapshot.state
        },
        "decision"
      );
      session.status = request.decision === "cancel_task" ? "cancelled" : "interrupted";
      session.reason = request.decision;
      return {
        ok: true,
        tabId,
        decision: request.decision
      };
    }
    const transition = transitionSharedControlForDecision(
      current,
      request.decision as SharedControlDecision
    );
    applySharedControlTransition(transition, "decision");
    lastControlHandoffByTabId.delete(tabId);
    session.status = "running";
    session.reason = null;
    scheduleSharedControlIdle(tabId, 900);
    return {
      ok: true,
      tabId,
      decision: request.decision
    };
  };

  const readSessionSnapshot = (): BrowserSessionSnapshot | null => persistBrowserSessionSnapshot();

  const readStorageState = async (
    request?: WorkbenchBrowserStorageStateRequest
  ): Promise<BrowserStorageStateRef> => {
    const profileMode = request?.profileMode === "isolated" ? "isolated" : "live";
    const targetTabId = normalizeString(request?.tabId) ?? getActiveOrFocusedTabId();
    const entry = targetTabId === null ? null : entries.get(targetTabId) ?? null;
    const origin = normalizeWebOrigin(request?.origin) ?? (
      entry === null ? null : normalizeWebOrigin(entry.runtime.address)
    );
    const electronSession = profileMode === "isolated"
      ? isolatedElectronSession()
      : (entry?.webContents.session ?? liveElectronSession());
    const site = origin === null || entry === null
      ? undefined
      : await readPageStorageAvailability(entry);
    const cookieCount = origin === null
      ? undefined
      : await electronSession.cookies
          .get({ url: origin })
          .then((cookies) => cookies.length)
          .catch(() => undefined);
    const sites = site === undefined
      ? []
      : [{
          ...site,
          ...(cookieCount === undefined ? {} : { cookieCount })
        }];
    return {
      ...createBrowserStorageStateRef({
        profileMode,
        profilePartition:
          profileMode === "isolated"
            ? WORKBENCH_BROWSER_ISOLATED_PROFILE_PARTITION
            : WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION,
        chromiumStoragePath: sessionStoragePath(electronSession),
        sites
      }),
      cookies: {
        availability:
          cookieCount === undefined
            ? "unknown"
            : cookieCount > 0 ? "available" : "unavailable",
        manifestOnly: true,
        ...(cookieCount === undefined ? {} : { count: cookieCount })
      },
      localStorage: {
        availability: site?.localStorage ?? "unknown",
        manifestOnly: true
      },
      sessionStorage: {
        availability: site?.sessionStorage ?? "unknown",
        manifestOnly: true
      },
      indexedDB: {
        availability: site?.indexedDB ?? "unknown",
        manifestOnly: true
      },
      cacheStorage: {
        availability: "unknown",
        manifestOnly: true
      }
    };
  };

  const clearSiteData = async (
    request: WorkbenchBrowserClearSiteDataRequest
  ): Promise<WorkbenchBrowserClearSiteDataResult> => {
    const targetTabId = normalizeString(request?.tabId) ?? getActiveOrFocusedTabId();
    const targetEntry = targetTabId === null ? null : entries.get(targetTabId) ?? null;
    const origin =
      normalizeWebOrigin(request?.origin) ??
      (targetEntry === null ? null : normalizeWebOrigin(targetEntry.runtime.address));
    if (origin === null) {
      throw new Error("origin or tabId is required");
    }
    const modes = request?.profileMode === "live"
      ? ["live"] as const
      : request?.profileMode === "isolated"
        ? ["isolated"] as const
        : ["live", "isolated"] as const;
    const sessions = modes.map((mode) => (
      mode === "isolated" ? isolatedElectronSession() : liveElectronSession()
    ));
    let cookiesRemoved = 0;
    let storageCleared = false;
    for (const electronSession of sessions) {
      const cookies = await electronSession.cookies.get({ url: origin }).catch(() => []);
      for (const cookie of cookies) {
        await electronSession.cookies.remove(origin, cookie.name)
          .then(() => {
            cookiesRemoved += 1;
          })
          .catch(() => undefined);
      }
      await electronSession.clearStorageData({
        origin,
        storages: [
          "cookies",
          "localstorage",
          "indexdb",
          "cachestorage",
          "serviceworkers",
          "websql"
        ]
      }).then(() => {
        storageCleared = true;
      }).catch(() => undefined);
    }
    const clearedStorage: BrowserSiteStorageAvailability = {
      origin,
      cookieCount: 0,
      localStorage: "unavailable",
      sessionStorage: "unavailable",
      indexedDB: "unavailable",
      capturedAt: Date.now()
    };
    for (const entry of entries.values()) {
      if (normalizeWebOrigin(entry.runtime.address) !== origin) {
        continue;
      }
      invalidateBrowserAgentTargets(entry.tabId, "live", "navigation");
      invalidateBrowserAgentTargets(entry.tabId, "isolated", "navigation");
      const restoreState = sanitizeBrowserPageRestoreState({
        ...(entry.runtime.restoreState ?? { capturedAt: Date.now() }),
        storage: clearedStorage,
        targetRegistry: {
          warmed: false,
          capturedAt: Date.now()
        },
        capturedAt: Date.now()
      });
      if (restoreState !== undefined) {
        browserSessionSnapshots.set(entry.tabId, restoreState);
        updateRuntimeState(entry, { restoreState });
      }
    }
    const snapshot = persistBrowserSessionSnapshot();
    return {
      ok: true,
      origin,
      profilePartitions: modes.map((mode) => (
        mode === "isolated"
          ? WORKBENCH_BROWSER_ISOLATED_PROFILE_PARTITION
          : WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION
      )),
      cookiesRemoved,
      storageCleared,
      snapshot
    };
  };

  return {
    dispose: () => {
      void elementPickerController.dispose();
      for (const session of cdpAuditSessions.values()) {
        void session.dispose().catch(() => undefined);
      }
      cdpAuditSessions.clear();
      for (const session of debuggerSessions.values()) {
        void session.dispose().catch(() => undefined);
      }
      debuggerSessions.clear();
      webThemeInjector.dispose();
      for (const timer of tombstoneTimers.values()) {
        clearTimeout(timer);
      }
      tombstoneTimers.clear();
      browserSessionRuntime.dispose();
      for (const entry of entries.values()) {
        destroyEntry(entry, false);
      }
      for (const tabId of [...browserAgentShadows.keys()]) {
        destroyBrowserAgentShadow(tabId);
      }
      browserAgentInputTargets.clear();
      browserAgentCache.clear();
      pendingRestoreValidations.clear();
      lumenTargetRegistry.clear();
      followSessions.clear();
      pageDiagnostics.clear();
      agentSyntheticInputUntil.clear();
      userInputDirtyTabs.clear();
      for (const timer of sharedControlTimers.values()) {
        clearTimeout(timer);
      }
      sharedControlTimers.clear();
      sharedControlStates.clear();
      lastControlHandoffByTabId.clear();
      elevationSessions.clear();
      elevationSessionByIsolatedTabId.clear();
      chromePopoverRuntime.dispose();
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
      await chromePopoverRuntime.reapplyActivePopovers();
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
    readSessionSnapshot,
    readStorageState,
    clearSiteData,
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
      return await openDebuggerSessionForTarget(liveAgentTarget(entry));
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
      // Each parent frame resolves the child frame through the shared owner matcher used by semantic maps.
      try {
        let currentFrame = targetFrame;
        let accumulatedX = 0;
        let accumulatedY = 0;
        let boundsWidth = 0;
        let boundsHeight = 0;
        let firstIteration = true;
        const ownerScript = buildBrowserAgentFrameOwnerProbeScript();
        while (currentFrame.parent !== null && !currentFrame.parent.isDestroyed()) {
          const parentFrame = currentFrame.parent;
          const raw = await parentFrame.executeJavaScript(ownerScript, false);
          const probed = coerceFrameOwnerCandidates(raw);
          const matches = matchFrameOwnerCandidates(parentFrame, probed.candidates);
          const owner = matches.get(currentFrame.frameTreeNodeId);
          const siblingOrdinal = parentFrame.frames.findIndex(
            (frame) => frame.frameTreeNodeId === currentFrame.frameTreeNodeId
          );
          if (
            owner === undefined
            || siblingOrdinal < 0
            || scoreFrameOwnerCandidate(currentFrame, owner, siblingOrdinal) <= 0
          ) {
            return null;
          }
          accumulatedX += owner.bounds.x;
          accumulatedY += owner.bounds.y;
          if (firstIteration) {
            boundsWidth = owner.bounds.width;
            boundsHeight = owner.bounds.height;
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
    scrollAgentPage,
    typeIntoAgentElement,
    pressAgentKey,
    navigateAgentPage,
    readAgentPage,
    findAgentPage,
    locateAgentPage,
    captureAgentPage,
    showAgentActivity,
    readAgentFollowAudit,
    finishAgentFollowSessions,
    explainAgentTargetRef,
    auditAgentPageDiagnostics,
    elevateAgentPage,
    completeElevationSession,
    resolveSharedControlDecision
  };
};
