export type WorkbenchBrowserNavigateRequest = {
  readonly address: string;
  readonly tabId?: string;
  readonly title?: string;
};

export type WorkbenchBrowserNavigateResult = {
  readonly address: string;
  readonly tabId: string | null;
  readonly title: string | null;
};

export type WorkbenchBrowserReadPageStateRequest = {
  readonly tabId?: string;
};

export type WorkbenchBrowserSetElementPickerModeRequest = {
  readonly tabId: string;
  readonly enabled: boolean;
  readonly appearance?: WorkbenchBrowserElementPickerAppearance;
};

export type WorkbenchBrowserPageSpec = {
  readonly tabId: string;
  readonly address: string;
  readonly titleHint?: string;
  readonly isActive: boolean;
};

export type WorkbenchBrowserTopologySnapshot = {
  readonly activeTabId: string | null;
  readonly pages: readonly WorkbenchBrowserPageSpec[];
};

export type WorkbenchBrowserPageLayout = {
  readonly tabId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
  readonly zIndex: number;
  readonly isFocusedPane: boolean;
};

export type WorkbenchBrowserLayoutSnapshot = {
  readonly windowWidth: number;
  readonly windowHeight: number;
  readonly layouts: readonly WorkbenchBrowserPageLayout[];
};

export type WorkbenchBrowserPageRuntimeState = {
  readonly tabId: string;
  readonly address: string;
  readonly title: string;
  readonly faviconUrl?: string;
  readonly isActive: boolean;
  readonly isVisible: boolean;
  readonly isLoading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly isHtmlFullscreen: boolean;
  readonly updatedAt: number;
};

export type WorkbenchBrowserElementPickerDisableCause =
  | "user_toggle"
  | "escape"
  | "tab_switched"
  | "page_navigated"
  | "page_closed"
  | "script_error";

export type WorkbenchBrowserElementPickerOwner =
  | "manual"
  | "agent_scan"
  | "agent_action"
  | "agent_wait";

export type WorkbenchBrowserElementPickerPhase =
  | "idle"
  | "scan"
  | "resolve"
  | "act"
  | "wait";

export type WorkbenchBrowserElementPickerState = {
  readonly tabId: string;
  readonly enabled: boolean;
  readonly owner?: WorkbenchBrowserElementPickerOwner;
  readonly phase?: WorkbenchBrowserElementPickerPhase;
  readonly toolCallId?: string;
  readonly cause?: WorkbenchBrowserElementPickerDisableCause;
  readonly errorCode?: "tab_not_found" | "script_injection_failed" | "frame_unavailable";
};

export type WorkbenchBrowserElementPickerAppearance = {
  readonly fontFamily: string;
  readonly surfaceBackground: string;
  readonly surfaceBorder: string;
  readonly surfaceShadow: string;
  readonly surfaceBackdropFilter: string;
  readonly accentColor: string;
  readonly accentFill: string;
  readonly tagBackground: string;
  readonly tagText: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly frameRadius: string;
  readonly bubbleRadius: string;
  readonly strokeWidth: string;
};

export type WorkbenchBrowserHoveredElementInfo = {
  readonly tabId: string;
  readonly frameTreeNodeId: number;
  readonly tagName: string;
  readonly role?: string;
  readonly inputType?: string;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
  readonly textSnippet?: string;
  readonly selectorPreview: string;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly frameUrl?: string;
  readonly crossOriginBoundary?: boolean;
};

export type WorkbenchBrowserAgentTargetInfo = {
  readonly tabId: string;
  readonly toolCallId: string;
  readonly owner: "agent_scan" | "agent_action" | "agent_wait";
  readonly phase: "scan" | "resolve" | "act" | "wait";
  readonly frameTreeNodeId: number;
  readonly tagName: string;
  readonly role?: string;
  readonly inputType?: string;
  readonly selectorPreview: string;
  readonly textSnippet?: string;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
};

export type WorkbenchBrowserEvent =
  | {
      readonly kind: "page-runtime-state";
      readonly page: WorkbenchBrowserPageRuntimeState;
    }
  | {
      readonly kind: "page-closed";
      readonly tabId: string;
    }
  | {
      readonly kind: "request-open-tab";
      readonly address: string;
      readonly title?: string;
    }
  | {
      readonly kind: "element-picker-state";
      readonly state: WorkbenchBrowserElementPickerState;
    }
  | {
      readonly kind: "element-picker-hover";
      readonly hover: WorkbenchBrowserHoveredElementInfo;
    }
  | {
      readonly kind: "element-picker-agent-target";
      readonly target: WorkbenchBrowserAgentTargetInfo;
    };
