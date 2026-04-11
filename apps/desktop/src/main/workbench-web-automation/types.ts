import type {
  WorkbenchWebActionRequest,
  WorkbenchWebActionResult,
  WorkbenchWebAutomationError,
  WorkbenchWebGraphBuildRequest,
  WorkbenchWebGraphBuildResult,
  WorkbenchWebGraphEdge,
  WorkbenchWebGraphQueryRequest,
  WorkbenchWebGraphQueryResult,
  WorkbenchWebElementNode,
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
  readonly scanTargets: (
    request: WorkbenchWebTargetScanRequest,
    context?: WorkbenchWebAutomationCallContext
  ) => Promise<WorkbenchWebTargetScanResult>;
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
