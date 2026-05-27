export type WorkbenchBrowserNavigateRequest = {
  readonly address: string;
  readonly tabId?: string;
  readonly newTab?: boolean;
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
  readonly mode?: WorkbenchBrowserElementPickerMode;
  readonly appearance?: WorkbenchBrowserElementPickerAppearance;
};

export type WorkbenchBrowserPageSpec = {
  readonly tabId: string;
  readonly address: string;
  readonly titleHint?: string;
  readonly isActive: boolean;
};

export type WorkbenchBrowserWebThemePalette = {
  readonly bgApp: string;
  readonly bgSurface: string;
  readonly bgEditor: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly textAccent: string;
  readonly lineDefault: string;
  readonly lineFocused: string;
  readonly statusSuccess: string;
  readonly statusWarning: string;
  readonly statusError: string;
};

export type WorkbenchBrowserWebThemeSnapshot = {
  /** Master toggle. When false, injector should disable all stages and let pages render natively. */
  readonly enabled: boolean;
  /** Whether resolved Lyra theme is on the dark side of the spectrum. */
  readonly isDark: boolean;
  /** Subset of Lyra theme vars relevant to web page theming. */
  readonly palette: WorkbenchBrowserWebThemePalette;
  /** Monotonic tick that bumps on every snapshot update so downstream can react. */
  readonly revision: number;
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

export type WorkbenchBrowserPageLifecycleState =
  | "foreground"
  | "visible"
  | "hot-hidden"
  | "tombstoned"
  | "restoring";

export type WorkbenchBrowserPageRuntimeState = {
  readonly tabId: string;
  readonly address: string;
  readonly title: string;
  readonly faviconUrl?: string;
  readonly lifecycleState?: WorkbenchBrowserPageLifecycleState;
  readonly coreKey?: string;
  readonly stateKey?: string;
  readonly isTombstoned?: boolean;
  readonly restoreReason?: string;
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

export type WorkbenchBrowserElementPickerOwner = "manual";

export type WorkbenchBrowserElementPickerPhase = "idle";

export type WorkbenchBrowserElementPickerMode = "inspect" | "layout";

export type WorkbenchBrowserElementPickerState = {
  readonly tabId: string;
  readonly enabled: boolean;
  readonly mode?: WorkbenchBrowserElementPickerMode;
  readonly owner?: WorkbenchBrowserElementPickerOwner;
  readonly phase?: WorkbenchBrowserElementPickerPhase;
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
  readonly widgetId?: string;
  readonly widgetKind?: string;
  readonly widgetLabel?: string;
  readonly affordanceLabel?: string;
  readonly affordanceAction?: string;
  readonly cursorStyle?: string;
  readonly tooltipText?: string;
  readonly stateHint?: string;
  readonly containerBounds?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly frameUrl?: string;
  readonly crossOriginBoundary?: boolean;
};

export type WorkbenchLumenActivityAction =
  | "observe"
  | "read"
  | "capture"
  | "wait"
  | "navigate"
  | "focus"
  | "act"
  | "type"
  | "press";

export type WorkbenchLumenActivityEvent = {
  readonly kind: "lumen-browser-activity";
  readonly source: "lyra_lumen";
  readonly tabId: string;
  readonly targetMode: "isolated" | "live";
  readonly action: WorkbenchLumenActivityAction;
  readonly inputActive: boolean;
  readonly durationMs: number;
  readonly sessionId?: string;
  readonly cursor?: {
    readonly x: number;
    readonly y: number;
  };
};

export type WorkbenchBrowserAgentActivityAction = WorkbenchLumenActivityAction;

export type WorkbenchLegacyBrowserAgentActivityEvent =
  Omit<WorkbenchLumenActivityEvent, "kind" | "source"> & {
    readonly kind: "agent-browser-activity";
    readonly source?: "lyra_lumen";
  };

export type WorkbenchBrowserAgentActivityEvent =
  | WorkbenchLumenActivityEvent
  | WorkbenchLegacyBrowserAgentActivityEvent;

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
  | WorkbenchLumenActivityEvent
  | WorkbenchLegacyBrowserAgentActivityEvent;
