import type {
  WorkbenchBrowserAgentActionResult,
  WorkbenchBrowserAgentElementMatchLevel,
  WorkbenchBrowserAgentObservation,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserAgentWorkflowResolvedStep
} from "../types";
import { matchElementIdentity } from "./agent-element-matcher";
import {
  invalidateWorkflowCache,
  loadWorkflowCacheForReplay,
  normalizeUrlForWorkflowCache,
  type WorkflowCacheStep
} from "./lumen-workflow-cache";

export type WorkflowStepResolveResult =
  | {
      readonly ok: true;
      readonly targetRef: string;
      readonly matchLevel?: WorkbenchBrowserAgentElementMatchLevel;
    }
  | {
      readonly ok: false;
    };

export const resolveWorkflowStepTarget = async (request: {
  readonly tabId: string;
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly normalizedUrl: string;
  readonly step: WorkflowCacheStep;
  readonly resolveTargetRef: (
    targetRef: string
  ) => { readonly ok: true } | { readonly ok: false };
  readonly observePage: () => Promise<WorkbenchBrowserAgentObservation>;
}): Promise<WorkflowStepResolveResult> => {
  const direct = request.resolveTargetRef(request.step.targetRef);
  if (direct.ok) {
    return { ok: true, targetRef: request.step.targetRef, matchLevel: "exact" };
  }
  if (request.step.identity === undefined) {
    return { ok: false };
  }
  const observed = await request.observePage();
  const matched = matchElementIdentity(request.normalizedUrl, request.step.identity, observed.elements);
  if (matched === null) {
    return { ok: false };
  }
  return {
    ok: true,
    targetRef: matched.element.targetRef,
    matchLevel: matched.matchLevel
  };
};

export const executeWorkflowReplay = async (request: {
  readonly tabId: string;
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly workflowId: string;
  readonly normalizedUrl: string;
  readonly actStep: (
    step: WorkflowCacheStep,
    resolved: WorkflowStepResolveResult & { readonly ok: true }
  ) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly resolveStep?: (
    step: WorkflowCacheStep,
    index: number
  ) => Promise<WorkflowStepResolveResult>;
}): Promise<WorkbenchBrowserAgentActionResult & {
  readonly cacheHit?: boolean;
  readonly cacheMiss?: boolean;
  readonly pathTaken?: "cached";
}> => {
  const loaded = loadWorkflowCacheForReplay(request.workflowId, {
    normalizedUrl: request.normalizedUrl,
    targetMode: request.targetMode
  });
  if (loaded.mode === "miss") {
    invalidateWorkflowCache(request.workflowId);
    return {
      ok: false,
      kind: "lyraLumenActionResult",
      tabId: request.tabId,
      inputMode: "chromium",
      targetMode: request.targetMode,
      cacheMiss: true,
      workflowId: request.workflowId,
      pathTaken: "cached",
      nextRecommendedAction: "lyra_lumen.map",
      error: {
        kind: "workflowCacheMiss",
        message: `Workflow cache miss (${loaded.reason}). Re-map and record a fresh workflow.`
      }
    };
  }

  const resolvedSteps: WorkbenchBrowserAgentWorkflowResolvedStep[] = [];
  let lastResult: WorkbenchBrowserAgentActionResult | null = null;
  for (let index = 0; index < loaded.entry.steps.length; index += 1) {
    const step = loaded.entry.steps[index]!;
    const resolved = request.resolveStep === undefined
      ? { ok: true as const, targetRef: step.targetRef, matchLevel: "exact" as const }
      : await request.resolveStep(step, index);
    if (!resolved.ok) {
      invalidateWorkflowCache(request.workflowId);
      return {
        ok: false,
        kind: "lyraLumenActionResult",
        tabId: request.tabId,
        inputMode: "chromium",
        targetMode: request.targetMode,
        cacheMiss: true,
        workflowId: request.workflowId,
        pathTaken: "cached",
        resolvedSteps,
        nextRecommendedAction: "lyra_lumen.map",
        error: {
          kind: "workflowCacheStale",
          message: `Workflow replay could not resolve step ${index + 1} target (${step.targetRef}).`
        }
      };
    }
    if (
      resolved.targetRef !== step.targetRef
      && resolved.matchLevel !== undefined
      && resolved.matchLevel !== "exact"
    ) {
      resolvedSteps.push({
        index,
        from: step.targetRef,
        to: resolved.targetRef,
        matchLevel: resolved.matchLevel
      });
    }
    const result = await request.actStep(step, resolved);
    lastResult = result;
    if (result.ok === false) {
      invalidateWorkflowCache(request.workflowId);
      return {
        ...result,
        cacheMiss: true,
        workflowId: request.workflowId,
        pathTaken: "cached",
        ...(resolvedSteps.length === 0 ? {} : { resolvedSteps })
      };
    }
    if (
      result.elementDiff?.noObservableChange === true
      && step.interaction !== "hover"
    ) {
      invalidateWorkflowCache(request.workflowId);
      return {
        ...result,
        ok: false,
        cacheMiss: true,
        workflowId: request.workflowId,
        pathTaken: "cached",
        ...(resolvedSteps.length === 0 ? {} : { resolvedSteps }),
        nextRecommendedAction: "lyra_lumen.map",
        error: {
          kind: "workflowCacheStale",
          message: "Workflow replay step produced no observable change; cache invalidated."
        }
      };
    }
  }

  return {
    ...(lastResult ?? {
      ok: true,
      kind: "lyraLumenActionResult",
      tabId: request.tabId,
      inputMode: "chromium",
      targetMode: request.targetMode
    }),
    cacheHit: true,
    workflowId: request.workflowId,
    pathTaken: "cached",
    ...(resolvedSteps.length === 0 ? {} : { resolvedSteps }),
    message: `Replayed ${loaded.entry.steps.length} cached workflow step${loaded.entry.steps.length === 1 ? "" : "s"}.`
  };
};

export { normalizeUrlForWorkflowCache };