import type {
  WorkbenchWebActionRequest,
  WorkbenchWebActionResult,
} from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebSessionRegistry } from "../agent-session/registry";
import type { WorkbenchAgentWebSession } from "../agent-session/types";
import type { LiveSelectorScanRegistry } from "../live-selector/scan-session";
import type {
  LiveSelectorScanCandidateRecord,
  LiveSelectorScanSession,
} from "../live-selector/types";
import type {
  WorkbenchWebAutomationCallContext,
  WorkbenchWebAutomationServiceDeps,
} from "../types";

export type RunPostRevealContinuation = (args: {
  readonly tabId: string;
  readonly request: WorkbenchWebActionRequest;
  readonly result: WorkbenchWebActionResult;
  readonly sourceCandidate: LiveSelectorScanCandidateRecord;
  readonly sourceScanSession: LiveSelectorScanSession | null;
  readonly sourceScanSessionId: string;
  readonly context?: WorkbenchWebAutomationCallContext;
}) => Promise<{
  readonly result: WorkbenchWebActionResult;
  readonly scanSessionId: string;
  readonly revealDelta?: WorkbenchAgentWebSession["lastLocalDelta"];
  readonly finalCandidate: LiveSelectorScanCandidateRecord;
  readonly revealObserved: boolean;
}>;

export type WorkbenchWebPostRevealContinuationRuntime = {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly scanRegistry: LiveSelectorScanRegistry;
  readonly agentSessions: WorkbenchAgentWebSessionRegistry;
  readonly queryIntentCueByTab: Map<string, any>;
  readonly queryIntentCueTtlMs: number;
  readonly readAgentSession: (...args: any[]) => WorkbenchAgentWebSession | null;
  readonly readMicroExecutorStepBudget: (deps: WorkbenchWebAutomationServiceDeps) => number;
  readonly runActionRevealPass: (args: any) => Promise<any>;
  readonly deriveLocalDeltaFromReveal: (...args: any[]) => WorkbenchAgentWebSession["lastLocalDelta"];
  readonly resolveWorkflowRegionForCandidate: (...args: any[]) => any;
  readonly resolveHoverRevealRegion: (...args: any[]) => any;
  readonly readFreshQueryIntentCue: (args: any) => any;
  readonly extractActionTargetTextHints: (target: Record<string, unknown> | undefined) => readonly string[];
  readonly pickRevealContinuationCandidate: (args: any) => LiveSelectorScanCandidateRecord | undefined;
  readonly rankRevealContinuationCandidates: (args: any) => readonly LiveSelectorScanCandidateRecord[];
  readonly withResolvedCandidateTarget: (
    request: WorkbenchWebActionRequest,
    candidate: LiveSelectorScanCandidateRecord,
    scanSessionId: string
  ) => WorkbenchWebActionRequest;
  readonly runWithMicroRetry: (args: any) => Promise<WorkbenchWebActionResult>;
  readonly executeWebActionWithDeadline: (args: any) => Promise<WorkbenchWebActionResult>;
  readonly syntheticGraphFromCandidate: (
    tabId: string,
    scanSessionId: string,
    candidate: LiveSelectorScanCandidateRecord
  ) => any;
  readonly pointerStateForContext: (...args: any[]) => Record<string, unknown>;
  readonly isRevealStateTransition: (transition: WorkbenchWebActionResult["verification"] extends undefined ? never : any) => boolean;
  readonly isActionRevealTriggerCandidate: (candidate: LiveSelectorScanCandidateRecord) => boolean;
  readonly shouldResetWorkflowContext: (result: WorkbenchWebActionResult) => boolean;
};

