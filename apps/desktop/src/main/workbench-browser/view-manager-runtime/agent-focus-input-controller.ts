import { focusBrowserPageForInput } from "../workspace-focus-isolation";
import { browserHistoryDirection, navigateAgentHistory } from "./agent-history-navigation";
import { armResponseWatch } from "./agent-response-watch";
import { randomUUID } from "node:crypto";
import { prepareTextInputScript, armTextInputScript, verifyTextInputScript, cleanupTextInputScript, type BrowserTextInsertionResult } from "./agent-text-input";
import { dispatchBrowserKeys, browserKeyEvents, browserKeyRepeat } from "./agent-keyboard";
import { prepareBrowserKeyTargetScript, type BrowserEditorPreparation } from "./agent-editor-state";
import { compactMapObservation } from "./agent-map-compaction";
import type { BrowserActionEffect, WorkbenchBrowserAgentActionResult, WorkbenchBrowserAgentElement, WorkbenchBrowserAgentFocusDirection, WorkbenchBrowserAgentFocusResult, WorkbenchBrowserAgentFocusTrailEntry, WorkbenchBrowserAgentModeInfo, WorkbenchBrowserAgentModeRequest, WorkbenchBrowserAgentObservation, WorkbenchBrowserAgentScrollEffect, WorkbenchBrowserAgentTargetMode, WorkbenchBrowserAgentVerification } from "../types";
import { browserElementEffectConflict } from "./agent-action-effect";
import { delay, normalizeAgentVerification, normalizeExecuteScriptTimeoutMs, runFrameScriptWithTimeout } from "./normalizers";
import { centerOfAgentElement } from "./agent-action-runtime";
import { refreshStampedElement } from "./surface-control-names";
import { inputFieldFromElement, planInputWrites } from "./input-plan";
import { agentTargetAddress, agentTargetIsLoading } from "./agent-target-runtime";
import type { BrowserAgentPageTarget } from "./types";
import {
  normalizeAgentFocusDirection,
  normalizeAgentFocusSteps,
  type BrowserAgentFocusInputControllerDeps
} from "./agent-focus-input-support";

type InputReceipt = {
  readonly targetRef?: string;
  readonly verify: () => Promise<BrowserTextInsertionResult>;
  readonly dispose: () => Promise<unknown>;
};

const inputFacts = (result: BrowserTextInsertionResult) => ({
  ...(result.textPreview === undefined ? {} : { inputValuePreview: result.textPreview }),
  ...(result.evidence === undefined ? {} : { inputEvidence: result.evidence }),
  ...(result.textChanged === undefined ? {} : { inputTextChanged: result.textChanged })
});

