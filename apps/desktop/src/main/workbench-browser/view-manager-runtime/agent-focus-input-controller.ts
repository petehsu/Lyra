import type { WorkbenchLumenStaleTarget } from "../../../shared/desktop-bridge";
import type { WorkbenchBrowserAgentActionResult, WorkbenchBrowserAgentElement, WorkbenchBrowserAgentFocusDirection, WorkbenchBrowserAgentFocusResult, WorkbenchBrowserAgentFocusTrailEntry, WorkbenchBrowserAgentModeInfo, WorkbenchBrowserAgentModeRequest, WorkbenchBrowserAgentObservation, WorkbenchBrowserAgentScrollEffect, WorkbenchBrowserAgentTargetMode, WorkbenchBrowserAgentVerification } from "../types";
import { boundsCenter, delay, normalizeAgentVerification, normalizeExecuteScriptTimeoutMs, runFrameScriptWithTimeout } from "./normalizers";
import { centerOfAgentElement } from "./agent-action-runtime";
import { agentTargetAddress, agentTargetIsLoading } from "./agent-target-runtime";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import type { BrowserAgentStateStore } from "./agent-state-store";
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
}>;

type BrowserAgentFocusInputControllerDeps = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "assertSharedControlCanContinue"
  | "findFrameInWebContents"
  | "publishBrowserAgentActivity"
  | "recordFollowAction"
  | "resolveBrowserAgentTarget"
  | "sendAgentInputEvent"
