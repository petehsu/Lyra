import type { WorkbenchLumenStaleTarget } from "../../../shared/desktop-bridge";
import type { WorkbenchVisualCaptureResult } from "../../../shared/workbench-observation";
import type { BrowserAgentCursorOverlayAction } from "../agent-cursor-overlay";
import type {
  WorkbenchBrowserAgentActionResult,
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentInteraction,
  WorkbenchBrowserAgentModeInfo,
  WorkbenchBrowserAgentModeRequest,
  WorkbenchBrowserAgentObservation,
  WorkbenchBrowserAgentPoint,
  WorkbenchBrowserAgentScrollBlock,
  WorkbenchBrowserAgentScrollDirection,
  WorkbenchBrowserAgentScrollEffect,
  WorkbenchBrowserAgentScrollResult,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserAgentVerification,
  WorkbenchBrowserWorkflowCacheMode,
  WorkbenchBrowserViewManager
} from "../types";
import {
  agentPointInsideViewport,
  centerOfAgentElement,
  clampAgentPointToViewport,
  normalizeAgentScrollBlock,
  scrollDeltaForDirection,
  scrollDeltaToPlacePoint
} from "./agent-action-runtime";
import { shouldSettleBeforeObserve, waitForDomNetworkQuiet } from "./agent-dom-settle";
import {
  buildElementDiff,
  elementStateFromCached,
  probeElementState
} from "./agent-element-probe";
import { agentTargetAddress, agentTargetIsLoading } from "./agent-target-runtime";
import { buildWorkflowElementIdentity } from "./agent-element-matcher";
import {
  appendWorkflowCacheStep,
  normalizeUrlForWorkflowCache
} from "./lumen-workflow-cache";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import type { BrowserAgentStateStore } from "./agent-state-store";
import { delay, normalizeAgentVerification, normalizeExecuteScriptTimeoutMs, runFrameScriptWithTimeout } from "./normalizers";
import type { BrowserAgentAutoScrollResult, BrowserAgentPageTarget } from "./types";

type FindAgentElement = (
  tabId: string,
  request: { readonly elementId?: number; readonly targetRef?: string },
  targetMode: WorkbenchBrowserAgentTargetMode,
  timeoutMs: number | undefined
) => Promise<{
  readonly element: WorkbenchBrowserAgentElement | null;
  readonly observationId?: string;
  readonly staleTarget?: WorkbenchLumenStaleTarget;
  readonly rebound?: {
    readonly from: string;
    readonly to: string;
    readonly confidence: number;
    readonly reason: string;
  };
}>;

type BrowserAgentInteractionExecutorDeps = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "assertSharedControlCanContinue"
  | "createVisualFrame"
  | "cssPointFromVisualFrame"
  | "findFrameInWebContents"
  | "markSyntheticInput"
  | "publishBrowserAgentActivity"
  | "readAgentViewportState"
  | "readVisualFrame"
  | "recordFollowAction"
  | "resolveBrowserAgentTarget"
  | "sendAgentInputEvent"
  | "visualStaleResult"
