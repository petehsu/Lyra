import type {
  WorkbenchWebActionRequest,
  WorkbenchWebActionResult,
  WorkbenchWebWaitRequest,
  WorkbenchWebWaitResult,
} from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebSessionRegistry } from "../agent-session/registry";
import type { WorkbenchAgentWebSession } from "../agent-session/types";
import type { WorkbenchWebAutomationCache } from "../cache";
import type { FocusAtlasRegistry } from "../focus-atlas/registry";
import type { LiveSelectorScanRegistry } from "../live-selector/scan-session";
import type {
  LiveSelectorScanCandidateRecord,
  LiveSelectorScanSession,
} from "../live-selector/types";
import type {
  WorkbenchWebAutomationCallContext,
  WorkbenchWebAutomationService,
  WorkbenchWebAutomationServiceDeps,
  WorkbenchWebGraphSnapshot,
} from "../types";
import type { WorkbenchWebAutomationStore } from "../store";

type CandidateResolution = {
  readonly scanSessionId: string;
  readonly candidate: LiveSelectorScanCandidateRecord;
};

type WorkflowCandidateResolution = {
  readonly scanSessionId: string;
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly scanSession: LiveSelectorScanSession;
};

type RunPostRevealContinuation = (args: {
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

export type WorkbenchWebActionMethods = Pick<
  WorkbenchWebAutomationService,
  "runSafeAction" | "runMutateAction" | "runNavigateAction" | "waitForTarget"
>;

export type WorkbenchWebActionMethodsRuntime = {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly cache: WorkbenchWebAutomationCache;
  readonly store: WorkbenchWebAutomationStore;
  readonly scanRegistry: LiveSelectorScanRegistry;
  readonly focusAtlasRegistry: FocusAtlasRegistry;
  readonly agentSessions: WorkbenchAgentWebSessionRegistry;
  readonly assertActionAllowed: (
    request: WorkbenchWebActionRequest,
    mode: "safe" | "mutate" | "navigate"
  ) => void;
  readonly resolveTabId: (
    deps: WorkbenchWebAutomationServiceDeps,
    requested?: string
  ) => string;
  readonly assertActiveVisiblePage: (
    deps: WorkbenchWebAutomationServiceDeps,
    tabId: string
  ) => void;
  readonly hasExplicitActionTargetSignal: (
    target: Record<string, unknown> | undefined
  ) => boolean;
  readonly resolveCandidateFromAction: (args: {
    readonly deps: WorkbenchWebAutomationServiceDeps;
    readonly request: WorkbenchWebActionRequest;
    readonly scanRegistry: LiveSelectorScanRegistry;
    readonly focusAtlasRegistry: FocusAtlasRegistry;
    readonly tabId: string;
    readonly context?: WorkbenchWebAutomationCallContext;
    readonly agentSessions: WorkbenchAgentWebSessionRegistry;
  }) => Promise<CandidateResolution>;
  readonly withResolvedCandidateTarget: (
    request: WorkbenchWebActionRequest,
    candidate: LiveSelectorScanCandidateRecord,
    scanSessionId: string
  ) => WorkbenchWebActionRequest;
  readonly showAgentSelectorTarget: (...args: any[]) => Promise<boolean>;
  readonly toAgentTargetFromCandidate: (...args: any[]) => any;
  readonly runWithMicroRetry: (...args: any[]) => Promise<WorkbenchWebActionResult>;
  readonly executeWebActionWithDeadline: (...args: any[]) => Promise<WorkbenchWebActionResult>;
  readonly syntheticGraphFromCandidate: (
    tabId: string,
    scanSessionId: string,
    candidate: LiveSelectorScanCandidateRecord
  ) => WorkbenchWebGraphSnapshot;
  readonly pointerStateForContext: (...args: any[]) => Record<string, unknown>;
  readonly shouldResetWorkflowContext: (
    result: WorkbenchWebActionResult
  ) => boolean;
  readonly buildWorkflowSessionPatch: (args: {
    readonly candidate: LiveSelectorScanCandidateRecord;
    readonly scanSession: LiveSelectorScanSession | null;
    readonly subgoal: string;
    readonly result?: WorkbenchWebActionResult;
  }) => Partial<WorkbenchAgentWebSession>;
  readonly inferSubgoalFromAction: (
    action: WorkbenchWebActionRequest["action"]
  ) => string;
  readonly isRecoverableCandidateResolutionError: (error: unknown) => boolean;
  readonly resolveWorkflowCandidateFromContext: (args: {
    readonly request: WorkbenchWebActionRequest;
    readonly scanRegistry: LiveSelectorScanRegistry;
    readonly deps: WorkbenchWebAutomationServiceDeps;
    readonly tabId: string;
    readonly context?: WorkbenchWebAutomationCallContext;
    readonly agentSessions: WorkbenchAgentWebSessionRegistry;
    readonly focusAtlasRegistry: FocusAtlasRegistry;
  }) => Promise<WorkflowCandidateResolution | null>;
  readonly resolveImplicitRecentCandidateFromContext: (args: {
    readonly request: WorkbenchWebActionRequest;
    readonly scanRegistry: LiveSelectorScanRegistry;
    readonly tabId: string;
    readonly context?: WorkbenchWebAutomationCallContext;
    readonly agentSessions: WorkbenchAgentWebSessionRegistry;
  }) => WorkflowCandidateResolution | null;
  readonly ensureGraphLoaded: (args: {
    readonly tabId: string;
    readonly graphId?: string | undefined;
    readonly forceBuild?: boolean | undefined;
    readonly deps: WorkbenchWebAutomationServiceDeps;
    readonly cache: WorkbenchWebAutomationCache;
    readonly store: WorkbenchWebAutomationStore;
  }) => Promise<WorkbenchWebGraphSnapshot>;
  readonly invalidateTabGraphCache: (
    cache: WorkbenchWebAutomationCache,
    tabId: string,
    graphId: string | undefined
  ) => void;
  readonly runPostRevealContinuation: RunPostRevealContinuation;
  readonly clearAgentSelectorTarget: (
    browserBridge: WorkbenchWebAutomationServiceDeps["browserBridge"],
    tabId: string,
    options?: { readonly preserveManualMode?: boolean }
  ) => Promise<void>;
  readonly resolveCandidateReference: (args: {
    readonly target: Record<string, unknown>;
    readonly deps: WorkbenchWebAutomationServiceDeps;
    readonly scanRegistry: LiveSelectorScanRegistry;
    readonly focusAtlasRegistry: FocusAtlasRegistry;
    readonly tabId: string;
    readonly context?: WorkbenchWebAutomationCallContext;
    readonly agentSessions: WorkbenchAgentWebSessionRegistry;
  }) => Promise<CandidateResolution>;
  readonly withResolvedWaitTarget: (
    request: WorkbenchWebWaitRequest,
    candidate: LiveSelectorScanCandidateRecord,
    scanSessionId: string
  ) => WorkbenchWebWaitRequest;
  readonly waitForResolvedTarget: (args: {
    readonly browserBridge: WorkbenchWebAutomationServiceDeps["browserBridge"];
    readonly graph: WorkbenchWebGraphSnapshot;
    readonly request: WorkbenchWebWaitRequest;
  }) => Promise<WorkbenchWebWaitResult>;
};

export const createWorkbenchWebActionMethods = (
  runtime: WorkbenchWebActionMethodsRuntime
): WorkbenchWebActionMethods => {
  const {
    deps,
    cache,
    store,
    scanRegistry,
    focusAtlasRegistry,
    agentSessions,
    assertActionAllowed,
    resolveTabId,
    assertActiveVisiblePage,
    hasExplicitActionTargetSignal,
    resolveCandidateFromAction,
    withResolvedCandidateTarget,
    showAgentSelectorTarget,
    toAgentTargetFromCandidate,
    runWithMicroRetry,
    executeWebActionWithDeadline,
    syntheticGraphFromCandidate,
    pointerStateForContext,
    shouldResetWorkflowContext,
    buildWorkflowSessionPatch,
    inferSubgoalFromAction,
    isRecoverableCandidateResolutionError,
    resolveWorkflowCandidateFromContext,
    resolveImplicitRecentCandidateFromContext,
    ensureGraphLoaded,
    invalidateTabGraphCache,
    runPostRevealContinuation,
    clearAgentSelectorTarget,
    resolveCandidateReference,
    withResolvedWaitTarget,
    waitForResolvedTarget,
  } = runtime;

  return {
    runSafeAction: async (
      request: WorkbenchWebActionRequest,
      context?: WorkbenchWebAutomationCallContext
    ): Promise<WorkbenchWebActionResult> => {
      assertActionAllowed(request, "safe");
      const tabId = resolveTabId(deps, request.tabId);
      assertActiveVisiblePage(deps, tabId);

      const target = (request.action as { readonly target?: Record<string, unknown> }).target;
      const hasCandidate = hasExplicitActionTargetSignal(target);
      const fallbackRequest = request;
      let overlayShown = false;
      try {
        if (hasCandidate) {
          try {
            const { scanSessionId, candidate } = await resolveCandidateFromAction({
              deps,
              request,
              scanRegistry,
              focusAtlasRegistry,
              tabId,
              ...(context === undefined ? {} : { context }),
              agentSessions
            });
            const scanSession = scanRegistry.read(scanSessionId);
            const resolvedRequest = withResolvedCandidateTarget(request, candidate, scanSessionId);
            if (context?.toolCallId) {
              overlayShown = await showAgentSelectorTarget(
                deps.browserBridge,
                toAgentTargetFromCandidate({
                  tabId,
                  toolCallId: context.toolCallId,
                  owner: "agent_action",
                  phase: "resolve",
                  candidate,
                  ...(scanSession === null
                    ? {}
                    : {
                        pageMode: scanSession.pageMode,
                        widgets: scanSession.widgets
                      })
                })
              ).catch(() => false);
            }
            const result = await runWithMicroRetry({
              execute: () => executeWebActionWithDeadline({
                browserBridge: deps.browserBridge,
                graph: syntheticGraphFromCandidate(tabId, scanSessionId, candidate),
                request: resolvedRequest,
                ...pointerStateForContext(agentSessions, context, tabId)
              }),
              deps,
              tabId,
              action: resolvedRequest.action,
              candidate,
              scanRegistry,
              ...(context === undefined ? {} : { context }),
              agentSessions
            });
            const resetWorkflow = shouldResetWorkflowContext(result);
            if (resetWorkflow) {
              agentSessions.clear(tabId);
            } else if (context?.agentSessionId && context?.agentTurnId) {
              agentSessions.upsert({
                agentSessionId: context.agentSessionId,
                agentTurnId: context.agentTurnId,
                tabId,
                scanSessionId,
                ...buildWorkflowSessionPatch({
                  candidate,
                  scanSession,
                  subgoal: inferSubgoalFromAction(request.action),
                  result
                })
              });
            }
            return {
              ...result,
              scanSessionId,
              overlayShown
            };
          } catch (error) {
            if (!isRecoverableCandidateResolutionError(error)) {
              throw error;
            }
          }
        }

        const workflowCandidate = await resolveWorkflowCandidateFromContext({
          request: fallbackRequest,
          scanRegistry,
          deps,
          tabId,
          ...(context === undefined ? {} : { context }),
          agentSessions,
          focusAtlasRegistry
        });
        if (workflowCandidate !== null) {
          if (context?.toolCallId) {
            overlayShown = await showAgentSelectorTarget(
              deps.browserBridge,
              toAgentTargetFromCandidate({
                tabId,
                toolCallId: context.toolCallId,
                owner: "agent_action",
                phase: "resolve",
                candidate: workflowCandidate.candidate,
                pageMode: workflowCandidate.scanSession.pageMode,
                widgets: workflowCandidate.scanSession.widgets
              })
            ).catch(() => false);
          }
          const result = await executeWebActionWithDeadline({
            browserBridge: deps.browserBridge,
            graph: syntheticGraphFromCandidate(tabId, workflowCandidate.scanSessionId, workflowCandidate.candidate),
            request: withResolvedCandidateTarget(
              fallbackRequest,
              workflowCandidate.candidate,
              workflowCandidate.scanSessionId
            ),
            ...pointerStateForContext(agentSessions, context, tabId)
          });
          const resetWorkflow = shouldResetWorkflowContext(result);
          if (resetWorkflow) {
            agentSessions.clear(tabId);
          } else if (context?.agentSessionId && context?.agentTurnId) {
            agentSessions.upsert({
              agentSessionId: context.agentSessionId,
              agentTurnId: context.agentTurnId,
              tabId,
              scanSessionId: workflowCandidate.scanSessionId,
              ...buildWorkflowSessionPatch({
                candidate: workflowCandidate.candidate,
                scanSession: workflowCandidate.scanSession,
                subgoal: inferSubgoalFromAction(fallbackRequest.action),
                result
              })
            });
          }
          return {
            ...result,
            scanSessionId: workflowCandidate.scanSessionId,
            overlayShown
          };
        }

        const implicitCandidate = resolveImplicitRecentCandidateFromContext({
          request: fallbackRequest,
          scanRegistry,
          tabId,
          ...(context === undefined ? {} : { context }),
          agentSessions
        });
        if (implicitCandidate !== null) {
          if (context?.toolCallId) {
            overlayShown = await showAgentSelectorTarget(
              deps.browserBridge,
              toAgentTargetFromCandidate({
                tabId,
                toolCallId: context.toolCallId,
                owner: "agent_action",
                phase: "resolve",
                candidate: implicitCandidate.candidate,
                pageMode: implicitCandidate.scanSession.pageMode,
                widgets: implicitCandidate.scanSession.widgets
              })
            ).catch(() => false);
          }
          const result = await executeWebActionWithDeadline({
            browserBridge: deps.browserBridge,
            graph: syntheticGraphFromCandidate(tabId, implicitCandidate.scanSessionId, implicitCandidate.candidate),
            request: withResolvedCandidateTarget(
              fallbackRequest,
              implicitCandidate.candidate,
              implicitCandidate.scanSessionId
            ),
            ...pointerStateForContext(agentSessions, context, tabId)
          });
          const resetWorkflow = shouldResetWorkflowContext(result);
          if (resetWorkflow) {
            agentSessions.clear(tabId);
          } else if (context?.agentSessionId && context?.agentTurnId) {
            agentSessions.upsert({
              agentSessionId: context.agentSessionId,
              agentTurnId: context.agentTurnId,
              tabId,
              scanSessionId: implicitCandidate.scanSessionId,
              ...buildWorkflowSessionPatch({
                candidate: implicitCandidate.candidate,
                scanSession: implicitCandidate.scanSession,
                subgoal: inferSubgoalFromAction(fallbackRequest.action),
                result
              })
            });
          }
          return {
            ...result,
            scanSessionId: implicitCandidate.scanSessionId,
            overlayShown
          };
        }

        const graph = await ensureGraphLoaded({
          tabId,
          graphId: request.graphId,
          forceBuild: false,
          deps,
          cache,
          store
        });
        const result = await executeWebActionWithDeadline({
          browserBridge: deps.browserBridge,
          graph,
          request: fallbackRequest,
          ...pointerStateForContext(agentSessions, context, tabId)
        });
        if (shouldResetWorkflowContext(result)) {
          agentSessions.clear(tabId);
        }
        return {
          ...result,
          overlayShown
        };
      } finally {
        if (context?.toolCallId) {
          await clearAgentSelectorTarget(deps.browserBridge, tabId, {
            preserveManualMode: true
          }).catch(() => undefined);
        }
      }
    },

    runMutateAction: async (
      request: WorkbenchWebActionRequest,
      context?: WorkbenchWebAutomationCallContext
    ): Promise<WorkbenchWebActionResult> => {
      assertActionAllowed(request, "mutate");
      const tabId = resolveTabId(deps, request.tabId);
      assertActiveVisiblePage(deps, tabId);

      const target = (request.action as { readonly target?: Record<string, unknown> }).target;
      const hasCandidate = hasExplicitActionTargetSignal(target);
      const fallbackRequest = request;
      let overlayShown = false;
      try {
        if (hasCandidate) {
          try {
            const { scanSessionId, candidate } = await resolveCandidateFromAction({
              deps,
              request,
              scanRegistry,
              focusAtlasRegistry,
              tabId,
              ...(context === undefined ? {} : { context }),
              agentSessions
            });
            const scanSession = scanRegistry.read(scanSessionId);
            const resolvedRequest = withResolvedCandidateTarget(request, candidate, scanSessionId);
            if (context?.toolCallId) {
              overlayShown = await showAgentSelectorTarget(
                deps.browserBridge,
                toAgentTargetFromCandidate({
                  tabId,
                  toolCallId: context.toolCallId,
                  owner: "agent_action",
                  phase: "act",
                  candidate,
                  ...(scanSession === null
                    ? {}
                    : {
                        pageMode: scanSession.pageMode,
                        widgets: scanSession.widgets
                      })
                })
              ).catch(() => false);
            }
            let result = await runWithMicroRetry({
              execute: () => executeWebActionWithDeadline({
                browserBridge: deps.browserBridge,
                graph: syntheticGraphFromCandidate(tabId, scanSessionId, candidate),
                request: resolvedRequest,
                ...pointerStateForContext(agentSessions, context, tabId)
              }),
              deps,
              tabId,
              action: resolvedRequest.action,
              candidate,
              scanRegistry,
              ...(context === undefined ? {} : { context }),
              agentSessions
            });
            invalidateTabGraphCache(cache, tabId, undefined);
            focusAtlasRegistry.invalidate(tabId);
            let effectiveScanSessionId = scanSessionId;
            let revealDelta = undefined;
            let sessionCandidate = candidate;
            let revealObserved = false;
            if (!shouldResetWorkflowContext(result)) {
              const revealFlow = await runPostRevealContinuation({
                tabId,
                request: resolvedRequest,
                result,
                sourceCandidate: candidate,
                sourceScanSession: scanSession,
                sourceScanSessionId: scanSessionId,
                ...(context === undefined ? {} : { context })
              });
              result = revealFlow.result;
              effectiveScanSessionId = revealFlow.scanSessionId;
              revealDelta = revealFlow.revealDelta;
              sessionCandidate = revealFlow.finalCandidate;
              revealObserved = revealFlow.revealObserved;
            }
            const finalResetWorkflow = shouldResetWorkflowContext(result);
            if (finalResetWorkflow) {
              agentSessions.clear(tabId);
            }
            if (!finalResetWorkflow && context?.agentSessionId && context?.agentTurnId) {
              const sessionForPatch = scanRegistry.read(effectiveScanSessionId) ?? scanSession;
              agentSessions.upsert({
                agentSessionId: context.agentSessionId,
                agentTurnId: context.agentTurnId,
                tabId,
                scanSessionId: effectiveScanSessionId,
                ...buildWorkflowSessionPatch({
                  candidate: sessionCandidate,
                  scanSession: sessionForPatch,
                  subgoal: inferSubgoalFromAction(fallbackRequest.action),
                  result
                }),
                ...(revealDelta === undefined ? {} : { lastLocalDelta: revealDelta }),
                lastRevealObserved: revealObserved
              });
            }
            return {
              ...result,
              scanSessionId: effectiveScanSessionId,
              overlayShown
            };
          } catch (error) {
            if (!isRecoverableCandidateResolutionError(error)) {
              throw error;
            }
          }
        }

        const workflowCandidate = await resolveWorkflowCandidateFromContext({
          request: fallbackRequest,
          scanRegistry,
          deps,
          tabId,
          ...(context === undefined ? {} : { context }),
          agentSessions,
          focusAtlasRegistry
        });
        if (workflowCandidate !== null) {
          if (context?.toolCallId) {
            overlayShown = await showAgentSelectorTarget(
              deps.browserBridge,
              toAgentTargetFromCandidate({
                tabId,
                toolCallId: context.toolCallId,
                owner: "agent_action",
                phase: "act",
                candidate: workflowCandidate.candidate,
                pageMode: workflowCandidate.scanSession.pageMode,
                widgets: workflowCandidate.scanSession.widgets
              })
            ).catch(() => false);
          }
          const resolvedWorkflowRequest = withResolvedCandidateTarget(
            fallbackRequest,
            workflowCandidate.candidate,
            workflowCandidate.scanSessionId
          );
          let result = await runWithMicroRetry({
            execute: () => executeWebActionWithDeadline({
              browserBridge: deps.browserBridge,
              graph: syntheticGraphFromCandidate(tabId, workflowCandidate.scanSessionId, workflowCandidate.candidate),
              request: resolvedWorkflowRequest,
              ...pointerStateForContext(agentSessions, context, tabId)
            }),
            deps,
            tabId,
            action: resolvedWorkflowRequest.action,
            candidate: workflowCandidate.candidate,
            scanRegistry,
            ...(context === undefined ? {} : { context }),
            agentSessions
          });
          invalidateTabGraphCache(cache, tabId, undefined);
          focusAtlasRegistry.invalidate(tabId);
          let effectiveScanSessionId = workflowCandidate.scanSessionId;
          let revealDelta = undefined;
          let sessionCandidate = workflowCandidate.candidate;
          let revealObserved = false;
          if (!shouldResetWorkflowContext(result)) {
            const revealFlow = await runPostRevealContinuation({
              tabId,
              request: resolvedWorkflowRequest,
              result,
              sourceCandidate: workflowCandidate.candidate,
              sourceScanSession: workflowCandidate.scanSession,
              sourceScanSessionId: workflowCandidate.scanSessionId,
              ...(context === undefined ? {} : { context })
            });
            result = revealFlow.result;
            effectiveScanSessionId = revealFlow.scanSessionId;
            revealDelta = revealFlow.revealDelta;
            sessionCandidate = revealFlow.finalCandidate;
            revealObserved = revealFlow.revealObserved;
          }
          const finalResetWorkflow = shouldResetWorkflowContext(result);
          if (finalResetWorkflow) {
            agentSessions.clear(tabId);
          } else if (context?.agentSessionId && context?.agentTurnId) {
            const sessionForPatch = scanRegistry.read(effectiveScanSessionId) ?? workflowCandidate.scanSession;
            agentSessions.upsert({
              agentSessionId: context.agentSessionId,
              agentTurnId: context.agentTurnId,
              tabId,
              scanSessionId: effectiveScanSessionId,
              ...buildWorkflowSessionPatch({
                candidate: sessionCandidate,
                scanSession: sessionForPatch,
                subgoal: inferSubgoalFromAction(fallbackRequest.action),
                result
              }),
              ...(revealDelta === undefined ? {} : { lastLocalDelta: revealDelta }),
              lastRevealObserved: revealObserved
            });
          }
          return {
            ...result,
            scanSessionId: effectiveScanSessionId,
            overlayShown
          };
        }

        const implicitCandidate = resolveImplicitRecentCandidateFromContext({
          request: fallbackRequest,
          scanRegistry,
          tabId,
          ...(context === undefined ? {} : { context }),
          agentSessions
        });
        if (implicitCandidate !== null) {
          if (context?.toolCallId) {
            overlayShown = await showAgentSelectorTarget(
              deps.browserBridge,
              toAgentTargetFromCandidate({
                tabId,
                toolCallId: context.toolCallId,
                owner: "agent_action",
                phase: "act",
                candidate: implicitCandidate.candidate,
                pageMode: implicitCandidate.scanSession.pageMode,
                widgets: implicitCandidate.scanSession.widgets
              })
            ).catch(() => false);
          }
          const resolvedImplicitRequest = withResolvedCandidateTarget(
            fallbackRequest,
            implicitCandidate.candidate,
            implicitCandidate.scanSessionId
          );
          let result = await runWithMicroRetry({
            execute: () => executeWebActionWithDeadline({
              browserBridge: deps.browserBridge,
              graph: syntheticGraphFromCandidate(tabId, implicitCandidate.scanSessionId, implicitCandidate.candidate),
              request: resolvedImplicitRequest,
              ...pointerStateForContext(agentSessions, context, tabId)
            }),
            deps,
            tabId,
            action: resolvedImplicitRequest.action,
            candidate: implicitCandidate.candidate,
            scanRegistry,
            ...(context === undefined ? {} : { context }),
            agentSessions
          });
          invalidateTabGraphCache(cache, tabId, undefined);
          focusAtlasRegistry.invalidate(tabId);
          let effectiveScanSessionId = implicitCandidate.scanSessionId;
          let revealDelta = undefined;
          let sessionCandidate = implicitCandidate.candidate;
          let revealObserved = false;
          if (!shouldResetWorkflowContext(result)) {
            const revealFlow = await runPostRevealContinuation({
              tabId,
              request: resolvedImplicitRequest,
              result,
              sourceCandidate: implicitCandidate.candidate,
              sourceScanSession: implicitCandidate.scanSession,
              sourceScanSessionId: implicitCandidate.scanSessionId,
              ...(context === undefined ? {} : { context })
            });
            result = revealFlow.result;
            effectiveScanSessionId = revealFlow.scanSessionId;
            revealDelta = revealFlow.revealDelta;
            sessionCandidate = revealFlow.finalCandidate;
            revealObserved = revealFlow.revealObserved;
          }
          const finalResetWorkflow = shouldResetWorkflowContext(result);
          if (finalResetWorkflow) {
            agentSessions.clear(tabId);
          }
          if (!finalResetWorkflow && context?.agentSessionId && context?.agentTurnId) {
            const sessionForPatch = scanRegistry.read(effectiveScanSessionId) ?? implicitCandidate.scanSession;
            agentSessions.upsert({
              agentSessionId: context.agentSessionId,
              agentTurnId: context.agentTurnId,
              tabId,
              scanSessionId: effectiveScanSessionId,
              ...buildWorkflowSessionPatch({
                candidate: sessionCandidate,
                scanSession: sessionForPatch,
                subgoal: inferSubgoalFromAction(fallbackRequest.action),
                result
              }),
              ...(revealDelta === undefined ? {} : { lastLocalDelta: revealDelta }),
              lastRevealObserved: revealObserved
            });
          }
          return {
            ...result,
            scanSessionId: effectiveScanSessionId,
            overlayShown
          };
        }

        const graph = await ensureGraphLoaded({
          tabId,
          graphId: request.graphId,
          forceBuild: false,
          deps,
          cache,
          store
        });
        const result = await executeWebActionWithDeadline({
          browserBridge: deps.browserBridge,
          graph,
          request: fallbackRequest,
          ...pointerStateForContext(agentSessions, context, tabId)
        });
        invalidateTabGraphCache(cache, tabId, graph.graphId);
        focusAtlasRegistry.invalidate(tabId);
        if (shouldResetWorkflowContext(result)) {
          agentSessions.clear(tabId);
        }
        return {
          ...result,
          overlayShown
        };
      } finally {
        if (context?.toolCallId) {
          await clearAgentSelectorTarget(deps.browserBridge, tabId, {
            preserveManualMode: true
          }).catch(() => undefined);
        }
      }
    },

    runNavigateAction: async (
      request: WorkbenchWebActionRequest,
      context?: WorkbenchWebAutomationCallContext
    ): Promise<WorkbenchWebActionResult> => {
      assertActionAllowed(request, "navigate");
      const tabId =
        request.action.kind === "goto_url" && request.action.target === "active-tab"
          ? resolveTabId(deps, "active-tab")
          : resolveTabId(deps, request.tabId);
      assertActiveVisiblePage(deps, tabId);

      let graph: WorkbenchWebGraphSnapshot;
      if (
        request.action.kind === "goto_url"
        || request.action.kind === "history_back"
        || request.action.kind === "history_forward"
        || request.action.kind === "reload"
      ) {
        graph = {
          tabId,
          graphId: "navigation",
          builtAt: Date.now(),
          nodeCount: 0,
          edgeCount: 0,
          interactableCount: 0,
          truncated: false,
          budgetExhausted: false,
          nodes: [],
          edges: []
        };
      } else {
        graph = await ensureGraphLoaded({
          tabId,
          graphId: request.graphId,
          forceBuild: false,
          deps,
          cache,
          store
        });
      }

      try {
        const result = await executeWebActionWithDeadline({
          browserBridge: deps.browserBridge,
          graph,
          request
        });
        invalidateTabGraphCache(cache, tabId, graph.graphId);
        focusAtlasRegistry.invalidate(tabId);
        agentSessions.clear(tabId);
        return result;
      } finally {
        if (context?.toolCallId) {
          await clearAgentSelectorTarget(deps.browserBridge, tabId, {
            preserveManualMode: true
          }).catch(() => undefined);
        }
      }
    },

    waitForTarget: async (
      request: WorkbenchWebWaitRequest,
      context?: WorkbenchWebAutomationCallContext
    ): Promise<WorkbenchWebWaitResult> => {
      const tabId = resolveTabId(deps, request.tabId);
      assertActiveVisiblePage(deps, tabId);
      const target = request.target as {
        readonly candidateId?: unknown;
        readonly scanSessionId?: unknown;
        readonly nodeRef?: { readonly nodeId?: unknown };
      };
      const hasCandidate =
        typeof target.candidateId === "string"
        || typeof target.nodeRef?.nodeId === "string";
      let overlayShown = false;
      try {
        if (hasCandidate) {
          const { scanSessionId, candidate } = await resolveCandidateReference({
            target: request.target as Record<string, unknown>,
            deps,
            scanRegistry,
            focusAtlasRegistry,
            tabId,
            ...(context === undefined ? {} : { context }),
            agentSessions
          });
          const scanSession = scanRegistry.read(scanSessionId);
          if (context?.toolCallId) {
            overlayShown = await showAgentSelectorTarget(
              deps.browserBridge,
              toAgentTargetFromCandidate({
                tabId,
                toolCallId: context.toolCallId,
                owner: "agent_wait",
                phase: "wait",
                candidate,
                ...(scanSession === null
                  ? {}
                  : {
                      pageMode: scanSession.pageMode,
                      widgets: scanSession.widgets
                    })
              })
            ).catch(() => false);
          }
          const result = await waitForResolvedTarget({
            browserBridge: deps.browserBridge,
            graph: syntheticGraphFromCandidate(tabId, scanSessionId, candidate),
            request: withResolvedWaitTarget(request, candidate, scanSessionId)
          });
          return {
            ...result,
            scanSessionId,
            overlayShown
          };
        }

        const graph = await ensureGraphLoaded({
          tabId,
          graphId: request.graphId,
          forceBuild: false,
          deps,
          cache,
          store
        });

        const result = await waitForResolvedTarget({
          browserBridge: deps.browserBridge,
          graph,
          request
        });
        return {
          ...result,
          overlayShown
        };
      } finally {
        if (context?.toolCallId) {
          await clearAgentSelectorTarget(deps.browserBridge, tabId, {
            preserveManualMode: true
          }).catch(() => undefined);
        }
      }
    }
  };
};