> & {
  readonly actOnAgentElement: (tabId: string, request: WorkbenchBrowserAgentModeRequest & { readonly elementId?: number; readonly targetRef?: string; readonly interaction: import("../types").WorkbenchBrowserAgentInteraction; readonly timeoutMs?: number; readonly verification?: WorkbenchBrowserAgentVerification }) => Promise<WorkbenchBrowserAgentActionResult>;
  readonly ensureAgentElementVisible: (request: { readonly tabId: string; readonly target: BrowserAgentPageTarget; readonly element: WorkbenchBrowserAgentElement; readonly observationId: string | undefined; readonly reason: WorkbenchBrowserAgentScrollEffect["reason"]; readonly block: import("../types").WorkbenchBrowserAgentScrollBlock | undefined; readonly timeoutMs: number | undefined }) => Promise<BrowserAgentAutoScrollResult>;
  readonly findAgentElement: FindAgentElement;
  readonly nextRecommendedActionAfterAgentAction: (request: { readonly navigationStarted: boolean; readonly pageChanged: boolean }) => string;
  readonly observeAfterAgentInput: (tabId: string, targetMode: WorkbenchBrowserAgentTargetMode, timeoutMs: number | undefined) => Promise<WorkbenchBrowserAgentObservation | null>;
  readonly observeAgentPage: (tabId: string, request?: WorkbenchBrowserAgentModeRequest & { readonly strategy?: import("../types").WorkbenchBrowserAgentObserveStrategy; readonly timeoutMs?: number; readonly suppressActivity?: boolean }) => Promise<WorkbenchBrowserAgentObservation>;
  readonly performAgentPointerInteraction: (request: { readonly tabId: string; readonly target: BrowserAgentPageTarget; readonly x: number; readonly y: number; readonly interaction: import("../types").WorkbenchBrowserAgentInteraction }) => Promise<void>;
  readonly readFocusedElementSignature: (target: BrowserAgentPageTarget, timeoutMs: number | undefined) => Promise<string>;
  readonly staleElementResult: (tabId: string, elementId: number | undefined, targetRef: string | undefined, targetMode: WorkbenchBrowserAgentTargetMode, browserMode: WorkbenchBrowserAgentModeInfo | undefined, observationId?: string, staleTarget?: WorkbenchLumenStaleTarget, action?: import("../agent-cursor-overlay").BrowserAgentCursorOverlayAction) => WorkbenchBrowserAgentActionResult;
  readonly stateStore: BrowserAgentStateStore;
};

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
    activeEditableElementFromObservation,
    cacheBrowserAgentInputTarget,
    readBrowserAgentCacheEntry,
    readCachedBrowserAgentInputTarget
  } = stateStore;

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

  const buildBrowserAgentTextInsertionScript = ({
    elementId,
    x,
    y,
    text,
    clear
  }: {
    readonly elementId: number;
    readonly x: number;
    readonly y: number;
    readonly text: string;
    readonly clear: boolean;
  }): string => `
    (() => {
      const TARGET_ID = ${JSON.stringify(elementId)};
      const POINT = ${JSON.stringify({ x, y })};
      const TEXT = ${JSON.stringify(text)};
      const CLEAR = ${JSON.stringify(clear)};

      const normalizeText = (value, maxLength = 160) => {
        if (typeof value !== "string") return "";
        const normalized = value.replace(/\\s+/g, " ").trim();
        return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength - 3) + "...";
      };

      const isDisabled = (element) =>
        element.disabled === true
        || element.getAttribute?.("disabled") !== null
        || element.getAttribute?.("aria-disabled") === "true";

      const isVisible = (element, win = window) => {
        const ElementCtor = win.Element || Element;
        if (!(element instanceof ElementCtor) || !element.isConnected) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = win.getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (Number.parseFloat(style.opacity || "1") <= 0) return false;
        return true;
      };

      const isEditable = (element) => {
        const win = element?.ownerDocument?.defaultView || window;
        const contentEditable = String(element.getAttribute?.("contenteditable") || "").toLowerCase();
        const role = String(element.getAttribute?.("role") || "").toLowerCase();
        return element instanceof win.HTMLInputElement
          || element instanceof win.HTMLTextAreaElement
          || element instanceof win.HTMLSelectElement
          || (element instanceof win.HTMLElement && element.isContentEditable)
          || (contentEditable.length > 0 && contentEditable !== "false")
          || role === "textbox"
          || role === "searchbox";
      };

      const selector = [
        "a[href]",
        "button",
        "input",
        "select",
        "textarea",
        "summary",
        "[contenteditable]",
        "[tabindex]",
        "[role='button']",
        "[role='link']",
        "[role='checkbox']",
        "[role='textbox']",
        "[role='searchbox']",
        "[role='menuitem']"
      ].join(",");

      const collectCandidates = () => {
        const items = [];
        const seen = new Set();
        const crawl = (doc, win, offsetX = 0, offsetY = 0) => {
          for (const element of Array.from(doc.querySelectorAll(selector))) {
            if (!(element instanceof win.Element) || seen.has(element)) continue;
            seen.add(element);
            if (!isVisible(element, win) || isDisabled(element)) continue;
            if (element instanceof win.HTMLInputElement && element.type === "hidden") continue;
            const rect = element.getBoundingClientRect();
            items.push({
              id: items.length + 1,
              element,
              bounds: {
                x: Math.round(rect.left + offsetX),
                y: Math.round(rect.top + offsetY),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              }
            });
          }
          for (const host of Array.from(doc.querySelectorAll("*"))) {
            if (host.shadowRoot) {
              for (const element of Array.from(host.shadowRoot.querySelectorAll(selector))) {
                if (!(element instanceof win.Element) || seen.has(element)) continue;
                seen.add(element);
                if (!isVisible(element, win) || isDisabled(element)) continue;
                if (element instanceof win.HTMLInputElement && element.type === "hidden") continue;
                const rect = element.getBoundingClientRect();
                items.push({
                  id: items.length + 1,
                  element,
                  bounds: {
                    x: Math.round(rect.left + offsetX),
                    y: Math.round(rect.top + offsetY),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                  }
                });
              }
            }
          }
          for (const frame of Array.from(doc.querySelectorAll("iframe, frame"))) {
            try {
              if (!isVisible(frame, win)) continue;
              const childDoc = frame.contentDocument || frame.contentWindow?.document;
              const childWin = frame.contentWindow;
              if (!childDoc || !childWin) continue;
              const frameRect = frame.getBoundingClientRect();
              crawl(childDoc, childWin, offsetX + frameRect.left, offsetY + frameRect.top);
            } catch (_error) {
              // Cross-origin frames cannot be edited through DOM injection here.
            }
          }
        };
        crawl(document, window);
        return items;
      };

      const editableNear = (element) => {
        const win = element?.ownerDocument?.defaultView || window;
        if (!(element instanceof win.Element)) return null;
        if (isEditable(element)) return element;
        const descendant = element.querySelector?.(
          "input:not([type='hidden']), textarea, select, [contenteditable], [role='textbox'], [role='searchbox']"
        );
        if (descendant instanceof win.Element && isEditable(descendant)) return descendant;
        let parent = element.parentElement;
        while (parent) {
          if (isEditable(parent)) return parent;
          parent = parent.parentElement;
        }
        return null;
      };

      const dispatchTextEvents = (element, data = TEXT) => {
        const win = element?.ownerDocument?.defaultView || window;
        try {
          element.dispatchEvent(new win.InputEvent("input", {
            bubbles: true,
            composed: true,
            data,
            inputType: "insertText"
          }));
        } catch (_error) {
          element.dispatchEvent(new win.Event("input", { bubbles: true }));
        }
        element.dispatchEvent(new win.Event("change", { bubbles: true }));
      };

      const isTextLikeInput = (element) => {
        const win = element?.ownerDocument?.defaultView || window;
        if (!(element instanceof win.HTMLInputElement)) return false;
        const type = String(element.getAttribute("type") || element.type || "text").toLowerCase();
        return [
          "",
          "email",
          "number",
          "password",
          "search",
          "tel",
          "text",
          "url"
        ].includes(type);
      };

      const hasSingleCharacterLimit = (element) =>
        element.maxLength === 1 || element.getAttribute("maxlength") === "1";

      const hasSegmentPositionHint = (element) => {
        const label = [
          element.getAttribute("aria-label"),
          element.getAttribute("name"),
          element.getAttribute("id"),
          element.getAttribute("placeholder")
        ].filter(Boolean).join(" ").toLowerCase();
        return /\\b(?:code|digit|character|char)\\b.*\\b\\d+\\b/.test(label)
          || /\\b\\d+\\b.*\\b(?:code|digit|character|char)\\b/.test(label)
          || /\\b\\d+\\s*(?:of|\\/)\\s*\\d+\\b/.test(label);
      };

      const isSingleCharacterSegmentInput = (element) =>
        isTextLikeInput(element)
        && (hasSingleCharacterLimit(element) || hasSegmentPositionHint(element));

      const inputCenterY = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.top + rect.height / 2;
      };

      const sameSegmentGroup = (targetInput, candidate) => {
        if (candidate.ownerDocument !== targetInput.ownerDocument) return false;
        if (targetInput.form !== null || candidate.form !== null) {
          return candidate.form === targetInput.form;
        }
        const targetRect = targetInput.getBoundingClientRect();
        return Math.abs(inputCenterY(candidate) - inputCenterY(targetInput))
          <= Math.max(36, targetRect.height * 1.75);
      };

      const maybeInsertSegmentedText = (targetInput) => {
        const win = targetInput?.ownerDocument?.defaultView || window;
        if (!(targetInput instanceof win.HTMLInputElement)) return null;
        const segmentText = TEXT.replace(/[\\s-]+/g, "");
        if (segmentText.length <= 1 || !isSingleCharacterSegmentInput(targetInput)) {
          return null;
        }

        const seenInputs = new Set();
        const candidates = [];
        for (const item of collectCandidates()) {
          const editable = editableNear(item.element);
          if (
            editable instanceof win.HTMLInputElement
            && !seenInputs.has(editable)
            && isSingleCharacterSegmentInput(editable)
            && sameSegmentGroup(targetInput, editable)
          ) {
            seenInputs.add(editable);
            candidates.push(editable);
          }
        }
        const startIndex = candidates.indexOf(targetInput);
        if (startIndex < 0) return null;
        const segmentTargets = candidates.slice(startIndex, startIndex + segmentText.length);
        if (segmentTargets.length < segmentText.length) {
          if (!hasSingleCharacterLimit(targetInput)) {
            return null;
          }
          return {
            ok: false,
            errorKind: "segmented_input_too_short",
            message: "Only found " + segmentTargets.length
              + " segmented input fields for " + segmentText.length + " characters."
          };
        }

        const beforeValues = segmentTargets.map((input) => input.value);
        for (let index = 0; index < segmentTargets.length; index += 1) {
          const input = segmentTargets[index];
          const char = segmentText[index];
          input.focus({ preventScroll: true });
          if (typeof input.setRangeText === "function") {
            input.setRangeText(char, 0, input.value.length, "end");
          } else {
            input.value = char;
          }
          dispatchTextEvents(input, char);
        }
        segmentTargets.at(-1)?.focus({ preventScroll: true });
        const afterValues = segmentTargets.map((input) => input.value);
        return {
          ok: afterValues.join("") === segmentText,
          method: "segmentedInput",
          tagName: "input",
          role: normalizeText(targetInput.getAttribute?.("role") || "", 40),
          textChanged: beforeValues.join("") !== afterValues.join(""),
          textPreview: normalizeText(afterValues.join(""), 120),
          segmentCount: segmentTargets.length
        };
      };

      const byId = collectCandidates().find((item) => item.id === TARGET_ID)?.element ?? null;
      const byPoint = document.elementFromPoint(POINT.x, POINT.y);
      const target = editableNear(byId) ?? editableNear(byPoint);
      const targetWindow = target?.ownerDocument?.defaultView || window;
      if (!(target instanceof targetWindow.Element)) {
        return { ok: false, errorKind: "editable_not_found" };
      }

      const before = target instanceof targetWindow.HTMLInputElement || target instanceof targetWindow.HTMLTextAreaElement
        ? target.value
        : target.textContent || "";
      let method = "dom";
      try {
        if (!CLEAR && before === TEXT) {
          return {
            ok: true,
            method: "alreadyMatched",
            tagName: String(target.tagName || "element").toLowerCase(),
            role: normalizeText(target.getAttribute?.("role") || "", 40),
            textChanged: false,
            textPreview: normalizeText(before, 120),
            alreadyMatched: true
          };
        }
        const segmented = maybeInsertSegmentedText(target);
        if (segmented !== null) {
          return segmented;
        }
        if (target instanceof targetWindow.HTMLInputElement || target instanceof targetWindow.HTMLTextAreaElement) {
          target.focus({ preventScroll: true });
          const start = CLEAR ? 0 : (target.selectionStart ?? target.value.length);
          const end = CLEAR ? target.value.length : (target.selectionEnd ?? target.value.length);
          if (typeof target.setRangeText === "function") {
            target.setRangeText(TEXT, start, end, "end");
            method = "setRangeText";
          } else {
            target.value = target.value.slice(0, start) + TEXT + target.value.slice(end);
            method = "value";
          }
          dispatchTextEvents(target);
        } else if (target instanceof targetWindow.HTMLElement) {
          target.focus({ preventScroll: true });
          const ownerDocument = target.ownerDocument || document;
          const selection = ownerDocument.getSelection?.();
          if (selection) {
            const range = ownerDocument.createRange();
            range.selectNodeContents(target);
            if (!CLEAR) {
              range.collapse(false);
            }
            selection.removeAllRanges();
            selection.addRange(range);
          }
          const inserted = ownerDocument.execCommand?.("insertText", false, TEXT) === true;
          method = inserted ? "execCommand.insertText" : "textNode";
          if (!inserted) {
            if (CLEAR) {
              target.textContent = TEXT;
            } else {
              target.appendChild(ownerDocument.createTextNode(TEXT));
            }
          }
          dispatchTextEvents(target);
        }
      } catch (error) {
        return {
          ok: false,
          errorKind: "insert_failed",
          message: String(error instanceof Error ? error.message : error)
        };
      }

      const after = target instanceof targetWindow.HTMLInputElement || target instanceof targetWindow.HTMLTextAreaElement
        ? target.value
        : target.textContent || "";
      return {
        ok: after !== before || (CLEAR && after === TEXT) || TEXT.length === 0,
        method,
        tagName: String(target.tagName || "element").toLowerCase(),
        role: normalizeText(target.getAttribute?.("role") || "", 40),
        textChanged: after !== before,
        textPreview: normalizeText(after, 120)
      };
    })()
  `;

  const insertTextIntoAgentElement = async (
    target: BrowserAgentPageTarget,
    element: WorkbenchBrowserAgentElement,
    text: string,
    clear: boolean,
    timeoutMs: number | undefined
  ): Promise<{
    readonly ok: boolean;
    readonly method?: string;
    readonly textChanged?: boolean;
    readonly textPreview?: string;
    readonly alreadyMatched?: boolean;
    readonly errorKind?: string;
    readonly message?: string;
  }> => {
    if (target.targetMode === "live") {
      assertSharedControlCanContinue(target.tabId);
    }
    const frame = findFrameInWebContents(target.webContents, element.frameTreeNodeId)
      ?? target.webContents.mainFrame;
    const { x, y } = centerOfAgentElement(element);
    const localPoint = element.localBounds === undefined
      ? {
          x: x - (element.frameBounds?.x ?? 0),
          y: y - (element.frameBounds?.y ?? 0)
        }
      : boundsCenter(element.localBounds);
    const raw = await runFrameScriptWithTimeout(
      () => frame.executeJavaScript(
        buildBrowserAgentTextInsertionScript({
          elementId: element.id,
          x: localPoint.x,
          y: localPoint.y,
          text,
          clear
        }),
        true
      ),
      normalizeExecuteScriptTimeoutMs(timeoutMs, 4_000)
    );
    if (raw === null || typeof raw !== "object") {
      return { ok: false, errorKind: "invalid_insert_result" };
    }
    const record = raw as Record<string, unknown>;
    return {
      ok: record.ok === true,
      ...(typeof record.method === "string" ? { method: record.method } : {}),
      ...(typeof record.errorKind === "string" ? { errorKind: record.errorKind } : {}),
      ...(typeof record.message === "string" ? { message: record.message } : {}),
      ...(typeof record.textPreview === "string" ? { textPreview: record.textPreview } : {}),
      ...(typeof record.alreadyMatched === "boolean" ? { alreadyMatched: record.alreadyMatched } : {}),
      ...(typeof record.textChanged === "boolean" ? { textChanged: record.textChanged } : {})
    };
  };

  const normalizeAgentFocusDirection = (
    direction: WorkbenchBrowserAgentFocusDirection | undefined
  ): WorkbenchBrowserAgentFocusDirection => {
    if (direction === "previous" || direction === "scan") {
      return direction;
    }
    return "next";
  };

  const normalizeAgentFocusSteps = (
    direction: WorkbenchBrowserAgentFocusDirection,
    steps: number | undefined
  ): number => {
    const defaultSteps = direction === "scan" ? 12 : 1;
    const maxSteps = direction === "scan" ? 40 : 10;
    const value = Number.isFinite(Number(steps)) ? Math.round(Number(steps)) : defaultSteps;
    return Math.max(1, Math.min(value, maxSteps));
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
    target.webContents.focus();
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

  const typeIntoAgentElement = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly text: string;
      readonly clear?: boolean;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const verification = normalizeAgentVerification(request.verification);
    const currentUrl = agentTargetAddress(target);
    let beforeObservationId = readBrowserAgentCacheEntry(tabId, target.targetMode)?.observationId;
    let element: WorkbenchBrowserAgentElement | null = null;
    if (request.elementId !== undefined || request.targetRef !== undefined) {
      const found = await findAgentElement(
        tabId,
        {
          ...(request.elementId === undefined ? {} : { elementId: request.elementId }),
          ...(request.targetRef === undefined ? {} : { targetRef: request.targetRef })
        },
        target.targetMode,
        request.timeoutMs
      );
      if (found.element === null) {
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
      beforeObservationId = found.observationId ?? beforeObservationId;
      element = found.element;
    } else {
      const observed = await observeAgentPage(tabId, {
        strategy: "interactiveOnly",
        targetMode: target.targetMode,
        suppressActivity: true,
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      });
      beforeObservationId = observed.observationId;
      element = activeEditableElementFromObservation(observed);
      if (element === null) {
        element = readCachedBrowserAgentInputTarget(tabId, target.targetMode, currentUrl)?.element ?? null;
      }
    }

    if (element === null) {
      return noEditableTargetResult(tabId, target.targetMode, target.browserMode, beforeObservationId);
    }

    const visibleTarget = await ensureAgentElementVisible({
      tabId,
      target,
      element,
      observationId: beforeObservationId,
      reason: "target_offscreen",
      block: "center",
      timeoutMs: request.timeoutMs
    });
    element = visibleTarget.element ?? element;
    const autoScroll = visibleTarget.effect;
    const { x, y } = centerOfAgentElement(element);
    const beforeUrl = agentTargetAddress(target);
    const beforeFocus = verification === "full"
      ? await readFocusedElementSignature(target, request.timeoutMs)
      : "";
    await performAgentPointerInteraction({
      tabId,
      target,
      x,
      y,
      interaction: "click"
    });
    publishBrowserAgentActivity({
      tabId,
      targetMode: target.targetMode,
      action: "type",
      inputActive: true,
      visibleFollow: target.browserMode.visibleFollow,
      cursor: { x, y },
      durationMs: Math.max(1_700, Math.min(5_000, 950 + request.text.length * 24))
    });

    let insertion: Awaited<ReturnType<typeof insertTextIntoAgentElement>>;
    try {
      insertion = await insertTextIntoAgentElement(
        target,
        element,
        request.text,
        request.clear === true,
        request.timeoutMs
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
    const after = verification === "full"
      ? await observeAfterAgentInput(tabId, target.targetMode, request.timeoutMs)
      : null;
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
      ...(typeof insertion.textChanged === "boolean" ? { inputTextChanged: insertion.textChanged } : {}),
      ...(insertion.alreadyMatched === true ? { inputAlreadyMatched: true } : {}),
      ...(insertion.method === undefined ? {} : { inputInsertionMethod: insertion.method }),
      ...(beforeObservationId === undefined ? {} : { beforeObservationId }),
      ...(after === null ? {} : { afterObservationId: after.observationId }),
      ...(autoScroll === undefined ? {} : { autoScroll }),
      pageChanged,
      ...(verification === "full" ? { focusChanged: beforeFocus !== afterFocus } : {}),
      navigationStarted,
      message:
        insertion.alreadyMatched === true
          ? `Editable element ${element.id} already contained the requested text.`
          : `Typed into editable element ${element.id}` +
            (insertion.method === undefined ? "." : ` via ${insertion.method}.`),
      nextRecommendedAction: nextRecommendedActionAfterAgentAction({ navigationStarted, pageChanged })
    };
  };

  const pressAgentKey = async (
    tabId: string,
    request: WorkbenchBrowserAgentModeRequest & {
      readonly key: string;
      readonly elementId?: number;
      readonly targetRef?: string;
      readonly timeoutMs?: number;
      readonly verification?: WorkbenchBrowserAgentVerification;
    }
  ): Promise<WorkbenchBrowserAgentActionResult> => {
    const target = await resolveBrowserAgentTarget(tabId, request, request.timeoutMs);
    const verification = normalizeAgentVerification(request.verification);
    let beforeObservationId = readBrowserAgentCacheEntry(tabId, target.targetMode)?.observationId;
    let elementId = request.elementId;
    let targetRef = request.targetRef;
    let x: number | undefined;
    let y: number | undefined;
    let autoScroll: WorkbenchBrowserAgentScrollEffect | undefined;
    if (elementId !== undefined || targetRef !== undefined) {
      const focused = await actOnAgentElement(tabId, {
        ...(elementId === undefined ? {} : { elementId }),
        ...(targetRef === undefined ? {} : { targetRef }),
        interaction: "click",
        targetMode: target.targetMode,
        visibleFollow: target.browserMode.visibleFollow,
        authState: target.browserMode.authState === "borrowedLiveLogin" ? "borrowLiveLogin" : "none",
        useLiveLoginState: target.browserMode.authState === "borrowedLiveLogin",
        verification: "none",
        ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs })
      });
      if (focused.ok === false) {
        recordFollowAction(tabId, target.targetMode, "press", {
          visibleFollow: target.browserMode.visibleFollow,
          inputActive: false,
          result: "failure"
        });
        return focused;
      }
      beforeObservationId = focused.beforeObservationId;
      elementId = focused.elementId;
      targetRef = focused.targetRef;
      x = focused.x;
      y = focused.y;
      autoScroll = focused.autoScroll;
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
    target.webContents.focus();
    sendAgentInputEvent(target, { type: "keyDown", keyCode: request.key });
    if (request.key.length === 1) {
      sendAgentInputEvent(target, { type: "char", keyCode: request.key });
    }
    sendAgentInputEvent(target, { type: "keyUp", keyCode: request.key });
    await delay(30);
    const after = verification === "full"
      ? await observeAfterAgentInput(tabId, target.targetMode, request.timeoutMs)
      : null;
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
      message: `Pressed ${request.key} with Chromium virtual keyboard.`,
      nextRecommendedAction: nextRecommendedActionAfterAgentAction({ navigationStarted, pageChanged })
    };
  };

  return {
    focusAgentPage,
    pressAgentKey,
    typeIntoAgentElement
  };
};