export const createWorkbenchWebPostRevealContinuation = (
  runtime: WorkbenchWebPostRevealContinuationRuntime
): {
  readonly runPostRevealContinuation: RunPostRevealContinuation;
} => {
  const {
    deps,
    scanRegistry,
    agentSessions,
    queryIntentCueByTab,
    queryIntentCueTtlMs,
    readAgentSession,
    readMicroExecutorStepBudget,
    runActionRevealPass,
    deriveLocalDeltaFromReveal,
    resolveWorkflowRegionForCandidate,
    resolveHoverRevealRegion,
    readFreshQueryIntentCue,
    extractActionTargetTextHints,
    pickRevealContinuationCandidate,
    rankRevealContinuationCandidates,
    withResolvedCandidateTarget,
    runWithMicroRetry,
    executeWebActionWithDeadline,
    syntheticGraphFromCandidate,
    pointerStateForContext,
    isRevealStateTransition,
    isActionRevealTriggerCandidate,
    shouldResetWorkflowContext,
  } = runtime;

  const runPostRevealContinuation: RunPostRevealContinuation = async ({
    tabId,
    request,
    result,
    sourceCandidate,
    sourceScanSession,
    sourceScanSessionId,
    context,
  }) => {
    let nextResult = result;
    let effectiveScanSessionId = sourceScanSessionId;
    let revealDelta: WorkbenchAgentWebSession["lastLocalDelta"] | undefined;
    let finalCandidate = sourceCandidate;
    const transition = result.verification?.stateTransition;
    const revealObserved =
      isRevealStateTransition(transition)
      || (
        transition === "navigation_changed"
        && isActionRevealTriggerCandidate(sourceCandidate)
      );

    if (
      request.action.kind !== "click"
      || !revealObserved
      || !isActionRevealTriggerCandidate(sourceCandidate)
      || sourceScanSession === null
      || shouldResetWorkflowContext(result)
    ) {
      return {
        result: nextResult,
        scanSessionId: effectiveScanSessionId,
        ...(revealDelta === undefined ? {} : { revealDelta }),
        finalCandidate,
        revealObserved
      };
    }

    const revealed = await runActionRevealPass({
      deps,
      tabId,
      candidate: sourceCandidate,
      scanSession: sourceScanSession,
      surfaceSession: readAgentSession(agentSessions, context, tabId),
      maxMicroSteps: readMicroExecutorStepBudget(deps)
    });
    if (revealed === null) {
      return {
        result: nextResult,
        scanSessionId: effectiveScanSessionId,
        ...(revealDelta === undefined ? {} : { revealDelta }),
        finalCandidate,
        revealObserved
      };
    }

    const revealSession = scanRegistry.write({
      tabId,
      scope: "visible",
      intent: sourceScanSession.intent,
      pageMode: revealed.pageMode,
      widgets: revealed.widgets,
      containerNodes: revealed.containerNodes,
      candidates: revealed.candidates
    });
    effectiveScanSessionId = revealSession.scanSessionId;
    revealDelta = deriveLocalDeltaFromReveal({
      baseline: sourceScanSession.candidates,
      revealed: revealed.candidates.filter((entry: LiveSelectorScanCandidateRecord) => entry.discoveryMode === "action_revealed"),
      workflowRegion: resolveWorkflowRegionForCandidate({
        candidate: sourceCandidate,
        widgets: sourceScanSession.widgets,
        containerNodes: sourceScanSession.containerNodes
      }),
      revealRegion: resolveHoverRevealRegion({
        seed: sourceCandidate,
        widgets: sourceScanSession.widgets,
        containerNodes: sourceScanSession.containerNodes
      })
    });

    const targetRecord = (() => {
      const rawTarget = (request.action as { readonly target?: unknown }).target;
      if (rawTarget === null || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
        return undefined;
      }
      return rawTarget as Record<string, unknown>;
    })();
    const revealedActionCandidates = revealed.candidates.filter(
      (entry: LiveSelectorScanCandidateRecord) => entry.discoveryMode === "action_revealed"
    );
    const queryCue = readFreshQueryIntentCue({
      cueByTab: queryIntentCueByTab,
      tabId,
      ...(context === undefined ? {} : { context }),
      now: Date.now(),
      ttlMs: queryIntentCueTtlMs
    });
    const targetTextHints = extractActionTargetTextHints(targetRecord);
    const continuationCandidate = pickRevealContinuationCandidate({
      sourceCandidate,
      revealedCandidates: revealedActionCandidates,
      queryCue,
      targetTextHints
    });
    const continuationQueue = rankRevealContinuationCandidates({
      sourceCandidate,
      revealedCandidates: revealedActionCandidates,
      queryCue,
      targetTextHints,
      maxCandidates: Math.max(1, Math.min(readMicroExecutorStepBudget(deps), 4))
    });
    if (continuationQueue.length === 0 && continuationCandidate === undefined) {
      return {
        result: nextResult,
        scanSessionId: effectiveScanSessionId,
        ...(revealDelta === undefined ? {} : { revealDelta }),
        finalCandidate,
        revealObserved
      };
    }

    const attemptedCandidates = continuationQueue.length > 0
      ? continuationQueue
      : continuationCandidate === undefined
        ? []
        : [continuationCandidate];

    for (const followCandidate of attemptedCandidates) {
      const continuationRequest = withResolvedCandidateTarget(
        {
          tabId,
          timeoutMs: 1_900,
          action: {
            kind: "click",
            target: {
              candidateId: followCandidate.candidateId,
              scanSessionId: effectiveScanSessionId
            }
          }
        },
        followCandidate,
        effectiveScanSessionId
      );
      try {
        const continuedResult = await runWithMicroRetry({
          execute: () => executeWebActionWithDeadline({
            browserBridge: deps.browserBridge,
            graph: syntheticGraphFromCandidate(tabId, effectiveScanSessionId, followCandidate),
            request: continuationRequest,
            ...pointerStateForContext(agentSessions, context, tabId)
          }),
          deps,
          tabId,
          action: continuationRequest.action,
          candidate: followCandidate,
          scanRegistry,
          ...(context === undefined ? {} : { context }),
          agentSessions
        });
        const continuedRevealTransition = continuedResult.verification?.stateTransition;
        if (
          isRevealStateTransition(continuedRevealTransition)
          && isActionRevealTriggerCandidate(followCandidate)
        ) {
          nextResult = {
            ...continuedResult,
            note: [continuedResult.note, "continuation reopened menu trigger; trying alternate candidate"]
              .filter(Boolean)
              .join("; ")
          };
          continue;
        }
        nextResult = {
          ...continuedResult,
          note: [continuedResult.note, "continued from local reveal delta"].filter(Boolean).join("; ")
        };
        finalCandidate = followCandidate;
        break;
      } catch {
        // Try another locally revealed candidate before giving control back to the agent.
      }
    }

    return {
      result: nextResult,
      scanSessionId: effectiveScanSessionId,
      ...(revealDelta === undefined ? {} : { revealDelta }),
      finalCandidate,
      revealObserved
    };
  };

  return {
    runPostRevealContinuation,
  };
};
