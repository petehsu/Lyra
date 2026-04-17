import type {
  WorkbenchWebActionRequest,
  WorkbenchWebActionResult,
  WorkbenchWebContextReadRequest,
  WorkbenchWebContextReadResult,
  WorkbenchWebAutomationError,
  WorkbenchWebScanAndActRequest,
  WorkbenchWebScanAndActResult,
  WorkbenchWebGraphBuildRequest,
  WorkbenchWebGraphBuildResult,
  WorkbenchWebGraphEdge,
  WorkbenchWebGraphQueryRequest,
  WorkbenchWebGraphQueryResult,
  WorkbenchWebElementNode,
  WorkbenchWebFocusProbeRequest,
  WorkbenchWebFocusProbeResult,
  WorkbenchWebFocusReadRequest,
  WorkbenchWebFocusReadResult,
  WorkbenchWebOperabilityReadRequest,
  WorkbenchWebOperabilityReadResult,
  WorkbenchWebQueryRequest,
  WorkbenchWebQueryResult,
  WorkbenchWebSkeletonReadRequest,
  WorkbenchWebSkeletonReadResult,
  WorkbenchWebWidgetScanRequest,
  WorkbenchWebWidgetScanResult,
  WorkbenchWebTargetScanRequest,
  WorkbenchWebTargetScanResult,
  WorkbenchWebWaitRequest,
  WorkbenchWebWaitResult
} from "../../shared/workbench-web-automation";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";

export type WorkbenchWebGraphSnapshot = {
  readonly tabId: string;
  readonly graphId: string;
  readonly address?: string | undefined;
  readonly builtAt: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly interactableCount: number;
  readonly truncated: boolean;
  readonly budgetExhausted: boolean;
  readonly nodes: readonly WorkbenchWebElementNode[];
  readonly edges: readonly WorkbenchWebGraphEdge[];
};

export type WorkbenchWebAutomationService = {
  readonly dispose: () => void;
  readonly buildGraph: (request?: WorkbenchWebGraphBuildRequest) => Promise<WorkbenchWebGraphBuildResult>;
  readonly queryGraph: (request?: WorkbenchWebGraphQueryRequest) => Promise<WorkbenchWebGraphQueryResult>;
  readonly readFocusAtlas: (
    request?: WorkbenchWebFocusReadRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebFocusReadResult>;
  readonly readSkeleton: (
    request?: WorkbenchWebSkeletonReadRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebSkeletonReadResult>;
  readonly querySkeleton: (
    request?: WorkbenchWebQueryRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebQueryResult>;
  readonly readContext: (
    request?: WorkbenchWebContextReadRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebContextReadResult>;
  readonly readOperability: (
    request?: WorkbenchWebOperabilityReadRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebOperabilityReadResult>;
  readonly probeFocus: (
    request?: WorkbenchWebFocusProbeRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebFocusProbeResult>;
  readonly scanWidgets: (
    request?: WorkbenchWebWidgetScanRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebWidgetScanResult>;
  readonly scanTargets: (
    request: WorkbenchWebTargetScanRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebTargetScanResult>;
  readonly scanAndAct: (
    request: WorkbenchWebScanAndActRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebScanAndActResult>;
  readonly runSafeAction: (
    request: WorkbenchWebActionRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebActionResult>;
  readonly runMutateAction: (
    request: WorkbenchWebActionRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebActionResult>;
  readonly runNavigateAction: (
    request: WorkbenchWebActionRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebActionResult>;
  readonly waitForTarget: (
    request: WorkbenchWebWaitRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebWaitResult>;
};

export type WorkbenchWebAutomationServiceDeps = {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly storageRoot: string;
  readonly readLyraDirectMicroExecutorBudget?: () => "1-2" | "3-5" | "6-8";
};

export type WorkbenchWebAutomationErrorLike = WorkbenchWebAutomationError & {
  readonly details?: Record<string, unknown>;
};

export type WorkbenchWebAutomationCallContext = {
  readonly toolCallId?: string;
  readonly agentSessionId?: string;
  readonly agentTurnId?: string;
};

export type WorkbenchWebAutomationStoredGraph = {
  readonly graphId: string;
  readonly address?: string | undefined;
  readonly tabId: string;
  readonly builtAt: number;
  readonly expiresAt: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly interactableCount: number;
  readonly nodes: readonly WorkbenchWebElementNode[];
  readonly edges: readonly WorkbenchWebGraphEdge[];
};

export type WorkbenchWebAutomationStoreData = {
  readonly version: 1;
  readonly graphs: readonly WorkbenchWebAutomationStoredGraph[];
};
