import type {
  WorkbenchBrowserAgentModeRequest,
  WorkbenchBrowserAgentPlanResult,
  WorkbenchBrowserAgentTargetMode
} from "../types";
import { buildPlanCandidates, toPlanResult } from "./agent-plan-runtime";

type PlanControllerDeps = {
  readonly observeAgentPage: (
    tabId: string,
    request?: WorkbenchBrowserAgentModeRequest & {
      readonly strategy?: import("../types").WorkbenchBrowserAgentObserveStrategy;
      readonly timeoutMs?: number;
      readonly suppressActivity?: boolean;
      readonly settle?: boolean;
    }
  ) => Promise<import("../types").WorkbenchBrowserAgentObservation>;
  readonly locateAnchorRect?: (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    anchorText: string,
    timeoutMs?: number
  ) => Promise<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null>;
};

export const createBrowserAgentPlanController = (deps: PlanControllerDeps) => {
  const { observeAgentPage, locateAnchorRect } = deps;

  const planAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly anchorText?: string;
      readonly roles?: readonly string[];
      readonly labelIncludes?: readonly string[];
      readonly maxCandidates?: number;
      readonly timeoutMs?: number;
      readonly settle?: boolean;
    }
  ): Promise<WorkbenchBrowserAgentPlanResult> => {
    const targetMode = request.targetMode ?? "live";
    const observation = await observeAgentPage(tabId, {
      strategy: "interactiveOnly",
      targetMode,
      suppressActivity: true,
      ...(request.settle === undefined ? {} : { settle: request.settle }),
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
    });
    const anchorRect = request.anchorText !== undefined
      && request.anchorText.trim().length > 0
      && locateAnchorRect !== undefined
      ? await locateAnchorRect(tabId, targetMode, request.anchorText.trim(), request.timeoutMs)
      : null;
    const candidates = buildPlanCandidates({
      observation,
      ...(request.roles === undefined ? {} : { roles: request.roles }),
      ...(request.labelIncludes === undefined ? {} : { labelIncludes: request.labelIncludes }),
      ...(anchorRect === null ? {} : { anchorRect }),
      ...(request.maxCandidates === undefined ? {} : { maxCandidates: request.maxCandidates })
    });
    return toPlanResult(tabId, targetMode, observation, candidates);
  };

  return { planAgentPage };
};