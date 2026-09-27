import { focusBrowserPageForInput } from "../workspace-focus-isolation";
import type { StampedSurfacePoint } from "./surface-control-names";
import { nativeSelectScript, type NativeSelectResult } from "./native-select";
import { beginSurfaceScrollScript, finishSurfaceScrollScript, revealSurfaceTargetScript } from "./surface-scroll";
import { createSurfaceFrameInput } from "./surface-frame-input";
import { randomUUID } from "node:crypto";
import { BoundPointerError, dispatchBoundPointer, cdpPointerModifiers, validatePointerOptions, type PointerOptions, type PointerReceipt } from "./bound-pointer";
import { beginSurfaceNameProbeScript, finishSurfaceNameProbeScript } from "./surface-name-runtime";
import { compactMapObservation } from "./agent-map-compaction";
import { compareSurface, observeActionSurface } from "./agent-surface-change";
import { settleSurfaceRevision } from "./agent-surface-revision";
import { armResponseWatch, cancelResponseWatch } from "./agent-response-watch";
import { formatAffordanceLine } from "./agent-affordance-lists";
import type { WorkbenchLumenStaleTarget } from "../../../shared/desktop-bridge";
import type { WorkbenchVisualCaptureResult } from "../../../shared/workbench-observation";
import type { BrowserAgentCursorOverlayAction } from "../agent-cursor-overlay";
import type {
  BrowserActionEffect,
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
import { verifyActionOutcome } from "./agent-action-verification";
import { browserElementEffectConflict, resolveGrantedBrowserActEffect } from "./agent-action-effect";
import {
  agentPointInsideViewport,
  centerOfAgentElement,
  humanClickPoint,
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
import { armStampedPointerScript, finishStampedPointerScript, activateStampedSurfaceScript, clickPointFromStamp, refreshStampedElement } from "./surface-control-names";
import { buildWorkflowElementIdentity } from "./agent-element-matcher";
import {
  appendWorkflowCacheStep,
  detectWorkflowVariableKey,
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
  | "openDebuggerSessionForTarget"
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
    openDebuggerSessionForTarget,
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

    await focusBrowserPageForInput(target.webContents);
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

  const performBoundSurfacePointer = async (
    tabId: string, target: BrowserAgentPageTarget, targetRef: string,
    interaction: "click" | "doubleClick" | "rightClick" | "hover",
    frame = target.webContents.mainFrame,
    pointer: PointerOptions = {}
  ) => {
    validatePointerOptions(pointer);
    const token = randomUUID();
    const execute = (script: string) => frame.executeJavaScript(script, true);
    const frameInput = createSurfaceFrameInput(frame);
    let parentBlocked = false;
    let point: { x: number; y: number };
    let receipt: PointerReceipt | null = null;
    // Following the page and focusing can resize it. Finish these before the
    // final node lookup; mouseover-induced changes are checked again below.
    await publishBrowserAgentActivity({ tabId, targetMode: target.targetMode, action: "act", interaction,
      cursorPhase: "move", inputActive: true, visibleFollow: target.browserMode.visibleFollow, durationMs: 2400 });
    await focusBrowserPageForInput(target.webContents);
    await execute(revealSurfaceTargetScript(targetRef));
    await frameInput.revealOwners();
    // Electron sendInputEvent targets the main RenderWidget and can stop at an
    // OOPIF owner. CDP dispatch goes through Chromium's frame hit-test router.
    const routed = frame.processId !== target.webContents.mainFrame.processId
      ? await openDebuggerSessionForTarget(target) : undefined;
    try {
      point = await dispatchBoundPointer({ interaction, options: pointer, send: async event => {
        if (event.type !== "mouseUp") assertSharedControlCanContinue(tabId);
        if (!routed) { sendAgentInputEvent(target, event); return; }
        markSyntheticInput(tabId);
        await routed.sendCommand("Input.dispatchMouseEvent", {
          type: event.type === "mouseDown" ? "mousePressed" : event.type === "mouseUp" ? "mouseReleased" : "mouseMoved",
          x: event.x, y: event.y, button: event.type === "mouseMove" ? "none" : event.button,
          clickCount: event.type === "mouseMove" ? 0 : event.clickCount,
          buttons: event.type === "mouseDown" ? (event.button === "right" ? 2 : event.button === "middle" ? 4 : 1) : 0,
          modifiers: cdpPointerModifiers(pointer.modifiers)
        });
      },
        beforeMove: async cursor => { await publishBrowserAgentActivity({ tabId, targetMode: target.targetMode,
          action: "act", interaction, cursorPhase: "move", inputActive: true,
          visibleFollow: target.browserMode.visibleFollow, cursor, durationMs: 2400 }); },
        prepare: async () => {
          assertSharedControlCanContinue(tabId);
          const result = await execute(activateStampedSurfaceScript(targetRef, 300, interaction === "hover", pointer.position)).catch(() => null);
          if (!result || typeof result !== "object" || (result as { trusted?: boolean }).trusted !== true) {
            const reason = (result as { reason?: string } | null)?.reason ?? "detached";
            throw new BoundPointerError(`Target is ${reason}. No activation was sent.`, reason);
          }
          if (interaction !== "hover" && !await execute(armStampedPointerScript(targetRef, token))) return null;
          const local = clickPointFromStamp(result);
          return local ? frameInput.translate(local, interaction === "hover" ? undefined : token) : null;
        }
      });
    } finally {
      receipt = await execute(finishStampedPointerScript(token)).catch(() => null) as PointerReceipt | null;
      parentBlocked = await frameInput.finish(token);
      await routed?.close().catch(() => undefined);
    }
    if (parentBlocked || receipt && (receipt.blocked || !receipt.accepted)) {
      throw new BoundPointerError(receipt?.accepted
        ? "The target received part of the gesture, then moved or became blocked. Inspect the outcome; do not repeat the action."
        : "Chromium did not deliver activation to the bound target. Any wrong-target event was blocked. Inspect the current map before another action.");
    }
    return { ...point!, inputDelivery: (receipt?.accepted ? "targetReceived" : "unconfirmed") as "targetReceived" | "unconfirmed" };
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

    await publishBrowserAgentActivity({
      tabId, targetMode: target.targetMode, action: "scroll", inputActive: true,
      visibleFollow: target.browserMode.visibleFollow, cursor, durationMs: 1_600
    });
    await focusBrowserPageForInput(target.webContents);
    const token = randomUUID();
    const execute = (script: string) => runFrameScriptWithTimeout(
      () => target.webContents.executeJavaScript(script, true), normalizeExecuteScriptTimeoutMs(timeoutMs, 1_500)
    );
    sendAgentInputEvent(target, { type: "mouseMove", ...cursor });
    await delay(20);
    await execute(beginSurfaceScrollScript(token, cursor));
    let change: { deltaX: number; deltaY: number; method: WorkbenchBrowserAgentScrollEffect["method"] };
    try {
      // DOM/CDP deltas describe document displacement; Electron's native
      // wheel delta describes wheel motion and uses the opposite sign.
      sendAgentInputEvent(target, { type: "mouseWheel", ...cursor, deltaX: -deltaX, deltaY: -deltaY });
      await delay(120);
      assertSharedControlCanContinue(tabId);
      markSyntheticInput(tabId);
      change = await execute(finishSurfaceScrollScript(token, deltaX, deltaY));
    } catch (error) {
      await execute(finishSurfaceScrollScript(token, 0, 0)).catch(() => undefined);
      throw error;
    }
    const actualDeltaX = Math.round(change.deltaX), actualDeltaY = Math.round(change.deltaY);
    const method = change.method;

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
    const frame = findFrameInWebContents(target.webContents, element.frameTreeNodeId) ?? target.webContents.mainFrame;
    assertSharedControlCanContinue(tabId);
    markSyntheticInput(tabId);
    const result = await runFrameScriptWithTimeout(
      () => frame.executeJavaScript(revealSurfaceTargetScript(element.targetRef, normalizeAgentScrollBlock(block ?? "center")), true),
      normalizeExecuteScriptTimeoutMs(timeoutMs, 1_500)
    ).catch(() => null) as { before: WorkbenchBrowserAgentElement["bounds"]; after: WorkbenchBrowserAgentElement["bounds"] } | null;
    await createSurfaceFrameInput(frame).revealOwners();
    const nextElement = await refreshStampedElement(element, script => frame.executeJavaScript(script, true));
    const point = centerOfAgentElement(nextElement);
    if (!result) return { element: nextElement, point };
    const deltaX = Math.round(result.before.x - result.after.x), deltaY = Math.round(result.before.y - result.after.y);
    return {
      element: nextElement, point,
      effect: { reason, scrolled: deltaX !== 0 || deltaY !== 0, method: deltaX || deltaY ? "scrollIntoView" : "none",
        before: { x: result.before.x + result.before.width / 2, y: result.before.y + result.before.height / 2 },
        after: point, deltaX, deltaY, targetRef: element.targetRef, elementId: element.id,
        ...(observationId === undefined ? {} : { beforeObservationId: observationId }) }
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
    request: WorkbenchBrowserAgentModeRequest & PointerOptions & {
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly effect?: BrowserActionEffect;
      readonly awaitResponse?: boolean;
      readonly interaction: WorkbenchBrowserAgentInteraction;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
      readonly settle?: boolean;
      readonly optionLabel?: string;
      readonly selectValue?: string;
      readonly selectValues?: readonly string[];
      readonly optionQuery?: string;
      readonly optionOffset?: number;
      readonly workflowId?: string;
      readonly cacheMode?: WorkbenchBrowserWorkflowCacheMode;
      readonly matchLevel?: import("../types").WorkbenchBrowserAgentElementMatchLevel;
    }
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    validatePointerOptions(request);
    if (request.cacheMode === "record" && [request.modifiers,request.button,request.holdMs,request.position,request.selectValues].some(value => value !== undefined)) {
      throw new Error("Workflow recording cannot preserve these extended gesture arguments. Use cacheMode=off; no action was sent.");
    }
    const startedAt = Date.now();
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const verification = normalizeAgentVerification(request.verification);
    const previousCache = readBrowserAgentCacheEntry(tabId, target.targetMode);
    if (
      shouldSettleBeforeObserve({
        ...(request.settle === undefined ? {} : { settle: request.settle }),
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

    const locatedElement = await refreshStampedElement(
      element,
      (script) => target.webContents.mainFrame.executeJavaScript(script, true)
    );
    const visibleTarget = await ensureAgentElementVisible({
      tabId,
      target,
      element: locatedElement,
      observationId,
      reason: "target_offscreen",
      block: "center",
      timeoutMs: request.timeoutMs
    });
    const interactionElement = visibleTarget.element ?? element;
    const autoScroll = visibleTarget.effect;
    const beforeUrl = agentTargetAddress(target);
    const grantedEffect = resolveGrantedBrowserActEffect(
      interactionElement,
      request.effect,
      beforeUrl,
      tabId
    );
    const effectConflict = request.interaction === "hover" ? null
      : request.effect === "observe" ? "effect=observe cannot activate a target. Use hover to inspect it."
      : browserElementEffectConflict(interactionElement, grantedEffect);
    if (effectConflict !== null) {
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
        elementId: interactionElement.id,
        targetRef: interactionElement.targetRef,
        ...(observationId === undefined ? {} : { beforeObservationId: observationId }),
        pageChanged: false,
        navigationStarted: false,
        error: {
          kind: "browserActionEffectConflict",
          message: effectConflict
        },
        nextRecommendedAction: "lyra_lumen.act"
      };
    }
    const beforeFocus = verification === "none"
      ? ""
      : await readFocusedElementSignature(target, request.timeoutMs);
    let { x, y } = humanClickPoint(interactionElement.bounds);
    let inputDelivery: "targetReceived" | "unconfirmed" | undefined;
    let interaction = request.interaction;
    let twoPhase = false;
    if (
      interaction === "select"
      || interaction === "click" && interactionElement.tagName === "select"
      || (
        (request.optionLabel !== undefined || request.selectValue !== undefined || request.selectValues !== undefined)
        && (interactionElement.role === "combobox" || interactionElement.role === "listbox" || interactionElement.tagName === "select")
      )
    ) {
      twoPhase = true;
      interaction = "click";
    }
    const stampRef = interactionElement.targetRef ?? "";
    const nameFrame = findFrameInWebContents(target.webContents, interactionElement.frameTreeNodeId) ?? target.webContents.mainFrame;
    let nativeSelected = false;
    let nativeSelection: { changed: boolean; values: string[] } | undefined;
    if (twoPhase) {
      const choices = { ...(request.optionQuery === undefined ? {} : {optionQuery:request.optionQuery}),
        ...(request.optionOffset === undefined ? {} : {optionOffset:request.optionOffset}), ...(request.optionLabel === undefined ? {} : {optionLabel: request.optionLabel}),
        ...(request.selectValue === undefined ? {} : {selectValue: request.selectValue}),
        ...(request.selectValues === undefined ? {} : {selectValues: request.selectValues}) };
      const ready = await nameFrame.executeJavaScript(activateStampedSurfaceScript(stampRef, 300), true) as StampedSurfacePoint | null;
      if (!ready?.trusted) return {ok:false, kind:"lyraLumenActionResult", tabId, inputMode:"chromium", targetRef:stampRef,
        error:{kind:"targetNotActionable",message:`Select is ${ready?.reason ?? "detached"}. No selection changed.`}};
      assertSharedControlCanContinue(tabId);
      const selected = await nameFrame.executeJavaScript(nativeSelectScript(stampRef, choices), true) as NativeSelectResult;
      if (selected.native && !selected.ok || !selected.native && request.selectValues !== undefined) return {
        ok:false, kind:"lyraLumenActionResult", tabId, inputMode:"chromium", targetRef:stampRef,
        error:{kind:"selectionRejected",message:selected.message ?? "selectValues requires a native multiple select. Use mapped options for a custom listbox."}};
      if (selected.inspection) return {ok:true,kind:"lyraLumenActionResult",tabId,targetMode:target.targetMode,
        inputMode:"chromium",targetRef:stampRef,selectionOptions:selected.inspection,
        message:"Native select options; no popup opened and no selection changed. Use selectValue/optionLabel, or optionQuery/optionOffset to inspect more choices.",
        nextRecommendedAction:"browser_act"};
      nativeSelected = selected.native === true;
      if (nativeSelected) {
        twoPhase = false;
        nativeSelection = {changed: selected.changed === true, values: selected.values ?? []};
      }
    }
    const unnamed = !interactionElement.label.replace(/[\s\u3164\u2800\u200b\u200c\u200d\ufeff]/g, "") || interactionElement.label === "(no label)";
    const nameProbe = interaction === "hover" && unnamed && stampRef.length > 0
      ? await runFrameScriptWithTimeout(() => nameFrame.executeJavaScript(beginSurfaceNameProbeScript(stampRef, true), true), 1000).catch(() => null)
      : null;
    const responseWatch = interaction === "click" && request.effect === "communicate" && stampRef
      ? await armResponseWatch(nameFrame, stampRef) : undefined;
    if (nativeSelected) {
      // Selection is already complete; do not open the native popup afterward.
    } else if ((interaction === "click" || interaction === "doubleClick" || interaction === "rightClick" || interaction === "hover") && stampRef.length > 0) {
      try {
        ({ x, y, inputDelivery } = await performBoundSurfacePointer(tabId, target, stampRef, interaction, nameFrame, request));
      } catch (error) {
        await cancelResponseWatch(nameFrame, responseWatch);
        if (!(error instanceof BoundPointerError)) throw error;
        return { ok: false, kind: "lyraLumenActionResult", tabId, inputMode: "chromium",
          targetMode: target.targetMode, browserMode: target.browserMode, targetRef: stampRef,
          error: { kind: "targetNotActionable", message: error.message }, nextRecommendedAction: error.nextAction };
      }
    } else {
      await performAgentPointerInteraction({
        tabId,
        target,
        x,
        y,
        interaction,
      });
    }
    await delay(interaction === "hover" ? 40 : 30);
    if (nameProbe) {
      await runFrameScriptWithTimeout(() => nameFrame.executeJavaScript(finishSurfaceNameProbeScript(stampRef, 1000), true), 1500).catch(() => undefined);
    }

    let elementDiffResult = await measureElementDiff(target, interactionElement, request.timeoutMs);
    if (twoPhase) {
      const { after: observed } = await observeActionSurface(previousCache, () => observeAgentPage(tabId, {
        strategy: "interactiveOnly",
        targetMode: target.targetMode,
        suppressActivity: true,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      }), { settle: (remaining, changed) => settleSurfaceRevision(target, remaining, changed) });
      const needle = (request.optionLabel ?? request.selectValue ?? "").trim().toLowerCase();
      const options = observed.elements.filter((candidate) => {
        const label = candidate.label.trim().toLowerCase();
        return needle.length > 0 && label === needle && candidate.frameRef === interactionElement.frameRef
          && (candidate.role === "option" || candidate.tagName === "option"
            || !previousCache?.elements.some(prior => prior.targetRef === candidate.targetRef));
      });
      if (options.length > 1) return {ok:false,kind:"lyraLumenActionResult",tabId,inputMode:"chromium",
        error:{kind:"ambiguousOption",message:"Several options match. Query the resulting map and choose an exact targetRef; nothing was selected."},
        message:observed.mapAppendix ?? ""};
      const option = options[0];
      const optionRef = option?.targetRef ?? "";
      if (needle.length > 0 && option === undefined) {
        return { ok: false, kind: "lyraLumenActionResult", tabId, inputMode: "chromium", targetMode: target.targetMode,
          targetRef: interactionElement.targetRef, afterObservationId: observed.observationId,
          error: { kind: "optionNotFound", message: "The control was opened, but the requested option was not found among its resulting controls. No option was selected." },
          message: observed.mapAppendix ?? "", nextRecommendedAction: "lyra_lumen.read" };
      }
      if (option !== undefined && optionRef.length > 0) {
        try {
          await performBoundSurfacePointer(tabId, target, optionRef, "click", nameFrame);
        } catch (error) {
          if (!(error instanceof BoundPointerError)) throw error;
          return { ok: false, kind: "lyraLumenActionResult", tabId, inputMode: "chromium", targetMode: target.targetMode,
            targetRef: optionRef, error: { kind: "targetNotActionable", message: error.message }, nextRecommendedAction: error.nextAction };
        }
        await delay(30);
        elementDiffResult = await measureElementDiff(target, interactionElement, request.timeoutMs);
      }
    }

    // Return the resulting controls in this call, so opening a menu/dialog does
    // not require another model round trip just to discover its buttons.
    const observedSurface = verification !== "fast" || responseWatch && request.awaitResponse ? null : await observeActionSurface(previousCache, () => observeAgentPage(tabId, {
      strategy: "interactiveOnly", targetMode: target.targetMode, suppressActivity: true,
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
    }), {
      settle: (remaining, changed) => settleSurfaceRevision(target, remaining, changed),
      focusOnly: isAgentEditableElement(interactionElement),
      acceptCursorChange: interaction === "hover",
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
    }).catch(() => null);
    const after = verification === "none"
      ? null
      : verification === "full"
        ? await observeAfterAgentInput(tabId, target.targetMode, request.timeoutMs)
        : observedSurface?.after ?? null;
    const surfaceChange = observedSurface?.surfaceChange ?? (after === null ? undefined : { ...compareSurface(previousCache, after), settled: true });
    if (after !== null) {
      const current = after.elements.find(element => element.targetRef === interactionElement.targetRef);
      elementDiffResult = buildElementDiff(elementStateFromCached(interactionElement), current === undefined ? null : elementStateFromCached(current));
    }
    const afterMap = after === null ? "" : compactMapObservation(previousCache, after).observation.mapAppendix ?? "";
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
    const pageChanged = beforeUrl !== agentTargetAddress(target) || surfaceChange?.changed === true;
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
          ...(() => {
            const fieldType = detectWorkflowVariableKey({
              interaction: request.interaction,
              ...(interactionElement.inputType === undefined
                ? {}
                : { inputType: interactionElement.inputType }),
              ...(interactionElement.autocompleteTokens === undefined
                ? {}
                : { autocompleteTokens: interactionElement.autocompleteTokens })
            });
            return fieldType === undefined ? {} : { fieldType };
          })(),
          identity: buildWorkflowElementIdentity(beforeUrl, interactionElement),
          ...(request.optionLabel === undefined ? {} : { optionLabel: request.optionLabel }),
          ...(request.selectValue === undefined ? {} : { selectValue: request.selectValue })
        }
      );
    }
    const runtimeCostMs = Date.now() - startedAt;
    const noObservableChange =
      !pageChanged
      && !navigationStarted
      && !("diffUnavailable" in elementDiffResult)
      && "noObservableChange" in elementDiffResult
      && elementDiffResult.noObservableChange === true;
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
      ...(nativeSelection === undefined ? {} : { nativeSelection, method: "nativeSelect" }),
      ...(responseWatch === undefined ? {} : { responseWatch: { ...responseWatch, targetRef: stampRef } }),
      ...(interaction === "hover" || inputDelivery === undefined ? {} : { inputDelivery }),
      ...(observationId === undefined ? {} : { beforeObservationId: observationId }),
      ...(after === null ? {} : { afterObservationId: after.observationId }),
      ...(autoScroll === undefined ? {} : { autoScroll }),
      pageChanged,
      ...(surfaceChange === undefined ? {} : { surfaceChange }),
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
      message: `Observed after ${request.interaction} on ${formatAffordanceLine(interactionElement, previousCache?.elements ?? [interactionElement])}.${after === null ? " Input dispatched; no resulting map available." : `\nPage: ${after.url}\n${afterMap}`}`,
      ...(noObservableChange
        ? {
          warning:
            surfaceChange?.cursorChanged
              ? "Only CSS cursor hints changed; this does not verify an operation or its outcome."
              : "No control or page-context change observed within the bounded wait. This does not establish failure; wait for the requested outcome before retrying the action."
        }
        : {}),
      nextRecommendedAction: navigationStarted || surfaceChange?.settled === false
        ? "lyra_lumen.wait"
        : noObservableChange && interaction !== "hover" ? "lyra_lumen.read"
        : after !== null ? "continue_with_cached_targets"
          : nextRecommendedActionAfterAgentAction({ navigationStarted, pageChanged })
    };
  };

  const verifyAgentActionOutcome = async (
    tabId: string,
    request: {
      readonly targetMode?: import("../types").WorkbenchBrowserAgentTargetMode;
      readonly targetRef?: string;
      readonly elementId?: number;
      readonly interaction?: import("../types").WorkbenchBrowserAgentInteraction;
      readonly timeoutMs?: number;
    }
  ) => {
    const targetMode = request.targetMode ?? "live";
    const cache = readBrowserAgentCacheEntry(tabId, targetMode);
    const cachedElement = request.targetRef !== undefined
      ? cache?.elementsByTargetRef.get(request.targetRef)
      : request.elementId !== undefined
        ? cache?.elementsById.get(request.elementId)
        : undefined;
    const observation = await observeAgentPage(tabId, {
      strategy: "interactiveOnly",
      targetMode,
      suppressActivity: true,
      timeoutMs: Math.max(250, Math.min(request.timeoutMs ?? 4_000, 8_000))
    });
    return {
      ok: true,
      kind: "lyraLumenActionVerification",
      tabId,
      targetMode,
      observationId: observation.observationId,
      ...verifyActionOutcome({
        ...(request.interaction === undefined ? {} : { interaction: request.interaction }),
        ...(request.targetRef === undefined ? {} : { targetRef: request.targetRef }),
        ...(cache?.url === undefined ? {} : { priorUrl: cache.url }),
        ...(cachedElement === undefined
          ? {}
          : { priorElement: elementStateFromCached(cachedElement) }),
        ...(cache === undefined
          ? {}
          : { priorObservation: { elements: cache.elements, url: cache.url, pageNotes: cache.pageNotes ?? [] } }),
        observation
      })
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
        element: await refreshStampedElement(found.element, script => target.webContents.mainFrame.executeJavaScript(script, true)),
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
      readonly effect?: BrowserActionEffect;
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
    await focusBrowserPageForInput(target.webContents);
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
    staleElementResult,
    verifyAgentActionOutcome
  };
};
