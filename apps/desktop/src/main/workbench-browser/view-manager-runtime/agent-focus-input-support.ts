import type { WorkbenchLumenStaleTarget } from "../../../shared/desktop-bridge";
import type {
  BrowserActionEffect,
  WorkbenchBrowserAgentActionResult,
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentFocusDirection,
  WorkbenchBrowserAgentModeInfo,
  WorkbenchBrowserAgentModeRequest,
  WorkbenchBrowserAgentObservation,
  WorkbenchBrowserAgentScrollEffect,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserAgentVerification
} from "../types";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import type { BrowserAgentStateStore } from "./agent-state-store";
import type { BrowserAgentAutoScrollResult, BrowserAgentPageTarget } from "./types";

type FindAgentElement = (
  tabId: string,
  request: { readonly elementId?: number; readonly targetRef?: string },
  targetMode: WorkbenchBrowserAgentTargetMode,
  timeoutMs: number | undefined
) => Promise<{
  readonly element: WorkbenchBrowserAgentElement | null;
  readonly observationId?: string;
  readonly staleTarget?: WorkbenchLumenStaleTarget;
}>;

export type BrowserAgentFocusInputControllerDeps = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "assertSharedControlCanContinue"
  | "findFrameInWebContents"
  | "publishBrowserAgentActivity"
  | "recordFollowAction"
  | "resolveBrowserAgentTarget"
  | "sendAgentInputEvent"
> & {
  readonly actOnAgentElement: (tabId: string, request: WorkbenchBrowserAgentModeRequest & { readonly elementId?: number; readonly targetRef?: string; readonly effect?: BrowserActionEffect; readonly interaction: import("../types").WorkbenchBrowserAgentInteraction; readonly timeoutMs?: number; readonly verification?: WorkbenchBrowserAgentVerification }) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly ensureAgentElementVisible: (request: { readonly tabId: string; readonly target: BrowserAgentPageTarget; readonly element: WorkbenchBrowserAgentElement; readonly observationId: string | undefined; readonly reason: WorkbenchBrowserAgentScrollEffect["reason"]; readonly block: import("../types").WorkbenchBrowserAgentScrollBlock | undefined; readonly timeoutMs: number | undefined }) => Promise<BrowserAgentAutoScrollResult>;
  readonly findAgentElement: FindAgentElement;
  readonly nextRecommendedActionAfterAgentAction: (request: { readonly navigationStarted: boolean; readonly pageChanged: boolean }) => string;
  readonly observeAfterAgentInput: (tabId: string, targetMode: WorkbenchBrowserAgentTargetMode, timeoutMs: number | undefined) => Promise<WorkbenchBrowserAgentObservation | null>;
  readonly observeAgentPage: (tabId: string, request?: WorkbenchBrowserAgentModeRequest & { readonly strategy?: import("../types").WorkbenchBrowserAgentObserveStrategy; readonly timeoutMs?: number; readonly suppressActivity?: boolean }) => Promise<WorkbenchBrowserAgentObservation>;
  readonly performAgentPointerInteraction: (request: { readonly tabId: string; readonly target: BrowserAgentPageTarget; readonly x: number; readonly y: number; readonly interaction: import("../types").WorkbenchBrowserAgentInteraction }) => Promise<void>;
  readonly readFocusedElementSignature: (target: BrowserAgentPageTarget, timeoutMs: number | undefined) => Promise<string>;
  readonly staleElementResult: (tabId: string, elementId: number | undefined, targetRef: string | undefined, targetMode: WorkbenchBrowserAgentTargetMode, browserMode: WorkbenchBrowserAgentModeInfo | undefined, observationId?: string, staleTarget?: WorkbenchLumenStaleTarget, action?: import("../agent-cursor-overlay").BrowserAgentCursorOverlayAction) => WorkbenchBrowserAgentActionResult;
  readonly stateStore: BrowserAgentStateStore;
};

export const normalizeAgentFocusDirection = (
  direction: WorkbenchBrowserAgentFocusDirection | undefined
): WorkbenchBrowserAgentFocusDirection => {
  if (direction === "previous" || direction === "scan") {
    return direction;
  }
  return "next";
};

export const normalizeAgentFocusSteps = (
  direction: WorkbenchBrowserAgentFocusDirection,
  steps: number | undefined
): number => {
  const defaultSteps = direction === "scan" ? 12 : 1;
  const maxSteps = direction === "scan" ? 40 : 10;
  const value = Number.isFinite(Number(steps)) ? Math.round(Number(steps)) : defaultSteps;
  return Math.max(1, Math.min(value, maxSteps));
};
