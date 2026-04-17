export type BrowserUseSessionMode = "current_tab" | "managed";
export type BrowserUseAuthMode = "isolated" | "prompt_real_profile";
export type BrowserUseRuntimeHealthState = "checking" | "healthy" | "unavailable";

export type BrowserUseRuntimeUnavailableReason =
  | "missing_bundle"
  | "integrity_failed"
  | "daemon_launch_failed"
  | "bridge_unavailable"
  | "unsupported_platform";

export type BrowserUseRuntimeStatus = {
  readonly state: BrowserUseRuntimeHealthState;
  readonly checkedAt: number;
  readonly bundleVersion?: string;
  readonly reason?: BrowserUseRuntimeUnavailableReason;
  readonly detail?: string;
};

export type BrowserUseBrowserProfileOption = {
  readonly id: string;
  readonly browserId: string;
  readonly browserName: string;
  readonly profileName: string;
  readonly profileDirectory: string;
  readonly userDataDir: string;
  readonly isDefault: boolean;
};

export type BrowserUseFailureCode =
  | "active_visible_page_required"
  | "session_not_found"
  | "session_invalidated"
  | "profile_required"
  | "browser_use_runtime_unavailable"
  | "browser_use_install_failed"
  | "browser_use_daemon_unavailable"
  | "browser_use_command_failed"
  | "browser_use_command_timeout"
  | "browser_use_agent_unavailable"
  | "browser_use_agent_failed"
  | "browser_use_cdp_unavailable"
  | "browser_use_current_tab_unsupported";

export type BrowserUseSessionHandle = {
  readonly sessionId: string;
  readonly mode: BrowserUseSessionMode;
  readonly authMode: BrowserUseAuthMode;
  readonly backend: "browser_use_daemon" | "browser_use_cdp_bridge";
  readonly ready: boolean;
  readonly createdAt: number;
  readonly tabId?: string;
  readonly pageAddress?: string;
  readonly headed?: boolean;
  readonly profileName?: string;
  readonly cdpUrl?: string;
};

export type BrowserUsePrepareSessionRequest = {
  readonly mode?: BrowserUseSessionMode;
  readonly authMode?: BrowserUseAuthMode;
  readonly tabId?: string;
  readonly headed?: boolean;
  readonly profileName?: string;
  readonly reuseSessionId?: string;
};

export type BrowserUsePreparedSessionResult = {
  readonly session: BrowserUseSessionHandle;
  readonly reused: boolean;
};

export type BrowserUsePageStateRequest = {
  readonly sessionId: string;
};

export type BrowserUsePageState = {
  readonly sessionId: string;
  readonly mode: BrowserUseSessionMode;
  readonly rawState: string;
  readonly title?: string;
  readonly url?: string;
  readonly liveUrl?: string;
};

export type BrowserUsePageExtractRequest =
  | {
      readonly sessionId: string;
      readonly kind: "title";
    }
  | {
      readonly sessionId: string;
      readonly kind: "html";
      readonly selector?: string;
    }
  | {
      readonly sessionId: string;
      readonly kind: "text" | "value" | "attributes" | "bbox";
      readonly elementIndex: number;
    };

export type BrowserUsePageExtractResult = {
  readonly sessionId: string;
  readonly kind: BrowserUsePageExtractRequest["kind"];
  readonly title?: string;
  readonly html?: string;
  readonly text?: string;
  readonly value?: string;
  readonly attributes?: Record<string, string>;
  readonly bbox?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
};

export type BrowserUsePageActionRequest =
  | {
      readonly sessionId: string;
      readonly kind: "hover" | "dblclick" | "rightclick";
      readonly elementIndex: number;
    }
  | {
      readonly sessionId: string;
      readonly kind: "click";
      readonly elementIndex?: number;
      readonly x?: number;
      readonly y?: number;
    }
  | {
      readonly sessionId: string;
      readonly kind: "type";
      readonly text: string;
    }
  | {
      readonly sessionId: string;
      readonly kind: "input";
      readonly elementIndex: number;
      readonly text: string;
    }
  | {
      readonly sessionId: string;
      readonly kind: "keys";
      readonly keys: string;
    }
  | {
      readonly sessionId: string;
      readonly kind: "select";
      readonly elementIndex: number;
      readonly value: string;
    }
  | {
      readonly sessionId: string;
      readonly kind: "scroll";
      readonly direction?: "up" | "down";
      readonly amount?: number;
    };

export type BrowserUsePageActionResult = {
  readonly sessionId: string;
  readonly kind: BrowserUsePageActionRequest["kind"];
  readonly ok: boolean;
  readonly data?: Record<string, unknown>;
};

export type BrowserUseNavigateRequest =
  | {
      readonly sessionId: string;
      readonly kind: "open";
      readonly url: string;
    }
  | {
      readonly sessionId: string;
      readonly kind: "back" | "close";
    }
  | {
      readonly sessionId: string;
      readonly kind: "switch" | "close_tab";
      readonly tabIndex: number;
    };

export type BrowserUseNavigateResult = {
  readonly sessionId: string;
  readonly kind: BrowserUseNavigateRequest["kind"];
  readonly ok: boolean;
  readonly data?: Record<string, unknown>;
};

export type BrowserUseWaitRequest =
  | {
      readonly sessionId: string;
      readonly kind: "selector";
      readonly selector: string;
      readonly timeoutMs?: number;
      readonly state?: "attached" | "detached" | "visible" | "hidden";
    }
  | {
      readonly sessionId: string;
      readonly kind: "text";
      readonly text: string;
      readonly timeoutMs?: number;
    };

export type BrowserUseWaitResult = {
  readonly sessionId: string;
  readonly kind: BrowserUseWaitRequest["kind"];
  readonly found: boolean;
};

export type BrowserUseAgentRunRequest = {
  readonly sessionId: string;
  readonly task: string;
  readonly maxSteps?: number;
  readonly model?: string;
};

export type BrowserUseStepResult = {
  readonly index: number;
  readonly title: string;
  readonly status: "completed" | "failed" | "running";
  readonly message?: string;
};

export type BrowserUseAgentRunResult = {
  readonly sessionId: string;
  readonly ok: boolean;
  readonly summary?: string;
  readonly steps: readonly BrowserUseStepResult[];
};

export type BrowserUseStructuredError = {
  readonly code: BrowserUseFailureCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly details?: Record<string, unknown>;
};
