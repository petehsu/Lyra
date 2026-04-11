import type {
  WorkbenchBrowserAgentTargetInfo,
  WorkbenchBrowserElementPickerAppearance,
  WorkbenchBrowserElementPickerDisableCause,
  WorkbenchBrowserElementPickerOwner,
  WorkbenchBrowserElementPickerPhase,
  WorkbenchBrowserElementPickerState,
  WorkbenchBrowserEvent,
  WorkbenchBrowserHoveredElementInfo,
  WorkbenchBrowserSetElementPickerModeRequest
} from "../../../shared/desktop-bridge";
import type { WorkbenchBrowserFrameDescriptor } from "../types";

export const WORKBENCH_ELEMENT_PICKER_CONSOLE_PREFIX = "__LYRA_PICKER__";

export type WorkbenchElementPickerConsoleStateMessage = {
  readonly kind: "state";
  readonly enabled: boolean;
  readonly cause?: WorkbenchBrowserElementPickerDisableCause;
};

export type WorkbenchElementPickerConsoleHoverMessage = {
  readonly kind: "hover";
  readonly frameTreeNodeId: number;
  readonly tagName: string;
  readonly role?: string;
  readonly inputType?: string;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  readonly textSnippet?: string;
  readonly selectorPreview: string;
  readonly bounds: WorkbenchBrowserHoveredElementInfo["bounds"];
  readonly frameUrl?: string;
  readonly crossOriginBoundary?: boolean;
};

export type WorkbenchElementPickerConsoleMessage =
  | WorkbenchElementPickerConsoleStateMessage
  | WorkbenchElementPickerConsoleHoverMessage;

export type WorkbenchElementPickerSessionHost = {
  readonly publishEvent: (event: WorkbenchBrowserEvent) => void;
  readonly listFrames: (tabId: string) => readonly WorkbenchBrowserFrameDescriptor[];
  readonly executeFrameScript: (
    tabId: string,
    request: {
      readonly script: string;
      readonly frameTreeNodeId?: number;
      readonly userGesture?: boolean;
    }
  ) => Promise<unknown>;
};

export type WorkbenchElementPickerOverlayHost = Pick<
  WorkbenchElementPickerSessionHost,
  "listFrames" | "executeFrameScript"
>;

export type WorkbenchElementPickerSharedState = {
  readonly tabId: string;
  readonly enabled: boolean;
  readonly owner?: WorkbenchBrowserElementPickerOwner;
  readonly phase?: WorkbenchBrowserElementPickerPhase;
  readonly toolCallId?: string;
};

export type WorkbenchElementPickerDisableOptions = {
  readonly errorCode?: WorkbenchBrowserElementPickerState["errorCode"];
  readonly publishState?: boolean;
};

export type WorkbenchManualElementPickerSession = {
  readonly tabId: string;
  readonly enable: () => Promise<{
    readonly ok: boolean;
    readonly hadUnavailableFrame: boolean;
  }>;
  readonly disable: (
    cause: WorkbenchBrowserElementPickerDisableCause,
    options?: WorkbenchElementPickerDisableOptions
  ) => Promise<void>;
  readonly handleConsoleMessage: (
    message: WorkbenchElementPickerConsoleMessage
  ) => {
      readonly disableRequested: boolean;
      readonly cause?: WorkbenchBrowserElementPickerDisableCause;
  };
};

export type WorkbenchAgentElementPickerSession = {
  readonly tabId: string;
  readonly ensureMounted: () => Promise<{
    readonly ok: boolean;
    readonly hadUnavailableFrame: boolean;
  }>;
  readonly showTarget: (
    target: WorkbenchBrowserAgentTargetInfo,
    appearance?: WorkbenchBrowserElementPickerAppearance
  ) => Promise<boolean>;
  readonly clearTarget: (publishState?: boolean) => Promise<void>;
  readonly disable: (
    cause: WorkbenchBrowserElementPickerDisableCause,
    options?: WorkbenchElementPickerDisableOptions
  ) => Promise<void>;
};

export type WorkbenchElementPickerControllerDeps = {
  readonly host: WorkbenchElementPickerSessionHost;
};

export type WorkbenchElementPickerSessionDeps = {
  readonly host: WorkbenchElementPickerSessionHost;
  readonly tabId: string;
  readonly appearance: WorkbenchBrowserElementPickerAppearance;
  readonly onDisableRequested: (cause: WorkbenchBrowserElementPickerDisableCause) => void;
};

export type WorkbenchElementPickerStateSnapshot = WorkbenchBrowserElementPickerState | null;

export type WorkbenchElementPickerModeRequest = WorkbenchBrowserSetElementPickerModeRequest;

export type WorkbenchElementPickerOverlayRuntime = {
  readonly prime: (
    appearance: WorkbenchBrowserElementPickerAppearance
  ) => Promise<{
    readonly mainFrameSucceeded: boolean;
    readonly hadUnavailableFrame: boolean;
  }>;
  readonly enableManualMode: (
    appearance: WorkbenchBrowserElementPickerAppearance
  ) => Promise<{
    readonly mainFrameSucceeded: boolean;
    readonly hadUnavailableFrame: boolean;
  }>;
  readonly setAgentTarget: (
    target: WorkbenchBrowserAgentTargetInfo,
    appearance: WorkbenchBrowserElementPickerAppearance
  ) => Promise<{
    readonly mainFrameSucceeded: boolean;
    readonly hadUnavailableFrame: boolean;
  }>;
  readonly clearAgentTarget: () => Promise<void>;
  readonly disable: () => Promise<void>;
};