export const createBrowserAgentFocusInputController = (deps: BrowserAgentFocusInputControllerDeps) => {
  const {
    actOnAgentElement,
    assertSharedControlCanContinue,
    ensureAgentElementVisible,
    findAgentElement,
    findFrameInWebContents,
    nextRecommendedActionAfterAgentAction,
    observeAfterAgentInput,
    observeAgentPage,
    performAgentPointerInteraction,
    publishBrowserAgentActivity,
    readFocusedElementSignature,
    recordFollowAction,
    resolveBrowserAgentTarget,
    sendAgentInputEvent,
    staleElementResult,
    stateStore
  } = deps;
  const {
    cacheBrowserAgentInputTarget,
    readBrowserAgentCacheEntry
  } = stateStore;

  const observeInputResult = async (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    verification: WorkbenchBrowserAgentVerification,
    timeoutMs?: number,
    collectControls = false
  ): Promise<WorkbenchBrowserAgentObservation | null> => {
    if (verification === "none") return null;
    if (verification === "full") return observeAfterAgentInput(tabId, targetMode, timeoutMs);
    // Input receipts independently verify the actual editor after rendering.
    // Filling a known field does not require rediscovering every page control.
    if (!collectControls) return null;
    return observeAgentPage(tabId, { strategy: "interactiveOnly", targetMode, suppressActivity: true,
      ...(timeoutMs === undefined ? {} : { timeoutMs }) }).catch(() => null);
  };
  const inputMapFeedback = (
    before: Pick<WorkbenchBrowserAgentObservation, "url" | "elements" | "pageNotes"> | undefined,
    after: WorkbenchBrowserAgentObservation | null
  ): string => after === null ? "" : `\nPage: ${after.url}\n${compactMapObservation(before, after).observation.mapAppendix ?? ""}`;

  const noEditableTargetResult = (
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    browserMode: WorkbenchBrowserAgentModeInfo | undefined,
    beforeObservationId?: string
  ): WorkbenchBrowserAgentActionResult => {
    recordFollowAction(tabId, targetMode, "type", {
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
      ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
      nextRecommendedAction: "lyra_lumen.map",
      error: {
        kind: "noEditableTarget",
        message:
          "No focused or previously selected editable browser element is available. Map the page and pass the editable elementId to lyra_lumen_type."
      }
    };
  };

  const insertTextIntoAgentElement = async (
    target: BrowserAgentPageTarget,
    element: WorkbenchBrowserAgentElement,
    text: string,
    clear: boolean,
    timeoutMs: number | undefined,
    receipts: InputReceipt[]
  ): Promise<BrowserTextInsertionResult> => {
    if (target.targetMode === "live") assertSharedControlCanContinue(target.tabId);
    const frame = findFrameInWebContents(target.webContents, element.frameTreeNodeId);
    if (!frame) return { ok: false, errorKind: "editable_frame_unavailable" };
    const key = `__lyraTextInput_${randomUUID().replaceAll("-", "")}`;
    const run = <T>(script: string) => runFrameScriptWithTimeout(
      () => frame.executeJavaScript(script, true), normalizeExecuteScriptTimeoutMs(timeoutMs, 4_000)
    ) as Promise<T>;
    let retained = false;
    const dispose = () => run(cleanupTextInputScript(key)).catch(() => undefined);
    try {
      const prepared = await run<BrowserTextInsertionResult & { needsClick?: boolean; x: number; y: number }>(
        prepareTextInputScript(key, element.targetRef ?? "", false));
      if (!prepared.ok) return prepared;
      if (prepared.needsClick) {
        await performAgentPointerInteraction({ tabId: target.tabId, target,
          x: prepared.x + (element.frameBounds?.x ?? 0), y: prepared.y + (element.frameBounds?.y ?? 0), interaction: "click" });
        await delay(30);
      }
      let armed = await run<BrowserTextInsertionResult & { skipInput?: boolean }>(armTextInputScript(key, text, clear));
      // Retry only focus preparation, before any text dispatch. This cannot
      // duplicate input and still refuses detached/replaced or foreign hosts.
      for (let attempt = 0; !armed.ok && armed.errorKind === "editable_changed" && attempt < 2; attempt++) {
        await delay(40);
        if (target.targetMode === "live") assertSharedControlCanContinue(target.tabId);
        armed = await run(armTextInputScript(key, text, clear));
      }
      if (!armed.ok) return armed;
      if (!armed.skipInput) {
        if (target.targetMode === "live") assertSharedControlCanContinue(target.tabId);
        await focusBrowserPageForInput(target.webContents);
        if (text) await target.webContents.insertText(text);
        else dispatchBrowserKeys(browserKeyEvents("Delete"), event => sendAgentInputEvent(target, event));
      }
      // Let input handlers and their queued render run before reading the live
      // host. A detached node retaining text is not successful input.
      await delay(30);
      const verify = () => run<BrowserTextInsertionResult>(verifyTextInputScript(key));
      const result = await verify();
      if (result.ok) { receipts.push({verify, dispose, targetRef: element.targetRef}); retained = true; }
      return result;
    } finally {
      if (!retained) await dispose();
    }
  };

  const markAgentFocusAnchor = async (target: BrowserAgentPageTarget): Promise<string | null> => {
    const token = `lyra-agent-focus-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const marked = await target.webContents.executeJavaScript(`
        (() => {
          const active = document.activeElement;
          if (!(active instanceof HTMLElement)) return false;
          active.setAttribute("data-lyra-agent-focus-anchor", ${JSON.stringify(token)});
          return true;
        })()
      `, true);
      return marked === true ? token : null;
    } catch {
      return null;
    }
  };

  const restoreAgentFocusAnchor = async (
    target: BrowserAgentPageTarget,
    token: string | null
  ): Promise<boolean> => {
    if (token === null) {
      return false;
    }
    try {
      const restored = await target.webContents.executeJavaScript(`
        (() => {
          const selector = ${JSON.stringify(`[data-lyra-agent-focus-anchor="${token}"]`)};
          const target = document.querySelector(selector);
          if (!(target instanceof HTMLElement)) return false;
          target.focus({ preventScroll: true });
          target.removeAttribute("data-lyra-agent-focus-anchor");
          return true;
        })()
      `, true);
      return restored === true;
    } catch {
      return false;
    }
  };

  const sendAgentTabKey = async (
    target: BrowserAgentPageTarget,
    backwards: boolean
  ): Promise<void> => {
    await focusBrowserPageForInput(target.webContents);
    if (backwards) {
      sendAgentInputEvent(target, { type: "keyDown", keyCode: "Tab", modifiers: ["shift"] });
    } else {
      sendAgentInputEvent(target, { type: "keyDown", keyCode: "Tab" });
    }
    await delay(12);
    if (backwards) {
      sendAgentInputEvent(target, { type: "keyUp", keyCode: "Tab", modifiers: ["shift"] });
    } else {
      sendAgentInputEvent(target, { type: "keyUp", keyCode: "Tab" });
    }
    await delay(60);
  };

  const focusedElementFromObservation = (
    observation: WorkbenchBrowserAgentObservation
  ): WorkbenchBrowserAgentElement | undefined => {
    if (observation.activeElementId === null) {
      return undefined;
    }
    return observation.elements.find((element) => element.id === observation.activeElementId);
  };

  const focusTrailEntryFromObservation = (
    step: number,
    observation: WorkbenchBrowserAgentObservation
  ): WorkbenchBrowserAgentFocusTrailEntry => {
    const element = focusedElementFromObservation(observation);
    return {
      step,
      elementId: observation.activeElementId,
      ...(element === undefined ? {} : { role: element.role, label: element.label })
    };
  };

  const focusAgentPage = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly direction: WorkbenchBrowserAgentFocusDirection;
      readonly steps?: number;
      readonly restoreFocus?: boolean;
      readonly timeoutMs?: number;
    }
  ): Promise<WorkbenchBrowserAgentFocusResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const direction = normalizeAgentFocusDirection(request.direction);
    const steps = normalizeAgentFocusSteps(direction, request.steps);
    const restoreFocus = request.restoreFocus ?? direction === "scan";
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "focus",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      durationMs: Math.max(1_400, Math.min(4_000, 950 + steps * 160))
    });
    const before = await observeAgentPage(tabId, {
      strategy: "focus",
      targetMode: target.targetMode,
      suppressActivity: true,
      ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
    });
    const anchor = restoreFocus ? await markAgentFocusAnchor(target) : null;
    const trail: WorkbenchBrowserAgentFocusTrailEntry[] = [];
    let current = before;
    const backwards = direction === "previous";

    for (let index = 0; index < steps; index += 1) {
      await sendAgentTabKey(target, backwards);
      current = await observeAgentPage(tabId, {
        strategy: "focus",
        targetMode: target.targetMode,
        suppressActivity: true,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      });
      trail.push(focusTrailEntryFromObservation(index + 1, current));
    }

    const restored = restoreFocus ? await restoreAgentFocusAnchor(target, anchor) : false;
    if (restored) {
      current = await observeAgentPage(tabId, {
        strategy: "focus",
        targetMode: target.targetMode,
        suppressActivity: true,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      });
    }
    const focusedElement = focusedElementFromObservation(current);

    return {
      ok: true,
      kind: "lyraLumenFocusResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      direction,
      steps,
      activeElementId: current.activeElementId,
      ...(focusedElement === undefined ? {} : { focusedElement }),
      focusTrail: trail,
      beforeObservationId: before.observationId,
      afterObservationId: current.observationId,
      restored,
      message: restored
        ? `Scanned ${steps} focus stop${steps === 1 ? "" : "s"} and restored the previous focus.`
        : `Moved focus ${direction} by ${steps} step${steps === 1 ? "" : "s"}.`,
      nextRecommendedAction: current.activeElementId === null ? "lyra_lumen.map" : "lyra_lumen.act"
    };
  };

  const performTypeIntoAgentElement = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly effect?: BrowserActionEffect;
      readonly text: string;
      readonly clear?: boolean;
      readonly fields?: readonly {
        readonly targetRef: string;
        readonly text: string;
        readonly clear?: boolean;
      }[];
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    },
    receipts: InputReceipt[]
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const verification = normalizeAgentVerification(request.verification);
    const currentUrl = agentTargetAddress(target);
    const wantedRefs = [
      ...(request.targetRef === undefined ? [] : [request.targetRef]),
      ...(request.fields === undefined ? [] : request.fields.map((field) => field.targetRef))
    ];
    const cached = readBrowserAgentCacheEntry(tabId, target.targetMode);
    const cacheCovers = cached !== undefined
      && wantedRefs.length > 0
      && wantedRefs.every((ref) => cached.elementsByTargetRef.has(ref));
    const observed = cacheCovers && cached !== undefined
      ? { observationId: cached.observationId, elements: cached.elements }
      : await observeAgentPage(tabId, {
          strategy: "interactiveOnly",
          targetMode: target.targetMode,
          suppressActivity: true,
          ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
        });
    let beforeObservationId = observed.observationId
      ?? readBrowserAgentCacheEntry(tabId, target.targetMode)?.observationId;
    const untargeted = request.targetRef === undefined
      && request.elementId === undefined
      && request.fields === undefined;
    if (untargeted) {
      const anchor = observed.elements.find(element => element.editable && element.semantics?.focused);
      if (anchor !== undefined) {
        const insertion = await insertTextIntoAgentElement(
          target,
          anchor,
          request.text,
          request.clear === true,
          request.timeoutMs,
          receipts
        );
        if (insertion.ok !== true) {
          return {
            ...inputFacts(insertion),
            ok: false,
            kind: "lyraLumenActionResult",
            tabId,
            inputMode: "chromium",
            targetMode: target.targetMode,
            browserMode: target.browserMode,
            ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
            nextRecommendedAction: "lyra_lumen.map",
            error: {
              kind: insertion.errorKind ?? "insertFailed",
              message: insertion.message ?? "当前焦点不是可以输入的框。"
            }
          };
        }
        const after = await observeInputResult(tabId, target.targetMode, verification, request.timeoutMs);
        return {
          ok: true,
          kind: "lyraLumenActionResult",
          tabId,
          inputMode: "chromium",
          targetMode: target.targetMode,
          browserMode: target.browserMode,
          ...(after === null ? {} : { afterObservationId: after.observationId }),
          ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
          ...inputFacts(insertion),
          message: `The focused field retained the requested edit.${inputMapFeedback(cached, after)}`,
          nextRecommendedAction: "continue_with_cached_targets"
        };
      }
    }
    const plan = planInputWrites(observed.elements.map(inputFieldFromElement), {
      ...(request.targetRef === undefined ? {} : { targetRef: request.targetRef }),
      ...(request.elementId === undefined ? {} : { elementId: request.elementId }),
      text: request.text,
      ...(request.clear === undefined ? {} : { clear: request.clear }),
      ...(request.fields === undefined ? {} : { assignments: request.fields })
    });
    if (plan.ok !== true) {
      if (plan.kind === "missingTarget") {
        const found = await findAgentElement(
          tabId,
          {
            ...(request.elementId === undefined ? {} : { elementId: request.elementId }),
            ...(request.targetRef === undefined ? {} : { targetRef: request.targetRef })
          },
          target.targetMode,
          request.timeoutMs
        );
        return staleElementResult(
          tabId,
          request.elementId,
          request.targetRef,
          target.targetMode,
          target.browserMode,
          found.observationId,
          found.staleTarget,
          "type"
        );
      }
      recordFollowAction(tabId, target.targetMode, "type", {
        visibleFollow: target.browserMode.visibleFollow,
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
        ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
        nextRecommendedAction: "lyra_lumen.map",
        error: { kind: plan.kind, message: plan.message }
      };
    }
    const planned = plan.writes[0];
    if (planned === undefined) {
      return noEditableTargetResult(tabId, target.targetMode, target.browserMode, beforeObservationId);
    }
    if (plan.writes.length > 1) {
      const written: string[] = [];
      for (const write of plan.writes) {
        const fieldElement = observed.elements.find((candidate) => candidate.targetRef === write.targetRef) ?? null;
        if (fieldElement === null) {
          return {
            ok: false,
            kind: "lyraLumenActionResult",
            tabId,
            inputMode: "chromium",
            targetMode: target.targetMode,
            browserMode: target.browserMode,
            ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
            nextRecommendedAction: "lyra_lumen.map",
            error: {
              kind: "fieldNotReady",
              message: `写到这里停下了。\n${written.join("\n")}`
            }
          };
        }
        const point = centerOfAgentElement(fieldElement);
        publishBrowserAgentActivity({
          tabId,
          targetMode: target.targetMode,
          action: "type",
          inputActive: true,
          visibleFollow: target.browserMode.visibleFollow,
          cursor: point,
          durationMs: Math.max(1_700, Math.min(8_000, 900 + write.text.length * 24))
        });
        const insertion = await insertTextIntoAgentElement(
          target,
          fieldElement,
          write.text,
          write.clear,
          request.timeoutMs,
          receipts
        );
        if (insertion.ok !== true) {
          return {
            ...inputFacts(insertion),
            ok: false,
            kind: "lyraLumenActionResult",
            tabId,
            inputMode: "chromium",
            targetMode: target.targetMode,
            browserMode: target.browserMode,
            targetRef: write.targetRef,
            ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
            nextRecommendedAction: "lyra_lumen.map",
            error: {
              kind: insertion.errorKind ?? "insertFailed",
              message: `${insertion.message ?? "这一格没有写上。"}\n${written.join("\n")}`
            }
          };
        }
        written.push(`${write.targetRef}: input verified`);
      }
      const after = await observeInputResult(tabId, target.targetMode, verification, request.timeoutMs);
      return {
        ok: true,
        kind: "lyraLumenActionResult",
        tabId,
        inputMode: "chromium",
        targetMode: target.targetMode,
        browserMode: target.browserMode,
        targetRef: planned.targetRef,
        ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
        ...(after === null ? {} : { afterObservationId: after.observationId }),
        message: written.join("\n") + inputMapFeedback(cached, after),
        nextRecommendedAction: "continue_with_cached_targets"
      };
    }
    let element = observed.elements.find((candidate) => candidate.targetRef === planned.targetRef) ?? null;
    if (element === null) {
      return noEditableTargetResult(tabId, target.targetMode, target.browserMode, beforeObservationId);
    }
    const plannedText = planned.text;
    const plannedClear = planned.clear;

    const locatedElement = await refreshStampedElement(
      element,
      (script) => target.webContents.mainFrame.executeJavaScript(script, true)
    );
    const visibleTarget = await ensureAgentElementVisible({
      tabId,
      target,
      element: locatedElement,
      observationId: beforeObservationId,
      reason: "target_offscreen",
      block: "center",
      timeoutMs: request.timeoutMs
    });
    element = visibleTarget.element ?? element;
    const autoScroll = visibleTarget.effect;
    const effectConflict = browserElementEffectConflict(element, request.effect);
    if (effectConflict !== null) {
      recordFollowAction(tabId, target.targetMode, "type", {
        visibleFollow: target.browserMode.visibleFollow,
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
        ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
        pageChanged: false,
        navigationStarted: false,
        error: {
          kind: "browserActionEffectConflict",
          message: effectConflict
        },
        nextRecommendedAction: "lyra_lumen.act"
      };
    }
    const { x, y } = centerOfAgentElement(element);
    const beforeUrl = agentTargetAddress(target);
    const beforeFocus = verification === "full"
      ? await readFocusedElementSignature(target, request.timeoutMs)
      : "";
    // First entry activates the editor; continuing input retains its selection.
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "type",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      cursor: { x, y },
      durationMs: Math.max(1_700, Math.min(5_000, 950 + plannedText.length * 24))
    });

    let insertion: Awaited<ReturnType<typeof insertTextIntoAgentElement>>;
    try {
      insertion = await insertTextIntoAgentElement(
        target,
        element,
        plannedText,
        plannedClear,
        request.timeoutMs,
        receipts
      );
    } catch (error) {
      recordFollowAction(tabId, target.targetMode, "type", {
        visibleFollow: target.browserMode.visibleFollow,
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
        x,
        y,
        ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
        ...(autoScroll === undefined ? {} : { autoScroll }),
        nextRecommendedAction: "lyra_lumen.map",
        error: {
          kind: "insertFailed",
          message: String(error instanceof Error ? error.message : error)
        }
      };
    }
    if (insertion.ok !== true) {
      recordFollowAction(tabId, target.targetMode, "type", {
        visibleFollow: target.browserMode.visibleFollow,
        inputActive: false,
        result: "failure"
      });
      return {
        ...inputFacts(insertion),
        ok: false,
        kind: "lyraLumenActionResult",
        tabId,
        inputMode: "chromium",
        targetMode: target.targetMode,
        browserMode: target.browserMode,
        elementId: element.id,
        targetRef: element.targetRef,
        x,
        y,
        ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
        ...(autoScroll === undefined ? {} : { autoScroll }),
        nextRecommendedAction: "lyra_lumen.map",
        error: {
          kind: insertion.errorKind ?? "insertFailed",
          message: insertion.message ?? `Unable to insert text into editable element ${element.id}.`
        }
      };
    }

    await delay(30);
    const after = await observeInputResult(tabId, target.targetMode, verification, request.timeoutMs);
    cacheBrowserAgentInputTarget(
      tabId,
      target.targetMode,
      element,
      after?.url ?? currentUrl,
      after?.observationId ?? beforeObservationId
    );
    const afterFocus = verification === "full"
      ? await readFocusedElementSignature(target, request.timeoutMs)
      : "";
    const pageChanged = beforeUrl !== agentTargetAddress(target);
    const navigationStarted = agentTargetIsLoading(target);
    const inputValuePreview = insertion.textPreview;
    return {
      ok: true,
      kind: "lyraLumenActionResult",
      tabId,
      inputMode: "chromium",
      targetMode: target.targetMode,
      browserMode: target.browserMode,
      elementId: element.id,
      targetRef: element.targetRef,
      x,
      y,
      verification,
      ...(inputValuePreview === undefined ? {} : { inputValuePreview }),
      ...(insertion.evidence === undefined ? {} : { inputEvidence: insertion.evidence }),
      ...(typeof insertion.textChanged === "boolean" ? { inputTextChanged: insertion.textChanged } : {}),
      ...(insertion.alreadyMatched === true ? { inputAlreadyMatched: true } : {}),
      ...(insertion.method === undefined ? {} : { inputInsertionMethod: insertion.method }),
      ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
      ...(after === null ? {} : { afterObservationId: after.observationId }),
      ...(autoScroll === undefined ? {} : { autoScroll }),
      pageChanged,
      ...(verification === "full" ? { focusChanged: beforeFocus !== afterFocus } : {}),
      navigationStarted,
      message: (insertion.alreadyMatched === true
          ? `Editable element ${element.id} already contained the requested text.`
          : `Typed into editable element ${element.id}. The editor accepted the text at input verification.`) + inputMapFeedback(cached, after),
      nextRecommendedAction: navigationStarted || pageChanged ? "lyra_lumen.map" : "continue_with_cached_targets"
    };
  };

  const typeIntoAgentElement = async (
    tabId: string, request: Parameters<typeof performTypeIntoAgentElement>[1]
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const receipts: InputReceipt[] = [];
    try {
      const result = await performTypeIntoAgentElement(tabId, request, receipts);
      if (!result.ok) return result;
      // Verify after the render boundary even when no feedback map is collected:
      // an input handler can replace/reset the editor asynchronously.
      const invalidFields: string[] = [];
      const fieldFeedback: string[] = [];
      for (const receipt of receipts) {
        const current = await receipt.verify().catch((): BrowserTextInsertionResult => ({ok:false, errorKind:"editable_changed"}));
        if (current.validation?.valid === false) invalidFields.push(current.validation.message);
        if (!current.ok) {
          const { inputValuePreview: _preview, inputTextChanged: _changed, inputEvidence: _evidence, inputAlreadyMatched: _matched, message: _message, ...base } = result;
          const message = current.message ?? "The editor changed after input. Read the current page before retrying; do not repeat the write automatically.";
          return { ...base, ...inputFacts(current), ...(receipt.targetRef === undefined ? {} : {targetRef:receipt.targetRef}), ok:false, message,
            error:{kind:current.errorKind ?? "input_not_accepted",message}, nextRecommendedAction:"lyra_lumen.map" };
        }
        const facts = current.fieldState;
        if (facts) fieldFeedback.push([
          receipt.targetRef ?? "Focused field",
          facts.invalid ? `invalid=${facts.invalid}` : "invalid=false",
          `error=${JSON.stringify(facts.validationMessage ?? "")}`,
          ...(facts.description ? [`description=${JSON.stringify(facts.description)}`] : []),
          ...Object.entries(facts.constraints ?? {}).map(([key,value]) => `${key}=${JSON.stringify(value)}`)
        ].join(" "));
      }
      return { ...result, message:[result.message,...fieldFeedback].filter(Boolean).join("\n"),
        inputValidation: { valid: invalidFields.length === 0, messages: invalidFields } };
    } finally {
      await Promise.allSettled(receipts.map(receipt => receipt.dispose()));
    }
  };

  const pressAgentKey = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly key: string;
      readonly repeat?: number;
      readonly selectText?: string;
      readonly occurrence?: number;
      readonly effect?: BrowserActionEffect;
      readonly awaitResponse?: boolean;
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const events = browserKeyEvents(request.key);
    const repeat = browserKeyRepeat(request.key, request.repeat);
    if (request.selectText !== undefined && request.targetRef === undefined && request.elementId === undefined) {
      throw new Error("selectText requires an explicit mapped target");
    }
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    if (target.targetMode === "live") assertSharedControlCanContinue(tabId);
    const historyDirection = browserHistoryDirection(request.key);
    if (historyDirection) {
      if (request.effect !== undefined && request.effect !== "navigate") throw new Error("Browser history navigation requires effect=navigate");
      if (repeat !== 1) throw new Error("History navigation accepts one step at a time; verify the destination before another step.");
      publishBrowserAgentActivity({ tabId, targetMode: target.targetMode, action: "press", inputActive: true,
        visibleFollow: target.browserMode.visibleFollow, durationMs: 1_000 });
      const result = await navigateAgentHistory(target.webContents, historyDirection, request.timeoutMs);
      return { ...result, kind:"lyraLumenActionResult",tabId,targetMode:target.targetMode,inputMode:"chromium",
        message:result.ok ? `Browser history ${historyDirection}: ${result.status}. Page: ${result.url}.`
          : result.error!.message,
        nextRecommendedAction:"lyra_lumen.map" };
    }
    const verification = normalizeAgentVerification(request.verification ?? "fast");
    const cached = readBrowserAgentCacheEntry(tabId, target.targetMode);
    let beforeObservationId = cached?.observationId;
    let elementId = request.elementId;
    let targetRef = request.targetRef;
    let x: number | undefined;
    let y: number | undefined;
    let autoScroll: WorkbenchBrowserAgentScrollEffect | undefined;
    if (elementId !== undefined || targetRef !== undefined) {
      const located = await findAgentElement(tabId, { ...(elementId === undefined ? {} : { elementId }), ...(targetRef === undefined ? {} : { targetRef }) }, target.targetMode, request.timeoutMs);
      if (!located.element) return staleElementResult(tabId, elementId, targetRef, target.targetMode,
        target.browserMode, located.observationId, located.staleTarget, "press");
      const element = located.element;
      beforeObservationId = located.observationId;
      elementId = element.id;
      targetRef = element.targetRef;
      ({ x, y } = centerOfAgentElement(element));
      const frame = findFrameInWebContents(target.webContents, element.frameTreeNodeId);
      const conflict = browserElementEffectConflict(element, request.effect);
      const prepared: BrowserEditorPreparation = conflict !== null && ["Enter", " "].includes(events[0]!.keyCode)
        ? { ok: false, errorKind: "browserActionEffectConflict", message: conflict }
        : frame === null || frame === undefined ? { ok: false, errorKind: "target_frame_gone" }
        : await runFrameScriptWithTimeout(() => frame.executeJavaScript(
          prepareBrowserKeyTargetScript(targetRef!, request.selectText, request.occurrence), true
        ), normalizeExecuteScriptTimeoutMs(request.timeoutMs)) as BrowserEditorPreparation;
      if (!prepared.ok) return { ok: false, kind: "lyraLumenActionResult", tabId,
        inputMode: "chromium", targetMode: target.targetMode, elementId, targetRef,
        error: { kind: prepared.errorKind ?? "focus_failed", message: prepared.message ?? "Unable to focus/select the current mapped target; no key was sent." },
        nextRecommendedAction: "lyra_lumen.map" };
    }
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "press",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      ...(x === undefined || y === undefined ? {} : { cursor: { x, y } }),
      durationMs: 1_550
    });
    const beforeUrl = agentTargetAddress(target);
    const beforeFocus = verification === "full"
      ? await readFocusedElementSignature(target, request.timeoutMs)
      : "";
    await focusBrowserPageForInput(target.webContents);
    const responseFrame = targetRef ? findFrameInWebContents(target.webContents,
      cached?.elementsByTargetRef.get(targetRef)?.frameTreeNodeId ?? target.webContents.mainFrame.frameTreeNodeId) : undefined;
    const responseWatch = request.effect === "communicate" && events.some(event => event.keyCode === "Enter") && targetRef && responseFrame
      ? await armResponseWatch(responseFrame, targetRef) : undefined;
    for (let index = 0; index < repeat; index += 1) {
      assertSharedControlCanContinue(tabId);
      dispatchBrowserKeys(events, event => sendAgentInputEvent(target, event));
    }
    await delay(30);
    const after = responseWatch && request.awaitResponse ? null : await observeInputResult(tabId, target.targetMode, verification, request.timeoutMs, true);
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
      ...(elementId === undefined ? {} : { elementId }),
      ...(targetRef === undefined ? {} : { targetRef }),
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
      ...(autoScroll === undefined ? {} : { autoScroll }),
      verification,
      ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
      ...(after === null ? {} : { afterObservationId: after.observationId }),
      pageChanged,
      ...(verification === "full" ? { focusChanged: beforeFocus !== afterFocus } : {}),
      navigationStarted,
      message: `Pressed ${request.key}${repeat > 1 ? ` × ${repeat}` : ""} with Chromium virtual keyboard.${inputMapFeedback(cached, after)}`,
      ...(responseWatch === undefined ? {} : { responseWatch: { ...responseWatch, targetRef: targetRef! } }),
      nextRecommendedAction: nextRecommendedActionAfterAgentAction({ navigationStarted, pageChanged })
    };
  };

  return {
    focusAgentPage,
    pressAgentKey,
    typeIntoAgentElement
  };
};
