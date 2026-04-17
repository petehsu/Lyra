import type {
  WorkbenchWebAction,
  WorkbenchWebActionResult,
  WorkbenchWebElementNode,
  WorkbenchWebSurfaceAffordanceHint,
} from "../../shared/workbench-web-automation";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import { createWebAutomationError } from "./diagnostics";
import { selectorAddressResolverSource } from "./selector-address";

type VerificationSnapshot = {
  readonly url: string;
  readonly title: string;
  readonly targetPresent: boolean;
  readonly targetValue: string;
  readonly targetText: string;
  readonly checked: boolean;
  readonly activeTag: string;
  readonly widgetText: string;
  readonly widgetBusy: boolean;
  readonly localActionCount: number;
  readonly transientMenuCount: number;
  readonly selectedState: string;
  readonly listFingerprint: string;
  readonly cursorStyle: string;
  readonly tooltipText: string;
  readonly stateHint: string;
};

export type WorkbenchWebActionVerificationSnapshot = VerificationSnapshot;

type VerificationOutcome = {
  readonly verified: boolean;
  readonly stateTransition: NonNullable<NonNullable<WorkbenchWebActionResult["verification"]>["stateTransition"]>;
  readonly reason: string;
  readonly failureCode?:
    | "wrong_widget_target"
    | "no_state_transition"
    | "action_unverified"
    | "protected_verification_widget"
    | "reveal_not_observed"
    | "menu_not_opened"
    | "list_item_not_changed"
    | "mode_not_switched"
    | "workflow_not_advanced";
};