> & {
  readonly findAgentElement: FindAgentElement;
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

export const createBrowserAgentInteractionExecutor = (deps: BrowserAgentInteractionExecutorDeps) => {
  const {
    assertSharedControlCanContinue,
    createVisualFrame,
    cssPointFromVisualFrame,
    findAgentElement,
    findFrameInWebContents,
    markSyntheticInput,
    observeAgentPage,
    publishBrowserAgentActivity,
    readAgentViewportState,
    readVisualFrame,
    recordFollowAction,
    resolveBrowserAgentTarget,
    sendAgentInputEvent,
    stateStore,
    visualStaleResult
  } = deps;
  const {
    activeEditableElementFromObservation,
    cacheBrowserAgentInputTarget,
    consumePendingSettle,
    isAgentEditableElement,
    markPendingSettle,
    readBrowserAgentCacheEntry
  } = stateStore;

  const measureElementDiff = async (
    target: BrowserAgentPageTarget,
    element: WorkbenchBrowserAgentElement,
    timeoutMs: number | undefined
  ) => {
    const before = elementStateFromCached(element);
    const frame = findFrameInWebContents(target.webContents, element.frameTreeNodeId)
      ?? target.webContents.mainFrame;
    const after = await probeElementState(frame, element, timeoutMs);
    return buildElementDiff(before, after);
  };

  const performAgentPointerInteraction = async ({
    tabId,
    target,
    x,
    y,
    interaction
  }: {
    readonly tabId: string;
    readonly target: BrowserAgentPageTarget;
    readonly x: number;
    readonly y: number;
    readonly interaction: WorkbenchBrowserAgentInteraction;
  }): Promise<void> => {
    const button = interaction === "rightClick" ? "right" : "left";
    const clickCounts = interaction === "doubleClick" ? [1, 2] : [1];
    const cursor = { x, y };
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "act",
      interaction,
      cursorPhase: "move",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      cursor,
      durationMs: interaction === "hover" ? 2_400 : 2_800
    });
    await delay(20);

    target.webContents.focus();
    sendAgentInputEvent(target, { type: "mouseMove", x, y, button: "left", clickCount: 1 });
    if (interaction === "hover") {
      publishBrowserAgentActivity({
        tabId,
        targetMode: target.targetMode,
        action: "act",
        interaction,
        cursorPhase: "idle",
        inputActive: true,
        visibleFollow: target.browserMode.visibleFollow,
        cursor,
        durationMs: 2_400
      });
      await delay(40);
      return;
    }

    for (const [index, clickCount] of clickCounts.entries()) {
      publishBrowserAgentActivity({
        tabId,
        targetMode: target.targetMode,
        action: "act",
        interaction,
        cursorPhase: "down",
        inputActive: true,
        visibleFollow: target.browserMode.visibleFollow,
        cursor,
        durationMs: 2_400
      });
      sendAgentInputEvent(target, { type: "mouseDown", x, y, button, clickCount });
      await delay(20);

      publishBrowserAgentActivity({
        tabId,
        targetMode: target.targetMode,
        action: "act",
        interaction,
        cursorPhase: "up",
        inputActive: true,
        visibleFollow: target.browserMode.visibleFollow,
        cursor,
        durationMs: 2_400
      });
      sendAgentInputEvent(target, { type: "mouseUp", x, y, button, clickCount });
      await delay(index === clickCounts.length - 1 ? 30 : 40);
    }

    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "act",
      interaction,
      cursorPhase: "idle",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      cursor,
      durationMs: 2_400
    });
  };

  const readFocusedElementSignature = async (
    target: BrowserAgentPageTarget,
    timeoutMs: number | undefined
  ): Promise<string> => {
    try {
      const value = await runFrameScriptWithTimeout(
        () => target.webContents.executeJavaScript(`
          (() => {
            const element = document.activeElement;
            if (!element) return "";
            return [
              element.tagName || "",
              element.id || "",
              element.getAttribute?.("name") || "",
              element.getAttribute?.("aria-label") || "",
              element.getAttribute?.("role") || ""
            ].join("|");
          })()
        `, true),
        normalizeExecuteScriptTimeoutMs(timeoutMs, 1_500)
      );
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  };

  const scrollAgentViewportByDelta = async ({
    tabId,
    target,
    deltaX,
    deltaY,
    point,
    reason,
    timeoutMs
  }: {
    readonly tabId: string;
    readonly target: BrowserAgentPageTarget;
    readonly deltaX: number;
    readonly deltaY: number;
    readonly point: {
      readonly x: number;
      readonly y: number;
    };
    readonly reason: WorkbenchBrowserAgentScrollEffect["reason"];
    readonly timeoutMs: number | undefined;
  }): Promise<WorkbenchBrowserAgentScrollEffect> => {
    const beforeViewport = await readAgentViewportState(target, timeoutMs);
    const cursor = clampAgentPointToViewport(point, beforeViewport);
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
      return {
        reason,
        scrolled: false,
        method: "none",
        before: point,
        after: point,
        deltaX: 0,
        deltaY: 0
      };
    }

    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "scroll",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      cursor,
      durationMs: 1_600
    });
    target.webContents.focus();
    sendAgentInputEvent(target, {
      type: "mouseWheel",
      x: cursor.x,
      y: cursor.y,
      deltaX,
      deltaY
    });
    await delay(90);
    let afterViewport = await readAgentViewportState(target, timeoutMs);
    let actualDeltaX = Math.round(afterViewport.scrollX - beforeViewport.scrollX);
    let actualDeltaY = Math.round(afterViewport.scrollY - beforeViewport.scrollY);
    let method: WorkbenchBrowserAgentScrollEffect["method"] = "wheel";

    if (Math.abs(actualDeltaX) < 1 && Math.abs(actualDeltaY) < 1) {
      if (target.targetMode === "live") {
        assertSharedControlCanContinue(target.tabId);
      }
      markSyntheticInput(target.tabId);
      await runFrameScriptWithTimeout(
        () => target.webContents.executeJavaScript(`
          (() => {
            window.scrollBy({
              left: ${JSON.stringify(deltaX)},
              top: ${JSON.stringify(deltaY)},
              behavior: "instant"
            });
            return {
              scrollX: Number(window.scrollX || window.pageXOffset || 0),
              scrollY: Number(window.scrollY || window.pageYOffset || 0)
            };
          })()
        `, true),
        normalizeExecuteScriptTimeoutMs(timeoutMs, 1_500)
      ).catch(() => null);
      await delay(70);
      afterViewport = await readAgentViewportState(target, timeoutMs);
      actualDeltaX = Math.round(afterViewport.scrollX - beforeViewport.scrollX);
      actualDeltaY = Math.round(afterViewport.scrollY - beforeViewport.scrollY);
      method = Math.abs(actualDeltaX) < 1 && Math.abs(actualDeltaY) < 1 ? "none" : "scrollBy";
    }

    const afterPoint = {
      x: Math.round(point.x - actualDeltaX),
      y: Math.round(point.y - actualDeltaY)
    };
    return {
      reason,
      scrolled: method !== "none",
      method,
      before: {
        x: Math.round(point.x),
        y: Math.round(point.y)
      },
      after: afterPoint,
      deltaX: actualDeltaX,
      deltaY: actualDeltaY
    };
  };

  const autoScrollPointIntoViewport = async ({
    tabId,
    target,
    point,
    reason,
    block,
    timeoutMs
  }: {
    readonly tabId: string;
    readonly target: BrowserAgentPageTarget;
    readonly point: {
      readonly x: number;
      readonly y: number;
    };
    readonly reason: WorkbenchBrowserAgentScrollEffect["reason"];
    readonly block: WorkbenchBrowserAgentScrollBlock | undefined;
    readonly timeoutMs: number | undefined;
  }): Promise<BrowserAgentAutoScrollResult> => {
    const viewport = await readAgentViewportState(target, timeoutMs);
    const normalizedBlock = normalizeAgentScrollBlock(block);
    const { deltaX, deltaY } = scrollDeltaToPlacePoint(point, viewport, normalizedBlock);
    if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
      return { point };
    }
    const effect = await scrollAgentViewportByDelta({
      tabId,
      target,
      deltaX,
      deltaY,
      point,
      reason,
      timeoutMs
    });
    return {
      point: effect.after,
      effect
    };
  };

  const ensureAgentElementVisible = async ({
    tabId,
    target,
    element,
    observationId,
    reason,
    block,
    timeoutMs
  }: {
    readonly tabId: string;
    readonly target: BrowserAgentPageTarget;
    readonly element: WorkbenchBrowserAgentElement;
    readonly observationId: string | undefined;
    readonly reason: WorkbenchBrowserAgentScrollEffect["reason"];
    readonly block: WorkbenchBrowserAgentScrollBlock | undefined;
    readonly timeoutMs: number | undefined;
  }): Promise<BrowserAgentAutoScrollResult> => {
    const point = centerOfAgentElement(element);
    const scrolled = await autoScrollPointIntoViewport({
      tabId,
      target,
      point,
      reason,
      block: block ?? "center",
      timeoutMs
    });
    if (scrolled.effect === undefined || scrolled.effect.scrolled === false) {
      return {
        element,
        point,
        ...(scrolled.effect === undefined ? {} : { effect: {
          ...scrolled.effect,
          targetRef: element.targetRef,
          elementId: element.id,
          ...(observationId === undefined ? {} : { beforeObservationId: observationId })
        } })
      };
    }
    const observed = await observeAgentPage(tabId, {
      strategy: "interactiveOnly",
      targetMode: target.targetMode,
      suppressActivity: true,
      ...(timeoutMs === undefined ? {} : { timeoutMs })
    });
    const rebound = await findAgentElement(
      tabId,
      { targetRef: element.targetRef },
      target.targetMode,
      timeoutMs
    );
    const nextElement = rebound.element ?? element;
    return {
      element: nextElement,
      point: centerOfAgentElement(nextElement),
      effect: {
        ...scrolled.effect,
        targetRef: element.targetRef,
        elementId: element.id,
        ...(observationId === undefined ? {} : { beforeObservationId: observationId }),
        afterObservationId: rebound.observationId ?? observed.observationId
      }
    };
  };

  const nextRecommendedActionAfterAgentAction = ({
    navigationStarted,
    pageChanged
  }: {
    readonly navigationStarted: boolean;
    readonly pageChanged: boolean;
  }): string => {
    if (navigationStarted) {
      return "lyra_lumen.wait";
    }
    if (pageChanged) {
      return "lyra_lumen.map";
    }
    return "continue_with_cached_targets";
  };

  const staleElementResult = (
    tabId: string,
    elementId: number | undefined,
    targetRef: string | undefined,
    targetMode: WorkbenchBrowserAgentTargetMode,
    browserMode: WorkbenchBrowserAgentModeInfo | undefined,
    observationId?: string,
    staleTarget?: WorkbenchLumenStaleTarget,
    action: BrowserAgentCursorOverlayAction = "act"
  ): WorkbenchBrowserAgentActionResult => {
    recordFollowAction(tabId, targetMode, action, {
      ...(browserMode === undefined ? {} : { visibleFollow: browserMode.visibleFollow }),
      inputActive: false,
      result: "failure"
    });
    return {
      ok: false,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode,
      ...(browserMode === undefined ? {} : { browserMode }),
      ...(elementId === undefined ? {} : { elementId }),
      ...(targetRef === undefined ? {} : { targetRef }),
      ...(observationId === undefined ? {} : { beforeObservationId: observationId }),
      ...(staleTarget === undefined ? {} : { staleTarget }),
      staleElement: true,
      nextRecommendedAction: "lyra_lumen.map",
      error: {
        kind: staleTarget === undefined ? "staleElement" : "staleTarget",
        message:
          targetRef === undefined
            ? `Element ${elementId ?? "(unspecified)"} is an observation-local Lyra Lumen id and is not valid in the current observation.`
            : `Target ${targetRef} is not available in the current Lyra Lumen target registry.`
      }
    };
  };

  const observeAfterAgentInput = async (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    timeoutMs: number | undefined
  ): Promise<WorkbenchBrowserAgentObservation | null> => {
    try {
      const normalizedTimeoutMs = timeoutMs === undefined
        ? undefined
        : Math.max(250, Math.min(timeoutMs, 8_000));
      return await observeAgentPage(tabId, {
        strategy: "hybrid",
        targetMode,
        suppressActivity: true,
        ...(normalizedTimeoutMs === undefined ? {} : { timeoutMs: normalizedTimeoutMs })
      });
    } catch {
      return null;
    }
  };

  const actOnAgentElement = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly interaction: WorkbenchBrowserAgentInteraction;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
      readonly settle?: boolean;
      readonly optionLabel?: string;
      readonly selectValue?: string;
      readonly workflowId?: string;
      readonly cacheMode?: WorkbenchBrowserWorkflowCacheMode;
      readonly matchLevel?: import("../types").WorkbenchBrowserAgentElementMatchLevel;
    }
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const startedAt = Date.now();
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const verification = normalizeAgentVerification(request.verification);
    const previousCache = readBrowserAgentCacheEntry(tabId, target.targetMode);
    if (
      shouldSettleBeforeObserve({
        settle: request.settle,
        urlChanged: previousCache !== undefined && previousCache.url !== agentTargetAddress(target),
        afterNavigation: consumePendingSettle(tabId, target.targetMode)
      })
    ) {
      await waitForDomNetworkQuiet(target.webContents, {
        forceSkip: request.settle === false,
        deepSettle: request.settle === true
      });
    }
    const { element, observationId, staleTarget, rebound } = await findAgentElement(
      tabId,
      {
        ...(request.elementId === undefined ? {} : { elementId: request.elementId }),
        ...(request.targetRef === undefined ? {} : { targetRef: request.targetRef })
      },
      target.targetMode,
      request.timeoutMs
    );
    if (element === null) {
      return staleElementResult(
        tabId,
          request.elementId,
          request.targetRef,
          target.targetMode,
          target.browserMode,
          observationId,
          staleTarget
      );
    }
    if (element.discoveryScope === "visual" && request.interaction !== "hover") {
      recordFollowAction(tabId, target.targetMode, "act", {
        visibleFollow: target.browserMode.visibleFollow,
        interaction: request.interaction,
        inputActive: false,
        result: "failure"
      });
      return {
        ok: false,
        kind: "lyraLumenActionResult",
        tabId,
        inputMode: "chromium",
        targetMode: target.targetMode,
        browserMode: target.browserMode,
        elementId: element.id,
        targetRef: element.targetRef,
        ...(observationId === undefined ? {} : { beforeObservationId: observationId }),
        nextRecommendedAction: "lyra_lumen.see",
        error: {
          kind: "visualActRequired",
          message:
            "This is a visual-only fallback region, not a reliable DOM target. Capture the page with lyra_lumen.see, then use lyra_lumen.vact with that captureId and real screenshot coordinates."
        }
      };
    }

    const visibleTarget = await ensureAgentElementVisible({
      tabId,
      target,
      element,
      observationId,
      reason: "target_offscreen",
      block: "center",
      timeoutMs: request.timeoutMs
    });
    const interactionElement = visibleTarget.element ?? element;
    const autoScroll = visibleTarget.effect;
    const beforeUrl = agentTargetAddress(target);
    const beforeFocus = verification === "none"
      ? ""
      : await readFocusedElementSignature(target, request.timeoutMs);
    const { x, y } = centerOfAgentElement(interactionElement);
    let interaction = request.interaction;
    let twoPhase = false;
    if (
      interaction === "select"
      || (
        (request.optionLabel !== undefined || request.selectValue !== undefined)
        && (interactionElement.role === "combobox" || interactionElement.role === "listbox" || interactionElement.tagName === "select")
      )
    ) {
      twoPhase = true;
      interaction = "click";
    }
    await performAgentPointerInteraction({
      tabId,
      target,
      x,
      y,
      interaction,
    });
    await delay(interaction === "hover" ? 40 : 30);

    let elementDiffResult = await measureElementDiff(target, interactionElement, request.timeoutMs);
    if (
      twoPhase
      && ("noObservableChange" in elementDiffResult ? elementDiffResult.noObservableChange !== true : true)
    ) {
      const observed = await observeAgentPage(tabId, {
        strategy: "interactiveOnly",
        targetMode: target.targetMode,
        suppressActivity: true,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      });
      const needle = (request.optionLabel ?? request.selectValue ?? "").trim().toLowerCase();
      const option = observed.elements.find((candidate) => {
        const label = `${candidate.label} ${candidate.textSnippet ?? ""}`.toLowerCase();
        return needle.length > 0 && label.includes(needle);
      });
      if (option !== undefined) {
        const optionCenter = centerOfAgentElement(option);
        await performAgentPointerInteraction({
          tabId,
          target,
          x: optionCenter.x,
          y: optionCenter.y,
          interaction: "click"
        });
        await delay(30);
        elementDiffResult = await measureElementDiff(target, interactionElement, request.timeoutMs);
      }
    }

    const after = verification === "full"
      ? await observeAfterAgentInput(tabId, target.targetMode, request.timeoutMs)
      : null;
    if (isAgentEditableElement(interactionElement)) {
      cacheBrowserAgentInputTarget(
        tabId,
        target.targetMode,
        interactionElement,
        after?.url ?? agentTargetAddress(target),
        after?.observationId ?? observationId
      );
    }
    const afterFocus = verification === "none"
      ? ""
      : await readFocusedElementSignature(target, request.timeoutMs);
    const pageChanged = beforeUrl !== agentTargetAddress(target);
    const navigationStarted = agentTargetIsLoading(target);
    if (navigationStarted) {
      markPendingSettle(tabId, target.targetMode);
    }
    if (
      request.cacheMode === "record"
      && request.workflowId !== undefined
      && request.workflowId.trim().length > 0
    ) {
      appendWorkflowCacheStep(
        request.workflowId.trim(),
        {
          normalizedUrl: normalizeUrlForWorkflowCache(beforeUrl),
          targetMode: target.targetMode
        },
        {
          targetRef: interactionElement.targetRef,
          interaction: request.interaction,
          label: interactionElement.label,
          role: interactionElement.role,
          identity: buildWorkflowElementIdentity(beforeUrl, interactionElement),
          ...(request.optionLabel === undefined ? {} : { optionLabel: request.optionLabel }),
          ...(request.selectValue === undefined ? {} : { selectValue: request.selectValue })
        }
      );
    }
    const runtimeCostMs = Date.now() - startedAt;
    return {
      ok: true,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      elementId: interactionElement.id,
      targetRef: interactionElement.targetRef,
      x,
      y,
      verification,
      ...(observationId === undefined ? {} : { beforeObservationId: observationId }),
      ...(after === null ? {} : { afterObservationId: after.observationId }),
      ...(autoScroll === undefined ? {} : { autoScroll }),
      pageChanged,
      ...("diffUnavailable" in elementDiffResult
        ? { diffUnavailable: true }
        : { elementDiff: elementDiffResult }),
      ...(rebound === undefined ? {} : { rebound, pathTaken: "rebound" as const }),
      ...(request.matchLevel === undefined ? {} : { matchLevel: request.matchLevel }),
      ...(twoPhase ? { twoPhase: true, pathTaken: "twoPhase" as const } : { pathTaken: rebound === undefined ? "fast" as const : "rebound" as const }),
      ...(verification === "none" ? {} : { focusChanged: beforeFocus !== afterFocus }),
      navigationStarted,
      runtimeCostMs,
      ...(request.workflowId === undefined ? {} : { workflowId: request.workflowId }),
      message: `${request.interaction} sent to element ${interactionElement.id} (${interactionElement.targetRef}) with Chromium virtual input.`,
      nextRecommendedAction: nextRecommendedActionAfterAgentAction({ navigationStarted, pageChanged })
    };
  };

  const scrollAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly direction?: WorkbenchBrowserAgentScrollDirection;
      readonly amount?: number;
      readonly pages?: number;
      readonly block?: WorkbenchBrowserAgentScrollBlock;
      readonly behavior?: "instant" | "smooth";
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly point?: WorkbenchBrowserAgentPoint;
      readonly autoMap?: boolean;
      readonly timeoutMs?: number;
      readonly reason?: "explicit_scroll" | "ensure_visible";
    }
  ): Promise<WorkbenchBrowserAgentScrollResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const targetLocator = {
      ...(request.elementId === undefined ? {} : { elementId: request.elementId }),
      ...(request.targetRef === undefined ? {} : { targetRef: request.targetRef })
    };
    let point = request.point === undefined
      ? undefined
      : { x: Math.round(request.point.x), y: Math.round(request.point.y) };
    let element: WorkbenchBrowserAgentElement | undefined;
    let beforeObservationId: string | undefined;
    let autoScroll: WorkbenchBrowserAgentScrollEffect | undefined;
    const ensureReason: WorkbenchBrowserAgentScrollEffect["reason"] =
      request.reason === "ensure_visible" ? "ensure_visible" : "explicit_scroll";

    if (request.elementId !== undefined || request.targetRef !== undefined) {
      const found = await findAgentElement(
        tabId,
        targetLocator,
        target.targetMode,
        request.timeoutMs
      );
      beforeObservationId = found.observationId;
      if (found.element === null) {
        return {
          ok: false,
          kind: "lyraLumenScrollResult",
          tabId,
          inputMode: "chromium",
          targetMode: target.targetMode,
          browserMode: target.browserMode,
          ...(request.elementId === undefined ? {} : { elementId: request.elementId }),
          ...(request.targetRef === undefined ? {} : { targetRef: request.targetRef }),
          ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
          scrolled: false,
          method: "none",
          deltaX: 0,
          deltaY: 0,
          nextRecommendedAction: "lyra_lumen.map",
          error: {
            kind: found.staleTarget === undefined ? "staleElement" : "staleTarget",
            message: request.targetRef === undefined
              ? `Element ${request.elementId ?? "(unspecified)"} is not valid in the current browser observation.`
              : `Target ${request.targetRef} is not available in the current Lyra Lumen target registry.`
          }
        };
      }
      const visible = await ensureAgentElementVisible({
        tabId,
        target,
        element: found.element,
        observationId: found.observationId,
        reason: ensureReason,
        block: request.block,
        timeoutMs: request.timeoutMs
      });
      element = visible.element ?? found.element;
      point = visible.point ?? centerOfAgentElement(element);
      autoScroll = visible.effect;
      beforeObservationId = autoScroll?.beforeObservationId ?? beforeObservationId;
    } else if (point !== undefined) {
      const visible = await autoScrollPointIntoViewport({
        tabId,
        target,
        point,
        reason: request.reason === "ensure_visible" ? "ensure_visible" : "point_offscreen",
        block: request.block,
        timeoutMs: request.timeoutMs
      });
      point = visible.point ?? point;
      autoScroll = visible.effect;
    }

    let effect = autoScroll;
    if (
      request.direction !== undefined
      || (request.elementId === undefined && request.targetRef === undefined && request.point === undefined)
    ) {
      const viewport = await readAgentViewportState(target, request.timeoutMs);
      const scrollPoint = point ?? {
        x: Math.round(viewport.width * 0.5),
        y: Math.round(viewport.height * 0.5)
      };
      const direction = request.direction ?? "down";
      const { deltaX, deltaY } = scrollDeltaForDirection(
        direction,
        viewport,
        request.amount,
        request.pages
      );
      const explicitEffect = await scrollAgentViewportByDelta({
        tabId,
        target,
        deltaX,
        deltaY,
        point: scrollPoint,
        reason: "explicit_scroll",
        timeoutMs: request.timeoutMs
      });
      effect = {
        ...explicitEffect,
        ...(element === undefined ? {} : {
          targetRef: element.targetRef,
          elementId: element.id
        }),
        ...(beforeObservationId === undefined ? {} : { beforeObservationId })
      };
      point = explicitEffect.after;
    }

    let afterObservationId = effect?.afterObservationId;
    if (request.autoMap !== false && (effect?.scrolled === true || effect === undefined)) {
      const observed = await observeAgentPage(tabId, {
        strategy: "interactiveOnly",
        targetMode: target.targetMode,
        suppressActivity: true,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      }).catch(() => null);
      afterObservationId = observed?.observationId ?? afterObservationId;
    }

    const finalPoint = point ?? effect?.after ?? effect?.before;
    const scrolled = effect?.scrolled === true;
    return {
      ok: true,
      kind: "lyraLumenScrollResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      ...(request.direction === undefined ? {} : { direction: request.direction }),
      ...(request.amount === undefined ? {} : { amount: request.amount }),
      ...(request.pages === undefined ? {} : { pages: request.pages }),
      ...(finalPoint === undefined ? {} : { x: finalPoint.x, y: finalPoint.y }),
      ...(element === undefined ? {} : {
        elementId: element.id,
        targetRef: element.targetRef
      }),
      ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
      ...(afterObservationId === undefined ? {} : { afterObservationId }),
      scrolled,
      method: effect?.method ?? "none",
      deltaX: effect?.deltaX ?? 0,
      deltaY: effect?.deltaY ?? 0,
      ...(effect === undefined ? {} : { autoScroll: { ...effect, ...(afterObservationId === undefined ? {} : { afterObservationId }) } }),
      message: scrolled
        ? `Scrolled browser viewport by ${effect?.deltaX ?? 0}, ${effect?.deltaY ?? 0}.`
        : "Browser target was already visible or the page could not scroll further.",
      nextRecommendedAction:
        element !== undefined || request.point !== undefined ? "lyra_lumen.act" : "lyra_lumen.map"
    };
  };

  const actOnAgentPoint = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly point: WorkbenchBrowserAgentPoint;
      readonly interaction: WorkbenchBrowserAgentInteraction;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const verification = normalizeAgentVerification(request.verification);
    const beforeUrl = agentTargetAddress(target);
    const beforeFocus = verification === "full"
      ? await readFocusedElementSignature(target, request.timeoutMs)
      : "";
    const initialPoint = {
      x: Math.max(0, Math.round(request.point.x)),
      y: Math.max(0, Math.round(request.point.y))
    };
    const visiblePoint = await autoScrollPointIntoViewport({
      tabId,
      target,
      point: initialPoint,
      reason: "point_offscreen",
      block: "center",
      timeoutMs: request.timeoutMs
    });
    const x = Math.max(0, Math.round(visiblePoint.point?.x ?? initialPoint.x));
    const y = Math.max(0, Math.round(visiblePoint.point?.y ?? initialPoint.y));
    const autoScroll = visiblePoint.effect;
    const interaction = request.interaction;
    await performAgentPointerInteraction({
      tabId,
      target,
      x,
      y,
      interaction,
    });
    await delay(interaction === "hover" ? 40 : 30);

    const after = verification === "full"
      ? await observeAfterAgentInput(tabId, target.targetMode, request.timeoutMs)
      : null;
    const activeEditableElement = after === null ? null : activeEditableElementFromObservation(after);
    if (activeEditableElement !== null) {
      cacheBrowserAgentInputTarget(
        tabId,
        target.targetMode,
        activeEditableElement,
        after?.url ?? agentTargetAddress(target),
        after?.observationId
      );
    }
    const afterFocus = verification === "full"
      ? await readFocusedElementSignature(target, request.timeoutMs)
      : "";
    const pageChanged = beforeUrl !== agentTargetAddress(target);
    const navigationStarted = agentTargetIsLoading(target);
    return {
      ok: true,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      x,
      y,
      verification,
      ...(after === null ? {} : { afterObservationId: after.observationId }),
      ...(autoScroll === undefined ? {} : { autoScroll }),
      pageChanged,
      ...(verification === "full" ? { focusChanged: beforeFocus !== afterFocus } : {}),
      navigationStarted,
      message:
        `${interaction} sent to visual fallback point (${x}, ${y})` +
        (request.point.reason === undefined ? "." : `: ${request.point.reason}`),
      nextRecommendedAction: nextRecommendedActionAfterAgentAction({ navigationStarted, pageChanged })
    };
  };

  const actOnAgentVisualPoint: WorkbenchBrowserViewManager["actOnAgentVisualPoint"] = async (
    tabId,
    request
  ) => {
    const record = readVisualFrame(request.captureId);
    if (record === undefined) {
      return visualStaleResult({
        tabId,
        captureId: request.captureId,
        reason: "unknown_capture",
        message:
          "The visual captureId is not available anymore. Call lyra_lumen.see again before using visual coordinates."
      });
    }
    if (record.tabId !== tabId) {
      return visualStaleResult({
        tabId,
        targetMode: record.targetMode,
        captureId: request.captureId,
        reason: "tab_mismatch",
        message:
          "The visual captureId belongs to a different browser tab. Call lyra_lumen.see for the active target before using visual coordinates."
      });
    }

    const target = await resolveBrowserAgentTarget(
      tabId,
      { ...request, targetMode: request.targetMode ?? record.targetMode },
      request.timeoutMs
    );
    if (target.targetMode !== record.targetMode) {
      return visualStaleResult({
        tabId,
        targetMode: target.targetMode,
        captureId: request.captureId,
        reason: "target_mode_mismatch",
        message:
          "The visual captureId was produced for a different browser target mode. Call lyra_lumen.see again before using visual coordinates."
      });
    }

    const currentFrame = await createVisualFrame({
      tabId,
      target,
      imageWidth: record.frame.imageWidth,
      imageHeight: record.frame.imageHeight,
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
    });
    if (
      currentFrame.viewBoundsHash !== record.frame.viewBoundsHash
      || currentFrame.viewBoundsEpoch !== record.frame.viewBoundsEpoch
      || Math.abs(currentFrame.dpr - record.frame.dpr) > 0.001
      || Math.round(currentFrame.scrollX) !== Math.round(record.frame.scrollX)
      || Math.round(currentFrame.scrollY) !== Math.round(record.frame.scrollY)
    ) {
      return visualStaleResult({
        tabId,
        targetMode: target.targetMode,
        captureId: request.captureId,
        reason: "viewport_resized",
        message:
          "The browser viewport, scroll position, layout bounds, or device pixel ratio changed since the screenshot. Call lyra_lumen.see again and use the new captureId before clicking."
      });
    }

    const point = cssPointFromVisualFrame(request.point, record.frame);
    if (request.interaction === "scroll") {
      const scrollDy =
        typeof request.scrollDy === "number" && Number.isFinite(request.scrollDy)
          ? request.scrollDy
          : 0;
      const amount = Math.max(1, Math.abs(scrollDy || 480));
      return await scrollAgentPage(tabId, {
        ...request,
        point,
        direction: scrollDy < 0 ? "up" : "down",
        amount,
        reason: "explicit_scroll",
        targetMode: target.targetMode
      });
    }

    if (request.interaction !== "drag") {
      return await actOnAgentPoint(tabId, {
        ...request,
        point,
        interaction: request.interaction,
        targetMode: target.targetMode
      });
    }

    const to = cssPointFromVisualFrame(request.to ?? request.point, record.frame);
    const fromX = Math.max(0, Math.round(point.x));
    const fromY = Math.max(0, Math.round(point.y));
    const toX = Math.max(0, Math.round(to.x));
    const toY = Math.max(0, Math.round(to.y));
    target.webContents.focus();
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "act",
      interaction: "click",
      cursorPhase: "move",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      cursor: { x: fromX, y: fromY },
      durationMs: 2_800
    });
    sendAgentInputEvent(target, { type: "mouseMove", x: fromX, y: fromY, button: "left", clickCount: 1 });
    await delay(20);
    sendAgentInputEvent(target, { type: "mouseDown", x: fromX, y: fromY, button: "left", clickCount: 1 });
    await delay(40);
    sendAgentInputEvent(target, { type: "mouseMove", x: toX, y: toY, button: "left", clickCount: 1 });
    await delay(40);
    sendAgentInputEvent(target, { type: "mouseUp", x: toX, y: toY, button: "left", clickCount: 1 });
    await delay(40);
    return {
      ok: true,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      x: toX,
      y: toY,
      message:
        `drag sent to visual point (${fromX}, ${fromY}) -> (${toX}, ${toY})` +
        (request.point.reason === undefined ? "." : `: ${request.point.reason}`),
      nextRecommendedAction: "lyra_lumen.see"
    };
  };

  return {
    actOnAgentElement,
    actOnAgentPoint,
    actOnAgentVisualPoint,
    ensureAgentElementVisible,
    nextRecommendedActionAfterAgentAction,
    observeAfterAgentInput,
    performAgentPointerInteraction,
    readFocusedElementSignature,
    scrollAgentPage,
    staleElementResult
  };
};
