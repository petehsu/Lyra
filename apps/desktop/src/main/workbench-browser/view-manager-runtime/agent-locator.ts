import type { WorkbenchBrowserSearchInPageRequest, WorkbenchLumenStaleTarget } from "../../../shared/desktop-bridge";
import type {
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentElementMatchLevel,
  WorkbenchBrowserAgentFindResult,
  WorkbenchBrowserAgentLocateResult,
  WorkbenchBrowserAgentModeRequest,
  WorkbenchBrowserAgentObservation,
  WorkbenchBrowserAgentTargetMode
} from "../types";
import { buildWorkflowElementIdentity, matchElementIdentity } from "./agent-element-matcher";
import { agentTargetAddress, agentTargetTitle } from "./agent-target-runtime";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import type { BrowserAgentStateStore } from "./agent-state-store";
import { PROBABLE_REBIND_CONFIDENCE_THRESHOLD } from "./agent-plan-runtime";
import { normalizeAddress, normalizeExecuteScriptTimeoutMs, selectSemanticLocateCandidate, runFrameScriptWithTimeout } from "./normalizers";
import type { BrowserAgentPageTarget, BrowserPageFindTarget } from "./types";

type BrowserAgentLocatorDeps = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "performSearchInPage"
  | "publishBrowserAgentActivity"
  | "resolveBrowserAgentTarget"
> & {
  readonly observeAgentPage: (
    tabId: string,
    request?: WorkbenchBrowserAgentModeRequest & {
      readonly strategy?: import("../types").WorkbenchBrowserAgentObserveStrategy;
      readonly timeoutMs?: number;
      readonly suppressActivity?: boolean;
    }
  ) => Promise<WorkbenchBrowserAgentObservation>;
  readonly stateStore: BrowserAgentStateStore;
};

