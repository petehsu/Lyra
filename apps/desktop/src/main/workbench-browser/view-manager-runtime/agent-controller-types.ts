import type { WebFrameMain } from "electron";
import type {
  WorkbenchBrowserNavigateRequest,
  WorkbenchBrowserNavigateResult,
  WorkbenchBrowserPageRuntimeState,
  WorkbenchBrowserSearchInPageRequest,
  WorkbenchBrowserSearchInPageResult
} from "../../../shared/desktop-bridge";
import type { WorkbenchVisualCaptureResult } from "../../../shared/workbench-observation";
import type { BrowserAgentCursorOverlayAction } from "../agent-cursor-overlay";
import type {
  WorkbenchBrowserAgentInteraction,
  WorkbenchBrowserAgentModeRequest,
  WorkbenchBrowserAgentPoint,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserAgentVisualStaleResult,
  WorkbenchBrowserDebuggerSession,
  WorkbenchBrowserOsAxAdapter,
  WorkbenchBrowserPublishEvent
} from "../types";
import type {
  BrowserAgentPageTarget,
  BrowserAgentViewportState,
  BrowserPageEntry,
  BrowserPageFindRevealResult,
  BrowserPageFindTarget,
  BrowserAgentShadowEntry
} from "./types";

export type WorkbenchBrowserAgentControllerHost = {
  readonly entries: Map<string, BrowserPageEntry>;
  readonly rememberBrowserRestoreState: (
    tabId: string,
    restoreState: NonNullable<WorkbenchBrowserPageRuntimeState["restoreState"]>
  ) => void;
  readonly requireEntry: (tabId: string) => BrowserPageEntry;
  readonly findFrameInWebContents: (
    targetWebContents: BrowserAgentPageTarget["webContents"],
    frameTreeNodeId: number
  ) => WebFrameMain | null;
  readonly resolveBrowserAgentTarget: (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest | WorkbenchBrowserAgentTargetMode | undefined,
    timeoutMs: number | undefined
  ) => Promise<BrowserAgentPageTarget>;
  readonly navigateInEntry: (
    entry: BrowserPageEntry,
    request: WorkbenchBrowserNavigateRequest
  ) => Promise<WorkbenchBrowserNavigateResult>;
  readonly waitForAgentPageLoad: (
    webContents: BrowserAgentPageTarget["webContents"],
    url: string,
    timeoutMs: number,
    options?: { readonly waitForReady?: boolean }
  ) => Promise<void>;
  readonly waitForAgentPageReload: (
    webContents: BrowserAgentPageTarget["webContents"],
    timeoutMs: number,
    options?: { readonly ignoreCache?: boolean; readonly waitForReady?: boolean }
  ) => Promise<void>;
  readonly openDebuggerSessionForTarget: (target: BrowserAgentPageTarget) => Promise<WorkbenchBrowserDebuggerSession>;
  readonly osAxAdapter?: WorkbenchBrowserOsAxAdapter;
  readonly readPageDiagnostics: (tabId: string) => readonly import("../../../shared/desktop-bridge").WorkbenchBrowserPageDiagnosticEntry[];
  readonly consumeBrowserHealthAlerts?: (tabId: string) => readonly import("../types").BrowserHealthAlert[];
  readonly onBrowserHealthCaptcha?: (tabId: string, label: string) => void;
  readonly onBrowserHealthPermission?: (tabId: string, kind: string) => void;
  readonly recordPageDiagnostic: (
    tabId: string,
    entry: Omit<import("../../../shared/desktop-bridge").WorkbenchBrowserPageDiagnosticEntry, "id" | "at">
  ) => void;
  readonly publishEvent: WorkbenchBrowserPublishEvent;
  readonly updateRuntimeState: (entry: BrowserPageEntry, patch: Partial<WorkbenchBrowserPageRuntimeState>) => void;
  readonly publishBrowserAgentActivity: (request: {
    readonly tabId: string;
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly action: BrowserAgentCursorOverlayAction;
    readonly interaction?: WorkbenchBrowserAgentInteraction;
    readonly cursorPhase?: "move" | "down" | "up" | "idle";
    readonly inputActive?: boolean;
    readonly visibleFollow?: boolean;
    readonly durationMs?: number;
    readonly cursor?: { readonly x: number; readonly y: number };
  }) => void;
  readonly recordFollowAction: (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    action: BrowserAgentCursorOverlayAction,
    request: {
      readonly visibleFollow?: boolean;
      readonly interaction?: WorkbenchBrowserAgentInteraction;
      readonly inputActive: boolean;
      readonly result?: "success" | "failure" | "interrupted";
    }
  ) => unknown;
  readonly sendAgentInputEvent: (target: BrowserAgentPageTarget, event: Parameters<BrowserAgentPageTarget["webContents"]["sendInputEvent"]>[0]) => void;
  readonly assertSharedControlCanContinue: (tabId: string) => void;
  readonly markSyntheticInput: (tabId: string) => void;
  readonly performSearchInPage: (
    target: BrowserPageFindTarget,
    request: WorkbenchBrowserSearchInPageRequest
  ) => Promise<WorkbenchBrowserSearchInPageResult & {
    readonly revealRect?: BrowserPageFindRevealResult["rect"];
  }>;
  readonly captureTargetPage: (tabId: string, target: BrowserAgentPageTarget) => Promise<WorkbenchVisualCaptureResult>;
  readonly createVisualFrame: (request: { readonly tabId: string; readonly target: BrowserAgentPageTarget; readonly imageWidth: number; readonly imageHeight: number; readonly timeoutMs?: number }) => Promise<NonNullable<WorkbenchVisualCaptureResult["visualFrame"]>>;
  readonly rememberVisualFrame: (tabId: string, targetMode: WorkbenchBrowserAgentTargetMode, frame: NonNullable<WorkbenchVisualCaptureResult["visualFrame"]>) => void;
  readonly readVisualFrame: (captureId: string) => { readonly tabId: string; readonly targetMode: WorkbenchBrowserAgentTargetMode; readonly frame: NonNullable<WorkbenchVisualCaptureResult["visualFrame"]> } | undefined;
  readonly visualStaleResult: (request: {
    readonly tabId: string;
    readonly targetMode?: WorkbenchBrowserAgentTargetMode;
    readonly captureId: string;
    readonly reason: WorkbenchBrowserAgentVisualStaleResult["reason"];
    readonly message: string;
  }) => WorkbenchBrowserAgentVisualStaleResult;
  readonly cssPointFromVisualFrame: (point: WorkbenchBrowserAgentPoint, frame: NonNullable<WorkbenchVisualCaptureResult["visualFrame"]>) => WorkbenchBrowserAgentPoint;
  readonly readAgentViewportState: (target: BrowserAgentPageTarget, timeoutMs: number | undefined) => Promise<BrowserAgentViewportState>;
  readonly readBrowserAgentShadow: (tabId: string) => BrowserAgentShadowEntry | undefined;
};