const normalizeText = (value: string | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const safeValue = (value: string | undefined): string =>
  typeof value === "string" ? value : "";

const includesSearchHint = (value: string): boolean =>
  value.includes("search")
  || value.includes("find")
  || value.includes("lookup")
  || value.includes("搜索")
  || value.includes("查找")
  || value.includes("检索");

const includesConversationHint = (value: string): boolean =>
  value.includes("chat")
  || value.includes("message")
  || value.includes("reply")
  || value.includes("prompt")
  || value.includes("composer")
  || value.includes("ask")
  || value.includes("question")
  || value.includes("对话")
  || value.includes("消息")
  || value.includes("提问")
  || value.includes("输入")
  || value.includes("发送");

const snapshotTextProfile = (
  snapshot: VerificationSnapshot,
  node: WorkbenchWebElementNode
): readonly string[] => [
  normalizeText(snapshot.targetText),
  normalizeText(snapshot.widgetText),
  normalizeText(snapshot.tooltipText),
  normalizeText(node.widgetKind),
  normalizeText(node.role),
  normalizeText(node.stableSignature.id),
  normalizeText(node.stableSignature.name),
  normalizeText(node.stableSignature.ariaLabel)
].filter((value) => value.length > 0);

const isSearchLikeTypingSurface = ({
  snapshot,
  node
}: {
  readonly snapshot: VerificationSnapshot;
  readonly node: WorkbenchWebElementNode;
}): boolean => {
  if (node.widgetKind === "search-bar") {
    return true;
  }
  return snapshotTextProfile(snapshot, node).some((value) => includesSearchHint(value));
};

const isConversationLikeTypingSurface = ({
  snapshot,
  node
}: {
  readonly snapshot: VerificationSnapshot;
  readonly node: WorkbenchWebElementNode;
}): boolean => {
  if (node.widgetKind === "chat-composer" || node.widgetKind === "composer") {
    return true;
  }
  return snapshotTextProfile(snapshot, node).some((value) => includesConversationHint(value));
};

const buildVerificationSnapshotScript = (node: WorkbenchWebElementNode): string => {
  const payload = JSON.stringify({ node });
  return `
    (() => {
      ${selectorAddressResolverSource}
      const payload = ${payload};

      const normalizeText = (value, maxLength = 280) => {
        if (typeof value !== "string") {
          return "";
        }
        const normalized = value.replace(/\\s+/g, " ").trim();
        if (normalized.length <= maxLength) {
          return normalized;
        }
        return normalized.slice(0, maxLength - 1) + "…";
      };

      const resolveBySignature = (signature, boundsHint) => {
        if (!signature || typeof signature !== "object") {
          return null;
        }
        let best = null;
        let bestScore = 0;
        const elements = Array.from(document.querySelectorAll("*"));
        for (const element of elements) {
          if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
            continue;
          }
          const tagName = element.tagName.toLowerCase();
          const role = normalizeText(element.getAttribute("role") || "");
          const inputType = tagName === "input"
            ? normalizeText(element.getAttribute("type") || "text")
            : "";
          const id = normalizeText(element.id || "");
          const name = normalizeText(element.getAttribute("name") || "");
          const testId = normalizeText(
            element.getAttribute("data-testid")
            || element.getAttribute("data-test")
            || element.getAttribute("data-qa")
            || ""
          );
          const ariaLabel = normalizeText(element.getAttribute("aria-label") || "");
          let score = 0;
          if (normalizeText(signature.tagName) === tagName) score += 3;
          if (normalizeText(signature.role) !== "" && normalizeText(signature.role) === role) score += 3;
          if (normalizeText(signature.inputType) !== "" && normalizeText(signature.inputType) === inputType) score += 2;
          if (normalizeText(signature.id) !== "" && normalizeText(signature.id) === id) score += 6;
          if (normalizeText(signature.name) !== "" && normalizeText(signature.name) === name) score += 4;
          if (normalizeText(signature.testId) !== "" && normalizeText(signature.testId) === testId) score += 7;
          if (normalizeText(signature.ariaLabel) !== "" && normalizeText(signature.ariaLabel) === ariaLabel) score += 4;
          if (boundsHint && typeof boundsHint.x === "number" && score >= 4) {
            const rect = element.getBoundingClientRect();
            const dx = Math.abs(rect.left + rect.width / 2 - (boundsHint.x + boundsHint.width / 2));
            const dy = Math.abs(rect.top + rect.height / 2 - (boundsHint.y + boundsHint.height / 2));
            if (dx < 80 && dy < 80) score += 2;
          }
          if (score > bestScore) {
            bestScore = score;
            best = element;
          }
        }
        return bestScore >= 6 ? best : null;
      };

      const resolveContainer = (element) => {
        let cursor = element instanceof HTMLElement ? element : null;
        while (cursor instanceof HTMLElement) {
          const role = normalizeText(cursor.getAttribute("role") || "", 40);
          const tag = cursor.tagName.toLowerCase();
          const hintText = normalizeText([
            cursor.id || "",
            cursor.getAttribute("name") || "",
            cursor.getAttribute("aria-label") || "",
            Array.from(cursor.classList || []).join(" ")
          ].join(" "), 200);
          const semantic = tag === "form"
            || tag === "section"
            || tag === "article"
            || tag === "dialog"
            || tag === "nav"
            || role === "dialog"
            || role === "toolbar"
            || role === "navigation"
            || role === "search"
            || hintText.includes("chat")
            || hintText.includes("composer")
            || hintText.includes("search")
            || hintText.includes("login")
            || hintText.includes("captcha")
            || hintText.includes("challenge");
          if (semantic) {
            return cursor;
          }
          cursor = cursor.parentElement;
        }
        return element instanceof HTMLElement ? element.parentElement : null;
      };

      const isVisibleElement = (candidate) => {
        if (!(candidate instanceof HTMLElement) && !(candidate instanceof SVGElement)) {
          return false;
        }
        const rect = candidate.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) {
          return false;
        }
        const style = window.getComputedStyle(candidate);
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity || "1") !== 0;
      };

      const actionSelector = [
        "button",
        "a[href]",
        "[role='button']",
        "[role='menuitem']",
        "[role='tab']",
        "[role='switch']",
        "[role='option']",
        "[data-testid]",
        "[aria-haspopup='menu']"
      ].join(", ");

      const readLocalActionCount = (container) => {
        if (!(container instanceof HTMLElement)) {
          return 0;
        }
        return Array.from(container.querySelectorAll(actionSelector))
          .filter((entry) => isVisibleElement(entry))
          .slice(0, 24)
          .length;
      };

      const readTransientMenuCount = (container) => {
        const root = container instanceof HTMLElement ? container.ownerDocument : document;
        const selector = [
          "[role='menu']",
          "[role='listbox']",
          "[role='dialog']",
          "[data-radix-popper-content-wrapper]",
          "[data-floating-ui-portal]",
          "[data-headlessui-state]"
        ].join(", ");
        return Array.from(root.querySelectorAll(selector))
          .filter((entry) => isVisibleElement(entry))
          .slice(0, 24)
          .length;
      };

      const readSelectedState = (container) => {
        if (!(container instanceof HTMLElement)) {
          return "";
        }
        const selector = [
          "[aria-selected='true']",
          "[aria-pressed='true']",
          "[aria-current='page']",
          "[data-state='active']",
          "[data-state='checked']",
          "[data-state='on']"
        ].join(", ");
        return Array.from(container.querySelectorAll(selector))
          .filter((entry) => isVisibleElement(entry))
          .map((entry) => normalizeText(
            entry.getAttribute("aria-label")
              || entry.textContent
              || entry.getAttribute("data-testid")
              || "",
            80
          ))
          .filter((value) => value.length > 0)
          .slice(0, 8)
          .join("|");
      };

      const resolveListRoot = (element) => {
        let cursor = element instanceof HTMLElement ? element : null;
        while (cursor instanceof HTMLElement) {
          const role = normalizeText(cursor.getAttribute("role") || "", 40);
          const tag = cursor.tagName.toLowerCase();
          const directChildren = Array.from(cursor.children || []).filter((child) => child instanceof HTMLElement);
          const visibleChildren = directChildren.filter((child) => isVisibleElement(child));
          const repeated = visibleChildren.length >= 2 && visibleChildren.some((child) =>
            normalizeText(child.textContent || "", 80).length > 0
          );
          if (role === "navigation" || role === "list" || tag === "nav" || tag === "ul" || repeated) {
            return cursor;
          }
          cursor = cursor.parentElement;
        }
        return null;
      };

      const readListFingerprint = (element) => {
        const root = resolveListRoot(element);
        if (!(root instanceof HTMLElement)) {
          return "";
        }
        return Array.from(root.children || [])
          .filter((entry) => entry instanceof HTMLElement && isVisibleElement(entry))
          .map((entry) => normalizeText(
            entry.getAttribute("aria-label")
              || entry.textContent
              || entry.getAttribute("data-testid")
              || "",
            80
          ))
          .filter((value) => value.length > 0)
          .slice(0, 12)
          .join("|");
      };

      const readCursorStyle = (element) => {
        if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) {
          return "";
        }
        return normalizeText(window.getComputedStyle(element).cursor || "", 40);
      };

      const readDescribedByText = (element) => {
        if (!(element instanceof Element)) {
          return "";
        }
        const ids = String(element.getAttribute("aria-describedby") || "")
          .split(/\\s+/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .slice(0, 4);
        const described = ids
          .map((id) => document.getElementById(id))
          .filter((entry) => entry instanceof HTMLElement)
          .map((entry) => normalizeText(entry.innerText || entry.textContent || "", 120))
          .filter((value) => value.length > 0)
          .join(" ");
        return normalizeText(described, 120);
      };

      const readTooltipText = (element, container) => {
        const direct = normalizeText(
          (element instanceof Element ? element.getAttribute("title") : "")
            || readDescribedByText(element)
            || "",
          120
        );
        if (direct.length > 0) {
          return direct;
        }
        const root = container instanceof HTMLElement ? container.ownerDocument : document;
        return Array.from(root.querySelectorAll("[role='tooltip'], [data-radix-tooltip-content], [data-tooltip], [data-state='delayed-open']"))
          .filter((entry) => isVisibleElement(entry))
          .map((entry) => normalizeText(entry.textContent || entry.getAttribute("aria-label") || "", 120))
          .find((value) => value.length > 0) || "";
      };

      const readStateHint = (element) => {
        if (!(element instanceof Element)) {
          return "";
        }
        const expanded = element.getAttribute("aria-expanded");
        if (expanded === "true") return "expanded";
        if (expanded === "false") return "collapsed";
        const selected = element.getAttribute("aria-selected");
        if (selected === "true") return "selected";
        if (selected === "false") return "unselected";
        const pressed = element.getAttribute("aria-pressed");
        if (pressed === "true") return "pressed";
        if (pressed === "false") return "unpressed";
        const dataState = normalizeText(element.getAttribute("data-state") || "", 40);
        if (dataState.length > 0) {
          return dataState;
        }
        return "";
      };

      const targetAddress = payload?.node?.selectorAddress;
      let element = __lyraResolveSelectorAddress(targetAddress?.path || "");
      if (!(element instanceof Element)) {
        element = resolveBySignature(payload?.node?.stableSignature, payload?.node?.bounds);
      }
      const container = resolveContainer(element);
      const activeElement = document.activeElement;
      return {
        url: String(location.href || ""),
        title: String(document.title || ""),
        targetPresent: element instanceof Element,
        targetValue: element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? String(element.value || "")
          : element instanceof HTMLElement && element.isContentEditable
            ? normalizeText(element.textContent || "")
            : "",
        targetText: element instanceof Element
          ? normalizeText(element.textContent || element.getAttribute?.("aria-label") || "", 200)
          : "",
        checked: element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")
          ? element.checked === true
          : false,
        activeTag: activeElement instanceof HTMLElement ? activeElement.tagName.toLowerCase() : "",
        widgetText: container instanceof HTMLElement
          ? normalizeText(container.innerText || container.textContent || "", 320)
          : "",
        widgetBusy: container instanceof HTMLElement
          ? container.querySelector("[aria-busy='true'], [role='progressbar'], [role='status'], [role='alert']") !== null
          : false,
        localActionCount: readLocalActionCount(container),
        transientMenuCount: readTransientMenuCount(container),
        selectedState: readSelectedState(container),
        listFingerprint: readListFingerprint(element),
        cursorStyle: readCursorStyle(element),
        tooltipText: readTooltipText(element, container),
        stateHint: readStateHint(element)
      };
    })()
  `;
};

const buildAffordanceHints = ({
  before,
  after,
}: {
  readonly before: VerificationSnapshot;
  readonly after: VerificationSnapshot;
}): readonly WorkbenchWebSurfaceAffordanceHint[] => {
  const hints: WorkbenchWebSurfaceAffordanceHint[] = [];
  const beforeTooltip = safeValue(before.tooltipText);
  const afterTooltip = safeValue(after.tooltipText);
  const beforeCursor = safeValue(before.cursorStyle);
  const afterCursor = safeValue(after.cursorStyle);
  const beforeState = safeValue(before.stateHint);
  const afterState = safeValue(after.stateHint);
  if (afterTooltip.length > 0 && afterTooltip !== beforeTooltip) {
    hints.push({
      kind: "tooltip",
      label: "Tooltip or inline explanation opened",
      detail: afterTooltip
    });
  }
  if (afterCursor.length > 0 && afterCursor !== beforeCursor) {
    hints.push({
      kind: "cursor",
      label: "Pointer affordance changed",
      detail: afterCursor
    });
  }
  if (afterState.length > 0 && afterState !== beforeState) {
    hints.push({
      kind: "state",
      label: "Control state changed",
      detail: afterState
    });
  }
  return hints;
};

export const captureWebActionVerificationSnapshot = async ({
  browserBridge,
  tabId,
  node,
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly tabId: string;
  readonly node: WorkbenchWebElementNode;
}): Promise<VerificationSnapshot> =>
  await browserBridge.executeFrameScript(tabId, {
    frameTreeNodeId: node.frameTreeNodeId,
    script: buildVerificationSnapshotScript(node),
    userGesture: false
  }) as VerificationSnapshot;

const verificationBudgetMs = ({
  action,
  node,
  before,
}: {
  readonly action: WorkbenchWebAction;
  readonly node: WorkbenchWebElementNode;
  readonly before: VerificationSnapshot;
}): number => {
  if (action.kind === "hover") {
    return node.widgetKind === "list-item"
      || node.widgetKind === "menu-trigger"
      || node.widgetKind === "navigation"
      || node.ownerWidgetId !== undefined
      ? 700
      : 320;
  }

  if (action.kind === "click" || action.kind === "submit_form" || action.kind === "press_key") {
    const baseBudget =
      node.widgetKind === "sidebar"
      || node.widgetKind === "menu-trigger"
      || node.widgetKind === "menu-panel"
      || node.widgetKind === "list-item"
      || node.widgetKind === "mode-switcher"
      || node.widgetKind === "toggle-group"
      || node.ownerWidgetId !== undefined
      || safeValue(before.stateHint) === "collapsed"
      || safeValue(before.stateHint) === "expanded"
        ? 1_250
        : 420;
    return baseBudget;
  }

  if (action.kind === "type" || action.kind === "clear_and_type") {
    return action.submit === true ? 1_650 : 420;
  }

  return 320;
};

const verifyOutcome = ({
  action,
  node,
  before,
  after,
  result,
}: {
  readonly action: WorkbenchWebAction;
  readonly node: WorkbenchWebElementNode;
  readonly before: VerificationSnapshot;
  readonly after: VerificationSnapshot;
  readonly result: WorkbenchWebActionResult;
}): VerificationOutcome => {
  const beforeTooltip = safeValue(before.tooltipText);
  const afterTooltip = safeValue(after.tooltipText);
  const beforeCursor = safeValue(before.cursorStyle);
  const afterCursor = safeValue(after.cursorStyle);
  const beforeState = safeValue(before.stateHint);
  const afterState = safeValue(after.stateHint);
  const isExpandableState = (value: string): boolean =>
    value === "collapsed" || value === "expanded";

  if (node.widgetKind === "protected") {
    return {
      verified: false,
      stateTransition: "none",
      reason: "target belongs to a protected verification widget",
      failureCode: "protected_verification_widget"
    };
  }

  if (action.kind === "hover") {
    if (after.transientMenuCount > before.transientMenuCount || after.localActionCount > before.localActionCount) {
      return {
        verified: true,
        stateTransition: "region_expanded",
        reason: "hover revealed new local controls"
      };
    }
    if (afterTooltip.length > 0 && afterTooltip !== beforeTooltip) {
      return {
        verified: true,
        stateTransition: "state_changed",
        reason: "hover revealed a tooltip or inline explanation"
      };
    }
    if (afterCursor.length > 0 && afterCursor !== beforeCursor) {
      return {
        verified: true,
        stateTransition: "state_changed",
        reason: "hover changed the pointer affordance"
      };
    }
    if (afterState.length > 0 && afterState !== beforeState) {
      return {
        verified: true,
        stateTransition: "state_changed",
        reason: "hover changed the nearby control state"
      };
    }
    if (node.widgetKind === "list-item" || node.widgetKind === "menu-trigger" || node.widgetKind === "navigation") {
      return {
        verified: false,
        stateTransition: "none",
        reason: "hover did not reveal the expected local affordances",
        failureCode: "reveal_not_observed"
      };
    }
    return {
      verified: true,
      stateTransition: "none",
      reason: "hover completed"
    };
  }

  if (action.kind === "focus") {
    return after.activeTag.length > 0
      ? { verified: true, stateTransition: "focus_changed", reason: "focus moved to target widget" }
      : { verified: false, stateTransition: "none", reason: "focus did not move", failureCode: "action_unverified" };
  }

  if (action.kind === "type" || action.kind === "clear_and_type") {
    const expected = normalizeText(action.text);
    const afterValue = normalizeText(after.targetValue);
    if (action.submit === true) {
      const searchLikeSurface = isSearchLikeTypingSurface({ snapshot: after, node });
      const conversationLikeSurface = isConversationLikeTypingSurface({ snapshot: after, node });
      if (result.submitted === true && searchLikeSurface && !conversationLikeSurface) {
        return {
          verified: false,
          stateTransition: "none",
          reason: "submit appeared to target a search-like input surface",
          failureCode: "wrong_widget_target"
        };
      }
      if (afterValue.length === 0 && before.targetValue !== after.targetValue) {
        return {
          verified: true,
          stateTransition:
            node.widgetKind === "chat-composer" || node.widgetKind === "composer"
              ? "message_submitted"
              : "value_changed",
          reason: "submit cleared the composer or form field"
        };
      }
      if (result.submitted === true && afterValue.length === 0) {
        return {
          verified: true,
          stateTransition:
            node.widgetKind === "chat-composer" || node.widgetKind === "composer" || conversationLikeSurface
              ? "message_submitted"
              : "value_changed",
          reason: "submit was acknowledged and target input is now empty"
        };
      }
      if (before.widgetText !== after.widgetText || before.widgetBusy !== after.widgetBusy) {
        return {
          verified: true,
          stateTransition:
            node.widgetKind === "chat-composer" || node.widgetKind === "composer"
              ? (before.widgetBusy !== after.widgetBusy ? "response_started" : "message_submitted")
              : "state_changed",
          reason: "widget content changed after submit"
        };
      }
      if (before.url !== after.url || before.title !== after.title) {
        return {
          verified: true,
          stateTransition: "navigation_changed",
          reason: "page state changed after submit"
        };
      }
      return {
        verified: false,
        stateTransition: "none",
        reason: "submit did not produce a clear field change or widget transition",
        failureCode:
          node.widgetKind === "chat-composer"
          || node.widgetKind === "composer"
          || conversationLikeSurface
            ? "wrong_widget_target"
            : "no_state_transition"
      };
    }

    if (expected.length > 0 && afterValue.includes(expected)) {
      return {
        verified: true,
        stateTransition: "value_changed",
        reason: "target field value changed"
      };
    }
    if (before.targetValue !== after.targetValue || before.targetText !== after.targetText) {
      return {
        verified: true,
        stateTransition: "value_changed",
        reason: "target content changed"
      };
    }
    return {
      verified: false,
      stateTransition: "none",
      reason: "typing did not change the target field",
      failureCode: "action_unverified"
    };
  }

  if (action.kind === "click" || action.kind === "submit_form" || action.kind === "press_key") {
    // press_key on composer widgets (e.g. Enter to send in ChatGPT) uses custom
    // event handlers that don't produce DOM mutations detectable by the snapshot.
    // Accept these as verified rather than blocking with workflow_not_advanced.
    if (
      action.kind === "press_key"
      && (node.widgetKind === "chat-composer" || node.widgetKind === "composer")
    ) {
      if (before.targetValue !== after.targetValue || before.widgetText !== after.widgetText || before.widgetBusy !== after.widgetBusy) {
        return {
          verified: true,
          stateTransition:
            before.widgetBusy !== after.widgetBusy
              ? "response_started"
              : normalizeText(before.targetValue).length > 0 && normalizeText(after.targetValue).length === 0
                ? "message_submitted"
                : "value_changed",
          reason: "composer content or state changed after key press"
        };
      }
      return {
        verified: true,
        stateTransition: "message_submitted",
        reason: "press_key on composer accepted without strict state verification"
      };
    }
    if (node.widgetKind === "menu-trigger" && after.transientMenuCount > before.transientMenuCount) {
      return {
        verified: true,
        stateTransition: "menu_opened",
        reason: "menu or transient action panel opened"
      };
    }
    if (
      (node.widgetKind === "mode-switcher" || node.widgetKind === "toggle-group")
      && (after.transientMenuCount > before.transientMenuCount || after.localActionCount > before.localActionCount)
    ) {
      return {
        verified: true,
        stateTransition: "menu_opened",
        reason: "mode switcher opened a transient option panel"
      };
    }
    if (
      (isExpandableState(beforeState) || isExpandableState(afterState))
      && beforeState !== afterState
    ) {
      return {
        verified: true,
        stateTransition: afterState === "expanded" ? "region_expanded" : "state_changed",
        reason: "expand or collapse control changed the local region state"
      };
    }
    if ((node.widgetKind === "mode-switcher" || node.widgetKind === "toggle-group") && before.selectedState !== after.selectedState) {
      return {
        verified: true,
        stateTransition: "model_changed",
        reason: "selected mode or toggle state changed"
      };
    }
    const listWorkflowTarget =
      node.widgetKind === "list-item"
      || node.widgetKind === "menu-panel"
      || node.ownerWidgetId !== undefined;
    if (listWorkflowTarget && before.listFingerprint !== after.listFingerprint) {
      const actionLabel = normalizeText(node.textSnippet ?? node.itemLabel ?? node.stableSignature.ariaLabel);
      if (actionLabel.includes("delete") || actionLabel.includes("remove")) {
        return {
          verified: true,
          stateTransition: "conversation_deleted",
          reason: "list structure changed after delete/remove action"
        };
      }
      if (before.selectedState !== after.selectedState) {
        return {
          verified: true,
          stateTransition: "state_changed",
          reason: "list selection changed after the action"
        };
      }
    }
    if (before.url !== after.url || before.title !== after.title) {
      return {
        verified: true,
        stateTransition: "navigation_changed",
        reason: "page navigation or title changed"
      };
    }
    if (before.widgetText !== after.widgetText || before.widgetBusy !== after.widgetBusy) {
      if (node.widgetKind === "chat-composer" || node.widgetKind === "composer") {
        return {
          verified: true,
          stateTransition: before.widgetBusy !== after.widgetBusy ? "response_started" : "message_submitted",
          reason: "widget content changed"
        };
      }
      if (action.kind !== "click") {
        return {
          verified: true,
          stateTransition: "state_changed",
          reason: "widget content changed after non-click action"
        };
      }
      if (!listWorkflowTarget) {
        return {
          verified: true,
          stateTransition: "state_changed",
          reason: "widget content changed"
        };
      }
      if (before.selectedState !== after.selectedState) {
        return {
          verified: true,
          stateTransition: "state_changed",
          reason: "widget selection state changed"
        };
      }
      if (after.transientMenuCount > before.transientMenuCount) {
        return {
          verified: true,
          stateTransition: "menu_opened",
          reason: "widget content change accompanied by transient panel"
        };
      }
    }
    if (before.checked !== after.checked) {
      return {
        verified: true,
        stateTransition: "state_changed",
        reason: "checked state changed"
      };
    }
    if (result.submitted === true && normalizeText(after.targetValue).length === 0) {
      return {
        verified: true,
        stateTransition:
          node.widgetKind === "chat-composer" || node.widgetKind === "composer"
            ? "message_submitted"
            : "value_changed",
        reason: "submit cleared the target field"
      };
    }
    if (node.widgetKind === "menu-trigger") {
      return {
        verified: false,
        stateTransition: "none",
        reason: "menu trigger click did not open a visible transient panel",
        failureCode: "menu_not_opened"
      };
    }
    if (node.widgetKind === "mode-switcher" || node.widgetKind === "toggle-group") {
      if (isExpandableState(beforeState) || isExpandableState(afterState)) {
        return {
          verified: false,
          stateTransition: "none",
          reason: "expand or collapse control did not change the local region state",
          failureCode: "workflow_not_advanced"
        };
      }
      return {
        verified: false,
        stateTransition: "none",
        reason: "mode switcher click did not change the selected state",
        failureCode: "mode_not_switched"
      };
    }
    if (
      node.widgetKind === "sidebar"
      || ((isExpandableState(beforeState) || isExpandableState(afterState)) && node.ownerWidgetId === undefined)
    ) {
      return {
        verified: false,
        stateTransition: "none",
        reason: "expand or collapse control did not change the local region state",
        failureCode: "workflow_not_advanced"
      };
    }
    if (node.widgetKind === "list-item" || node.ownerWidgetId !== undefined) {
      return {
        verified: false,
        stateTransition: "none",
        reason: "list item workflow did not advance",
        failureCode: "list_item_not_changed"
      };
    }
    return {
      verified: false,
      stateTransition: "none",
      reason: "click did not produce a verifiable widget state transition",
      failureCode:
        node.widgetKind === "chat-composer" || node.widgetKind === "composer"
          ? "wrong_widget_target"
          : "workflow_not_advanced"
    };
  }

  if (action.kind === "select_option" || action.kind === "set_checked") {
    if (before.targetValue !== after.targetValue || before.checked !== after.checked) {
      return {
        verified: true,
        stateTransition:
          node.widgetKind === "mode-switcher" || node.widgetKind === "toggle-group"
            ? "model_changed"
            : "state_changed",
        reason: "control state changed"
      };
    }
    return {
      verified: false,
      stateTransition: "none",
      reason: "control state did not change",
      failureCode: "action_unverified"
    };
  }

  return {
    verified: true,
    stateTransition: "none",
    reason: "action completed"
  };
};

export const verifyWebActionOutcome = async ({
  browserBridge,
  tabId,
  node,
  action,
  result,
  before,
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly tabId: string;
  readonly node: WorkbenchWebElementNode;
  readonly action: WorkbenchWebAction;
  readonly result: WorkbenchWebActionResult;
  readonly before: VerificationSnapshot;
}): Promise<WorkbenchWebActionResult> => {
  const pollIntervalMs = 90;
  const deadline = Date.now() + verificationBudgetMs({ action, node, before });
  let after = before;
  let outcome: VerificationOutcome = {
    verified: false,
    stateTransition: "none",
    reason: "verification did not observe a state transition",
    failureCode: "action_unverified"
  };

  while (Date.now() <= deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    after = await captureWebActionVerificationSnapshot({ browserBridge, tabId, node });
    outcome = verifyOutcome({ action, node, before, after, result });
    if (outcome.verified) {
      break;
    }
    if (outcome.failureCode === "protected_verification_widget") {
      break;
    }
  }

  const affordanceHints = buildAffordanceHints({ before, after });

  if (!outcome.verified) {
    throw createWebAutomationError(
      outcome.failureCode ?? "action_unverified",
      outcome.reason,
      "wait_postcondition",
      true,
      {
        frameTreeNodeId: node.frameTreeNodeId,
        selectorAttempts: [node.selectorAddress.path],
        details: {
          widgetId: node.widgetId,
          widgetKind: node.widgetKind,
          before,
          after
        }
      }
    );
  }

  return {
    ...result,
    verified: true,
    verification: {
      ...(node.widgetId === undefined ? {} : { widgetId: node.widgetId }),
      ...(node.widgetKind === undefined ? {} : { widgetKind: node.widgetKind }),
      stateTransition: outcome.stateTransition,
      reason: outcome.reason,
      ...(safeValue(after.cursorStyle).length === 0 ? {} : { cursorStyle: safeValue(after.cursorStyle) }),
      ...(safeValue(after.tooltipText).length === 0 ? {} : { tooltipText: safeValue(after.tooltipText) }),
      ...(affordanceHints.length === 0 ? {} : { affordanceHints })
    }
  };
};
