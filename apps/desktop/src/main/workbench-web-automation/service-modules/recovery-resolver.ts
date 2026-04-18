import type {
  WorkbenchWebAction,
  WorkbenchWebActionRequest,
  WorkbenchWebActionResult,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanScope,
} from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebSessionRegistry } from "../agent-session/registry";
import type { FocusAtlasRegistry } from "../focus-atlas/registry";
import { rankLiveSelectorCandidates } from "../live-selector/candidate-ranker";
import type { LiveSelectorScanRegistry } from "../live-selector/scan-session";
import type {
  LiveSelectorScanCandidateRecord,
  LiveSelectorScanSession,
} from "../live-selector/types";
import type {
  WorkbenchWebAutomationCallContext,
  WorkbenchWebAutomationServiceDeps,
  WorkbenchWebGraphSnapshot,
} from "../types";
import {
  buildExplicitTargetRecoveryIntent,
  findBestActionTargetCandidate,
  hasExplicitActionTargetSignal,
  hasHardStructuredActionTargetSignal,
  hasSidebarHistoryIntent,
  hasTextualActionTargetHints,
  isWeakCssSelector,
  scoreActionTargetCandidate,
} from "./action-target-helpers";

type CandidateResolution = {
  readonly scanSessionId: string;
  readonly candidate: LiveSelectorScanCandidateRecord;
};

type WorkflowCandidateResolution = CandidateResolution & {
  readonly scanSession: LiveSelectorScanSession;
};

export type WorkbenchWebRecoveryMethodsRuntime = {
  readonly createWebAutomationError: (...args: any[]) => Error;
  readonly toActionIntent: (
    action: WorkbenchWebAction,
    seed?: Record<string, unknown>
  ) => WorkbenchWebTargetIntent;
  readonly adaptiveScanScopes: (
    preferredScope: WorkbenchWebTargetScanScope
  ) => readonly WorkbenchWebTargetScanScope[];
  readonly scanScopeOnce: (args: any) => Promise<any>;
  readonly executeWebActionWithDeadline: (args: any) => Promise<WorkbenchWebActionResult>;
  readonly syntheticGraphFromCandidate: (
    tabId: string,
    scanSessionId: string,
    candidate: LiveSelectorScanCandidateRecord
  ) => WorkbenchWebGraphSnapshot;
  readonly runLiveSelectorScan: (args: any) => Promise<any>;
  readonly runAdaptiveLiveSelectorScan: (args: any) => Promise<any>;
  readonly readAgentSession: (...args: any[]) => any;
  readonly isWeakStableSignatureTarget: (value: unknown) => boolean;
};

export const readAutomationErrorCode = (error: unknown): string =>
  typeof (error as { readonly code?: unknown })?.code === "string"
    ? (error as { readonly code: string }).code
    : "";

const readAutomationErrorMessage = (error: unknown): string =>
  typeof (error as { readonly message?: unknown })?.message === "string"
    ? (error as { readonly message: string }).message
    : "";

export const isNoInteractableCandidatesError = (error: unknown): boolean =>
  readAutomationErrorCode(error) === "no_interactable_candidates";

