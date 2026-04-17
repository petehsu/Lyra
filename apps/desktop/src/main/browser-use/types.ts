import type {
  BrowserUseAgentRunRequest,
  BrowserUseAgentRunResult,
  BrowserUseRuntimeStatus,
  BrowserUseNavigateRequest,
  BrowserUseNavigateResult,
  BrowserUsePageActionRequest,
  BrowserUsePageActionResult,
  BrowserUsePageExtractRequest,
  BrowserUsePageExtractResult,
  BrowserUsePageState,
  BrowserUsePageStateRequest,
  BrowserUsePrepareSessionRequest,
  BrowserUsePreparedSessionResult,
  BrowserUseSessionHandle,
  BrowserUseStructuredError,
  BrowserUseWaitRequest,
  BrowserUseWaitResult,
} from "../../shared/browser-use";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";

export type BrowserUseServiceDeps = {
  readonly storageRoot: string;
  readonly browserBridge: WorkbenchBrowserIpcBridge;
};

export type BrowserUseService = {
  readonly runtime: BrowserUseRuntimeManager;
  readonly dispose: () => Promise<void>;
  readonly prepareSession: (request?: BrowserUsePrepareSessionRequest) => Promise<BrowserUsePreparedSessionResult>;
  readonly readPageState: (request: BrowserUsePageStateRequest) => Promise<BrowserUsePageState>;
  readonly extractPage: (request: BrowserUsePageExtractRequest) => Promise<BrowserUsePageExtractResult>;
  readonly runSafeAction: (request: BrowserUsePageActionRequest) => Promise<BrowserUsePageActionResult>;
  readonly runMutateAction: (request: BrowserUsePageActionRequest) => Promise<BrowserUsePageActionResult>;
  readonly runNavigateAction: (request: BrowserUseNavigateRequest) => Promise<BrowserUseNavigateResult>;
  readonly waitForPage: (request: BrowserUseWaitRequest) => Promise<BrowserUseWaitResult>;
  readonly runAgentTask: (request: BrowserUseAgentRunRequest) => Promise<BrowserUseAgentRunResult>;
};

export type BrowserUseCommandResult = {
  readonly success: boolean;
  readonly data?: Record<string, unknown>;
  readonly error?: string;
};

export type BrowserUseManagedSessionRecord = {
  readonly session: BrowserUseSessionHandle;
  readonly daemonSessionName: string;
  readonly invalidate: () => Promise<void>;
};

export type BrowserUseCurrentTabSessionRecord = {
  readonly session: BrowserUseSessionHandle;
  readonly daemonSessionName: string;
  readonly bridgeSession: BrowserUseCdpBridgeSession;
  readonly invalidate: () => Promise<void>;
};

export type BrowserUseDaemonSessionRecord =
  | BrowserUseManagedSessionRecord
  | BrowserUseCurrentTabSessionRecord;

export type BrowserUseRuntimeInstallState = {
  readonly pythonPath: string;
  readonly homeDir: string;
  readonly bundleVersion: string;
  readonly bundleRoot: string;
  readonly browserUsePin: string;
  readonly manifestPath: string;
};

export type BrowserUseRuntimePreflightFailureCode =
  | "missing_bundle"
  | "integrity_failed"
  | "daemon_launch_failed"
  | "bridge_unavailable"
  | "unsupported_platform";

export type BrowserUseRuntimePreflightResult =
  | {
      readonly ok: true;
      readonly installState: BrowserUseRuntimeInstallState;
    }
  | {
      readonly ok: false;
      readonly code: BrowserUseRuntimePreflightFailureCode;
      readonly detail: string;
    };

export type BrowserUseCdpBridgeSession = {
  readonly sessionId: string;
  readonly wsUrl: string;
  readonly tabId: string;
  readonly pageAddress?: string;
  readonly close: () => Promise<void>;
};

export type BrowserUseCdpBridgeService = {
  readonly dispose: () => Promise<void>;
  readonly openForTab: (tabId: string) => Promise<BrowserUseCdpBridgeSession>;
};

export type BrowserUseRuntimeManager = {
  readonly dispose: () => Promise<void>;
  readonly preflight: () => Promise<BrowserUseRuntimePreflightResult>;
  readonly ensureInstalled: () => Promise<BrowserUseRuntimeInstallState>;
  readonly startDaemon: (request: {
    readonly daemonSessionName: string;
    readonly headed: boolean;
    readonly profileName?: string;
    readonly cdpUrl?: string;
  }) => Promise<void>;
  readonly stopDaemon: (daemonSessionName: string) => Promise<void>;
  readonly sendCommand: (
    daemonSessionName: string,
    action: string,
    params?: Record<string, unknown>
  ) => Promise<BrowserUseCommandResult>;
  readonly runAgentTask: (request: {
    readonly daemonSessionName: string;
    readonly task: string;
    readonly maxSteps: number;
    readonly model?: string;
    readonly cdpUrl?: string;
  }) => Promise<BrowserUseAgentRunResult>;
};

export type BrowserUseRuntimeStatusListener = (status: BrowserUseRuntimeStatus) => void;

export type BrowserUseRuntimeCoordinator = {
  readonly dispose: () => Promise<void>;
  readonly start: () => void;
  readonly readStatus: () => BrowserUseRuntimeStatus;
  readonly subscribe: (listener: BrowserUseRuntimeStatusListener) => () => void;
  readonly applyEnginePreference: (engine: "lyra_direct" | "browser_use" | "smart") => Promise<void>;
};

export const createBrowserUseError = (
  code: BrowserUseStructuredError["code"],
  message: string,
  details?: Record<string, unknown>,
  retryable = true
): BrowserUseStructuredError => ({
  code,
  message,
  retryable,
  ...(details === undefined ? {} : { details })
});