export const createBrowserAgentLocator = (deps: BrowserAgentLocatorDeps) => {
  const {
    observeAgentPage,
    performSearchInPage,
    publishBrowserAgentActivity,
    resolveBrowserAgentTarget,
    stateStore
  } = deps;
  const { getTargetRefSnapshot, resolveElementId, resolveTargetRef } = stateStore;

  const findAgentElement = async (
    tabId: string,
    request: {
      readonly elementId?: number;
      readonly targetRef?: string;
    },
    targetMode: WorkbenchBrowserAgentTargetMode,
    timeoutMs: number | undefined
  ): Promise<{
    readonly element: WorkbenchBrowserAgentElement | null;
    readonly observationId?: string;
    readonly staleTarget?: WorkbenchLumenStaleTarget;
    readonly rebound?: {
      readonly from: string;
      readonly to: string;
      readonly confidence: number;
      readonly reason: string;
      readonly matchLevel?: WorkbenchBrowserAgentElementMatchLevel;
    };
  }> => {
    if (request.targetRef !== undefined) {
      const resolved = resolveTargetRef(tabId, targetMode, request.targetRef);
      if (resolved.ok) {
        return {
          element: resolved.entry.element,
          observationId: resolved.entry.observationId
        };
      }
      const observed = await observeAgentPage(tabId, {
        strategy: "interactiveOnly",
        targetMode,
        suppressActivity: true,
        ...(timeoutMs === undefined ? {} : { timeoutMs })
      });
      const rebound = resolveTargetRef(tabId, targetMode, request.targetRef);
      if (rebound.ok) {
        return {
          element: rebound.entry.element,
          observationId: rebound.entry.observationId
        };
      }
      const snapshotEntry = getTargetRefSnapshot(tabId, targetMode, request.targetRef);
      if (snapshotEntry !== null) {
        const pageUrl = snapshotEntry.url;
        const identity = buildWorkflowElementIdentity(pageUrl, snapshotEntry.element);
        const matched = matchElementIdentity(pageUrl, identity, observed.elements);
        if (matched !== null) {
          const reboundResolved = resolveTargetRef(tabId, targetMode, matched.element.targetRef);
          if (reboundResolved.ok) {
            return {
              element: reboundResolved.entry.element,
              observationId: reboundResolved.entry.observationId ?? observed.observationId,
              rebound: {
                from: request.targetRef,
                to: matched.element.targetRef,
                confidence: matched.confidence,
                reason: `identity-${matched.matchLevel}`,
                matchLevel: matched.matchLevel
              }
            };
          }
        }
      }
      const probableCandidate = rebound.staleTarget?.nearestCandidates
        ?.filter((candidate) => candidate.confidence >= PROBABLE_REBIND_CONFIDENCE_THRESHOLD)
        .sort((left, right) => right.confidence - left.confidence)[0];
      if (probableCandidate !== undefined) {
        const reboundResolved = resolveTargetRef(tabId, targetMode, probableCandidate.targetRef);
        if (reboundResolved.ok) {
          return {
            element: reboundResolved.entry.element,
            observationId: reboundResolved.entry.observationId ?? observed.observationId,
            rebound: {
              from: request.targetRef,
              to: probableCandidate.targetRef,
              confidence: probableCandidate.confidence,
              reason: probableCandidate.reason,
              matchLevel: "nearest"
            }
          };
        }
      }
      return {
        element: null,
        observationId: observed.observationId,
        staleTarget: rebound.staleTarget
      };
    }
    if (request.elementId !== undefined) {
      const resolved = resolveElementId(tabId, targetMode, request.elementId);
      if (resolved.ok) {
        return {
          element: resolved.entry.element,
          observationId: resolved.entry.observationId
        };
      }
      return {
        element: null,
        staleTarget: resolved.staleTarget
      };
    }
    return {
      element: null,
      staleTarget: {
        reason: "notFound",
        lastSeenAt: null,
        recommendedAction: "lyra_lumen.map",
        nearestCandidates: []
      }
    };
  };

  const pageFindTargetForAgentTarget = (target: BrowserAgentPageTarget): BrowserPageFindTarget => ({
    tabId: target.tabId,
    webContents: target.webContents,
    address: agentTargetAddress(target),
    title: agentTargetTitle(target)
  });

  const readAgentPlainTextForLocate = async (
    target: BrowserAgentPageTarget,
    timeoutMs: number | undefined
  ): Promise<{
    readonly title: string;
    readonly text: string;
  }> => {
    const raw = await runFrameScriptWithTimeout(
      () => target.webContents.executeJavaScript(`
        (() => {
          const normalizeText = (value) => {
            if (typeof value !== "string") return "";
            return value
              .replace(/\\u00a0/g, " ")
              .replace(/\\r/g, "")
              .replace(/[ \\t]+\\n/g, "\\n")
              .replace(/\\n[ \\t]+/g, "\\n")
              .replace(/\\n{3,}/g, "\\n\\n")
              .trim();
          };
          return {
            title: normalizeText(document.title ?? ""),
            text: normalizeText(document.body?.innerText ?? document.body?.textContent ?? "")
          };
        })()
      `, true),
      normalizeExecuteScriptTimeoutMs(timeoutMs, 4_000)
    ) as Record<string, unknown>;
    return {
      title: typeof raw.title === "string" ? raw.title : agentTargetTitle(target),
      text: typeof raw.text === "string" ? raw.text : ""
    };
  };

  const distanceFromRectToElement = (
    rect: NonNullable<WorkbenchBrowserAgentFindResult["revealRect"]>,
    element: WorkbenchBrowserAgentElement
  ): number => {
    const centerX = element.bounds.x + element.bounds.width / 2;
    const centerY = element.bounds.y + element.bounds.height / 2;
    const rectCenterX = (rect.left + rect.right) / 2;
    const rectCenterY = (rect.top + rect.bottom) / 2;
    const verticalGap = centerY < rect.top ? rect.top - centerY : centerY > rect.bottom ? centerY - rect.bottom : 0;
    return verticalGap * 3 + Math.hypot(centerX - rectCenterX, centerY - rectCenterY);
  };

  const nearbyElementsFromObservation = (
    observation: WorkbenchBrowserAgentObservation,
    revealRect: WorkbenchBrowserAgentFindResult["revealRect"],
    limit: number
  ): readonly WorkbenchBrowserAgentElement[] => {
    const elements = observation.elements
      .filter((element) => element.disabled !== true)
      .filter((element) => element.actionCapabilities?.length !== 0);
    const sorted = revealRect === undefined
      ? elements
      : [...elements].sort((left, right) =>
          distanceFromRectToElement(revealRect, left) - distanceFromRectToElement(revealRect, right)
        );
    return sorted.slice(0, Math.max(1, Math.min(20, Math.round(limit))));
  };

  const findAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & WorkbenchBrowserSearchInPageRequest & {
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserAgentFindResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "read",
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: 1_200
    });
    const result = await performSearchInPage(pageFindTargetForAgentTarget(target), request);
    const { revealRect, ...baseResult } = result;
    return {
      ok: true,
      kind: "lyraLumenFind",
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      ...baseResult,
      ...(revealRect === undefined ? {} : { revealRect }),
      nextRecommendedAction: "lyra_lumen.map"
    };
  };

  const locateAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly query: string;
      readonly matchMode?: "exact" | "semantic";
      readonly autoMap?: boolean;
      readonly nearbyLimit?: number;
      readonly reveal?: boolean;
      readonly caseSensitive?: boolean;
      readonly maxMatches?: number;
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserAgentLocateResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const query = request.query.trim();
    const matchMode = request.matchMode === "exact" ? "exact" : "semantic";
    const pageText = await readAgentPlainTextForLocate(target, request.timeoutMs);
    const semantic = matchMode === "semantic"
      ? selectSemanticLocateCandidate(pageText.text, query)
      : null;
    const anchorQuery = matchMode === "exact" ? query : semantic?.anchorQuery;
    if (anchorQuery === undefined || anchorQuery.trim().length === 0) {
      return {
        ok: true,
        kind: "lyraLumenLocate",
        tabId,
        address: normalizeAddress(target.webContents.getURL()) ?? agentTargetAddress(target),
        title: pageText.title,
        targetMode: target.targetMode,
        browserMode: target.browserMode,
        matched: false,
        matchMode,
        query,
        nextRecommendedAction: "lyra_lumen.read"
      };
    }
    const findResult = await findAgentPage(tabId, {
      ...request,
      query: anchorQuery,
      direction: "current",
      reveal: request.reveal !== false,
      maxMatches: request.maxMatches ?? 20
    });
    const matched = findResult.totalMatches > 0;
    let observation: WorkbenchBrowserAgentObservation | null = null;
    let nearbyElements: readonly WorkbenchBrowserAgentElement[] | undefined;
    if (matched && request.autoMap !== false) {
      observation = await observeAgentPage(tabId, {
        strategy: "interactiveOnly",
        targetMode: target.targetMode,
        suppressActivity: true,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      });
      nearbyElements = nearbyElementsFromObservation(
        observation,
        findResult.revealRect,
        request.nearbyLimit ?? 8
      );
    }
    return {
      ok: true,
      kind: "lyraLumenLocate",
      tabId,
      address: findResult.address,
      title: findResult.title,
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      matched,
      matchMode,
      query,
      anchorQuery,
      ...(semantic === null ? {} : {
        semanticScore: semantic.score,
        semanticReason: semantic.reason
      }),
      findResult,
      ...(observation === null ? {} : { observationId: observation.observationId }),
      ...(nearbyElements === undefined ? {} : { nearbyElements }),
      nextRecommendedAction:
        matched === false
          ? "lyra_lumen.read"
          : nearbyElements !== undefined && nearbyElements.length > 0 ? "lyra_lumen.act" : "lyra_lumen.map"
    };
  };

  return {
    findAgentElement,
    findAgentPage,
    locateAgentPage
  };
};