export const createWorkbenchWebRecoveryMethods = (
  runtime: WorkbenchWebRecoveryMethodsRuntime
) => {
  const {
    createWebAutomationError,
    toActionIntent,
    adaptiveScanScopes,
    scanScopeOnce,
    executeWebActionWithDeadline,
    syntheticGraphFromCandidate,
    runLiveSelectorScan,
    runAdaptiveLiveSelectorScan,
    readAgentSession,
    isWeakStableSignatureTarget,
  } = runtime;

  const isRecoverableCandidateResolutionError = (error: unknown): boolean => {
    const code = typeof (error as { readonly code?: unknown })?.code === "string"
      ? (error as { readonly code: string }).code
      : "";
    return code === "candidate_stale"
      || code === "candidate_not_found"
      || code === "scan_session_not_found"
      || code === "node_not_found";
  };

  const isRetriableActionError = (error: unknown): boolean => {
    const code = readAutomationErrorCode(error);
    const message = readAutomationErrorMessage(error).toLowerCase();
    return code === "node_not_found"
      || code === "not_interactable"
      || code === "element_not_stable"
      || code === "pointer_intercepted"
      || code === "script_execution_timeout"
      || code === "script_execution_failed"
      || code === "cross_origin_frame_blocked"
      || code === "CAPABILITY_INVOKE_FAILED"
      || message.includes("unknown browser frame")
      || message.includes("frame script timed out")
      || message.includes("timed out after");
  };

  const shouldRetryActionError = ({
    error,
    action,
    explicitTarget,
    sidebarIntent
  }: {
    readonly error: unknown;
    readonly action: WorkbenchWebAction;
    readonly explicitTarget: boolean;
    readonly sidebarIntent: boolean;
  }): boolean => {
    if (isRetriableActionError(error)) {
      return true;
    }
    const code = readAutomationErrorCode(error);
    return code === "workflow_not_advanced"
      && action.kind === "click"
      && explicitTarget
      && sidebarIntent;
  };

  const runWithMicroRetry = async ({
    execute,
    deps,
    tabId,
    action,
    candidate,
    scanRegistry,
    context,
    agentSessions
  }: {
    readonly execute: () => Promise<WorkbenchWebActionResult>;
    readonly deps: WorkbenchWebAutomationServiceDeps;
    readonly tabId: string;
    readonly action: WorkbenchWebAction;
    readonly candidate: LiveSelectorScanCandidateRecord;
    readonly scanRegistry: LiveSelectorScanRegistry;
    readonly context?: WorkbenchWebAutomationCallContext;
    readonly agentSessions: WorkbenchAgentWebSessionRegistry;
  }): Promise<WorkbenchWebActionResult> => {
    const targetRecord =
      (action as { readonly target?: unknown }).target !== null
      && typeof (action as { readonly target?: unknown }).target === "object"
      && !Array.isArray((action as { readonly target?: unknown }).target)
        ? (action as { readonly target: Record<string, unknown> }).target
        : undefined;
    const explicitTarget = hasExplicitActionTargetSignal(targetRecord);
    const sidebarIntent = hasSidebarHistoryIntent(targetRecord);

    try {
      return await execute();
    } catch (error) {
      if (!shouldRetryActionError({
        error,
        action,
        explicitTarget,
        sidebarIntent
      })) {
        throw error;
      }
    }

    const intent = toActionIntent(action, {
      tagName: candidate.stableSignature.tagName,
      ...(candidate.stableSignature.role === undefined ? {} : { role: candidate.stableSignature.role }),
      ...(candidate.stableSignature.ariaLabel === undefined ? {} : { ariaLabel: candidate.stableSignature.ariaLabel }),
      ...(candidate.textSnippet === undefined ? {} : { textSnippet: candidate.textSnippet })
    });
    const surfaceSession = context?.agentSessionId && context?.agentTurnId
      ? agentSessions.read(context.agentSessionId, context.agentTurnId, tabId) ?? null
      : null;

    let freshScan: Awaited<ReturnType<typeof scanScopeOnce>> | null = null;
    let freshScope: WorkbenchWebTargetScanScope = "visible";
    for (const scope of adaptiveScanScopes("visible")) {
      try {
        const scanned = await scanScopeOnce({
          deps,
          tabId,
          intent,
          scope,
          maxCandidates: scope === "expanded" ? 96 : scope === "nearby" ? 64 : 32,
          ...(surfaceSession === null ? {} : { surfaceSession })
        });
        freshScan = scanned;
        freshScope = scope;
        if (scanned.candidates.length > 0) {
          break;
        }
      } catch (error) {
        if (!isNoInteractableCandidatesError(error)) {
          throw error;
        }
      }
    }

    if (freshScan === null || freshScan.candidates.length === 0) {
      throw createWebAutomationError(
        explicitTarget ? "candidate_stale" : "node_not_found",
        explicitTarget
          ? "micro-retry re-scan did not find the explicit target in current page state"
          : "micro-retry re-scan did not find a confident match",
        "resolve_node",
        true,
        {
          details: {
            microRetryAttempted: true,
            explicitTarget,
            bestScore: 0
          }
        }
      );
    }

    const bestCandidate = explicitTarget && targetRecord !== undefined
      ? findBestActionTargetCandidate({
          candidates: freshScan.candidates,
          target: targetRecord,
          actionKind: action.kind,
          action
        })
      : rankLiveSelectorCandidates(freshScan.candidates, intent)[0];

    if (bestCandidate === undefined || (!explicitTarget && bestCandidate.score < 18)) {
      throw createWebAutomationError(
        explicitTarget ? "candidate_stale" : "node_not_found",
        explicitTarget
          ? "micro-retry re-scan did not find the explicit target in current page state"
          : "micro-retry re-scan did not find a confident match",
        "resolve_node",
        true,
        {
          details: {
            microRetryAttempted: true,
            explicitTarget,
            bestScore: bestCandidate?.score ?? 0
          }
        }
      );
    }

    const freshSession = scanRegistry.write({
      tabId,
      scope: freshScope,
      intent,
      pageMode: freshScan.pageMode,
      widgets: freshScan.widgets,
      containerNodes: freshScan.containerNodes,
      candidates: freshScan.candidates
    });

    const retryResult = await executeWebActionWithDeadline({
      browserBridge: deps.browserBridge,
      graph: syntheticGraphFromCandidate(tabId, freshSession.scanSessionId, bestCandidate),
      request: {
        action: {
          ...action,
          target: {
            candidateId: bestCandidate.candidateId,
            scanSessionId: freshSession.scanSessionId,
            selectorAddress: bestCandidate.selectorAddress,
            stableSignature: bestCandidate.stableSignature
          }
        } as WorkbenchWebAction
      },
      ...(context?.agentSessionId && context?.agentTurnId
        ? (() => {
            const session = agentSessions.read(context.agentSessionId, context.agentTurnId, tabId);
            return session?.pointer ? { pointerState: session.pointer } : {};
          })()
        : {})
    });

    return {
      ...retryResult,
      scanSessionId: freshSession.scanSessionId,
      note: [retryResult.note, "resolved by micro-retry re-scan"].filter(Boolean).join("; ")
    };
  };

  const resolveCandidateReference = async ({
    target,
    actionKind,
    action,
    deps,
    scanRegistry,
    focusAtlasRegistry,
    tabId,
    context,
    agentSessions
  }: {
    readonly target: Record<string, unknown> | undefined;
    readonly actionKind?: WorkbenchWebAction["kind"];
    readonly action?: WorkbenchWebAction;
    readonly deps?: WorkbenchWebAutomationServiceDeps;
    readonly scanRegistry: LiveSelectorScanRegistry;
    readonly focusAtlasRegistry: FocusAtlasRegistry;
    readonly tabId: string;
    readonly context?: WorkbenchWebAutomationCallContext;
    readonly agentSessions: WorkbenchAgentWebSessionRegistry;
  }): Promise<CandidateResolution> => {
    const nodeRef =
      target?.nodeRef !== null && typeof target?.nodeRef === "object" && !Array.isArray(target.nodeRef)
        ? target.nodeRef as Record<string, unknown>
        : undefined;
    const scanSessionId =
      typeof target?.scanSessionId === "string"
        ? target.scanSessionId
        : typeof nodeRef?.scanSessionId === "string"
          ? nodeRef.scanSessionId
          : null;
    const candidateId =
      typeof target?.candidateId === "string"
        ? target.candidateId
        : typeof nodeRef?.nodeId === "string"
          ? nodeRef.nodeId
          : null;
    const revision = typeof nodeRef?.revision === "string" ? nodeRef.revision : undefined;
    const atlasEntry = focusAtlasRegistry.read(tabId);
    const agentSession = readAgentSession(agentSessions, context, tabId);
    const preferredScanSessionId =
      scanSessionId
      ?? agentSession?.scanSessionId
      ?? atlasEntry?.preferredScanSessionId;
    const revisionMismatch =
      revision !== undefined
      && atlasEntry !== null
      && atlasEntry.atlas.version !== revision;

    if (revision !== undefined) {
      if (revisionMismatch && !hasExplicitActionTargetSignal(target)) {
        throw createWebAutomationError(
          "candidate_stale",
          "nodeRef revision is stale for the active page skeleton",
          "resolve_node",
          true,
          {
            details: {
              expectedRevision: revision,
              currentRevision: atlasEntry?.atlas.version
            }
          }
        );
      }
    }

    if (scanSessionId !== null && revisionMismatch !== true && candidateId !== null) {
      const candidate = scanRegistry.readCandidate(scanSessionId, candidateId);
      if (candidate !== null) {
        return { scanSessionId, candidate };
      }
    }

    if (agentSession?.scanSessionId && revisionMismatch !== true && candidateId !== null) {
      const candidate = scanRegistry.readCandidate(agentSession.scanSessionId, candidateId);
      if (candidate !== null) {
        return {
          scanSessionId: agentSession.scanSessionId,
          candidate
        };
      }
    }

    if (candidateId !== null && revisionMismatch !== true) {
      const recentCandidate = scanRegistry.readRecentCandidate(candidateId, {
        tabId,
        ...(preferredScanSessionId === undefined ? {} : { preferredScanSessionId })
      });
      if (recentCandidate !== null) {
        return recentCandidate;
      }
    }

    if (target !== undefined && hasExplicitActionTargetSignal(target)) {
      const matched = scanRegistry.findRecentCandidate({
        tabId,
        ...(preferredScanSessionId === undefined ? {} : { preferredScanSessionId }),
        match: (candidate) => scoreActionTargetCandidate({
          actionKind,
          ...(action === undefined ? {} : { action }),
          target,
          candidate
        })
      });
      if (matched !== null) {
        return matched;
      }

      if (deps !== undefined) {
        const recoveryIntent = buildExplicitTargetRecoveryIntent({
          target,
          actionKind
        });
        const tryRecoveryScan = async (scope: WorkbenchWebTargetScanScope) => {
          const recovered = await runLiveSelectorScan({
            deps,
            tabId,
            request: {
              tabId,
              intent: recoveryIntent,
              scope,
              maxCandidates: scope === "expanded" ? 96 : 64
            },
            registry: scanRegistry,
            ...(context === undefined ? {} : { context }),
            agentSessions,
            focusAtlasRegistry
          }).catch(() => null);
          if (recovered === null) {
            return null;
          }
          const recoveredCandidate = findBestActionTargetCandidate({
            candidates: recovered.candidates as readonly LiveSelectorScanCandidateRecord[],
            target,
            actionKind,
            ...(action === undefined ? {} : { action })
          });
          if (recoveredCandidate === undefined) {
            return null;
          }
          return {
            scanSessionId: recovered.scanSessionId,
            candidate: recoveredCandidate
          };
        };

        const visibleRecovered = await tryRecoveryScan("visible");
        if (visibleRecovered !== null) {
          return visibleRecovered;
        }
        if (hasTextualActionTargetHints(target)) {
          const expandedRecovered = await tryRecoveryScan("expanded");
          if (expandedRecovered !== null) {
            return expandedRecovered;
          }
        }
      }
    }

    if (candidateId === null) {
      throw createWebAutomationError(
        "candidate_not_found",
        "action target did not resolve to a known node in the active workflow context",
        "resolve_node",
        true
      );
    }

    if (revisionMismatch) {
      throw createWebAutomationError(
        "candidate_stale",
        "nodeRef revision is stale for the active page skeleton",
        "resolve_node",
        true,
        {
          details: {
            expectedRevision: revision,
            currentRevision: atlasEntry?.atlas.version
          }
        }
      );
    }

    throw createWebAutomationError(
      "candidate_stale",
      "candidate target is no longer available in the active workflow context",
      "resolve_node",
      true
    );
  };

  const resolveCandidateFromAction = async ({
    deps,
    request,
    scanRegistry,
    focusAtlasRegistry,
    tabId,
    context,
    agentSessions
  }: {
    readonly deps: WorkbenchWebAutomationServiceDeps;
    readonly request: WorkbenchWebActionRequest;
    readonly scanRegistry: LiveSelectorScanRegistry;
    readonly focusAtlasRegistry: FocusAtlasRegistry;
    readonly tabId: string;
    readonly context?: WorkbenchWebAutomationCallContext;
    readonly agentSessions: WorkbenchAgentWebSessionRegistry;
  }): Promise<CandidateResolution> =>
    resolveCandidateReference({
      target: (request.action as { readonly target?: Record<string, unknown> }).target,
      actionKind: request.action.kind,
      action: request.action,
      deps,
      scanRegistry,
      focusAtlasRegistry,
      tabId,
      ...(context === undefined ? {} : { context }),
      agentSessions
    });

  const resolveImplicitRecentCandidateFromContext = ({
    request,
    scanRegistry,
    tabId,
    context,
    agentSessions
  }: {
    readonly request: WorkbenchWebActionRequest;
    readonly scanRegistry: LiveSelectorScanRegistry;
    readonly tabId: string;
    readonly context?: WorkbenchWebAutomationCallContext;
    readonly agentSessions: WorkbenchAgentWebSessionRegistry;
  }): WorkflowCandidateResolution | null => {
    const target = (request.action as { readonly target?: Record<string, unknown> }).target;
    if (hasExplicitActionTargetSignal(target)) {
      return null;
    }
    const cssSelector =
      typeof target?.cssSelector === "string" && target.cssSelector.trim().length > 0
        ? target.cssSelector.trim()
        : null;
    if (
      typeof target?.nodeId === "string"
      || (target?.selectorAddress !== undefined && target.selectorAddress !== null)
      || (
        target?.stableSignature !== undefined
        && target.stableSignature !== null
        && !isWeakStableSignatureTarget(target.stableSignature)
      )
      || (cssSelector !== null && !isWeakCssSelector(cssSelector))
    ) {
      return null;
    }
    if (!context?.agentSessionId || !context.agentTurnId) {
      return null;
    }

    const agentSession = agentSessions.read(context.agentSessionId, context.agentTurnId, tabId);
    if (!agentSession?.scanSessionId) {
      return null;
    }

    const scanSession = scanRegistry.read(agentSession.scanSessionId);
    if (scanSession === null || scanSession.candidates.length === 0) {
      return null;
    }

    const ranked = rankLiveSelectorCandidates(scanSession.candidates, toActionIntent(request.action));
    const bestCandidate = ranked[0];
    if (bestCandidate === undefined) {
      return null;
    }
    const secondCandidate = ranked[1];
    const confidenceMargin = secondCandidate === undefined ? bestCandidate.score : bestCandidate.score - secondCandidate.score;
    if (bestCandidate.score < 18 && confidenceMargin < 8) {
      return null;
    }

    return {
      scanSessionId: scanSession.scanSessionId,
      candidate: bestCandidate,
      scanSession
    };
  };

  const resolveWorkflowCandidateFromContext = async ({
    request,
    scanRegistry,
    deps,
    tabId,
    context,
    agentSessions,
    focusAtlasRegistry
  }: {
    readonly request: WorkbenchWebActionRequest;
    readonly scanRegistry: LiveSelectorScanRegistry;
    readonly deps: WorkbenchWebAutomationServiceDeps;
    readonly tabId: string;
    readonly context?: WorkbenchWebAutomationCallContext;
    readonly agentSessions: WorkbenchAgentWebSessionRegistry;
    readonly focusAtlasRegistry: FocusAtlasRegistry;
  }): Promise<WorkflowCandidateResolution | null> => {
    const target = (request.action as { readonly target?: Record<string, unknown> }).target;
    const hasExplicitTarget = hasExplicitActionTargetSignal(target);
    const hasHardStructuredTarget = hasHardStructuredActionTargetSignal(target);

    const agentSession = readAgentSession(agentSessions, context, tabId);
    const widgetId = agentSession?.activeItemId ?? agentSession?.activeWidgetId ?? agentSession?.hoveredWidgetId;

    const rescanned = await runAdaptiveLiveSelectorScan({
      deps,
      tabId,
      request: {
        tabId,
        intent: toActionIntent(request.action),
        ...(widgetId === undefined ? {} : { widgetId }),
        scope: "visible",
        maxCandidates: 24
      },
      registry: scanRegistry,
      ...(context === undefined ? {} : { context }),
      agentSessions,
      focusAtlasRegistry
    }).catch(() => null);
    if (rescanned?.bestCandidate === undefined) {
      return null;
    }

    const scanSession = scanRegistry.read(rescanned.scanSessionId);
    if (scanSession === null) {
      return null;
    }

    let candidate = scanRegistry.readCandidate(rescanned.scanSessionId, rescanned.bestCandidate.candidateId);
    if (candidate === null) {
      return null;
    }
    if (target !== undefined && hasExplicitTarget) {
      const matched = findBestActionTargetCandidate({
        candidates: rescanned.candidates as readonly LiveSelectorScanCandidateRecord[],
        target,
        actionKind: request.action.kind,
        action: request.action
      });
      if (matched !== undefined) {
        candidate = matched;
      } else if (hasHardStructuredTarget) {
        return null;
      }
    }

    return {
      scanSessionId: rescanned.scanSessionId,
      candidate,
      scanSession
    };
  };

  return {
    isRecoverableCandidateResolutionError,
    runWithMicroRetry,
    resolveCandidateReference,
    resolveCandidateFromAction,
    resolveImplicitRecentCandidateFromContext,
    resolveWorkflowCandidateFromContext,
  };
};
