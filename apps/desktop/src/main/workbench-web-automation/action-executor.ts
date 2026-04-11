import type {
  WorkbenchWebAction,
  WorkbenchWebActionRequest,
  WorkbenchWebActionResult,
  WorkbenchWebElementNode,
  WorkbenchWebWaitRequest,
  WorkbenchWebWaitResult
} from "../../shared/workbench-web-automation";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import { createWebAutomationError } from "./diagnostics";
import { findBestSignatureMatch } from "./signature";
import { normalizeSelectorAddress, selectorAddressResolverSource } from "./selector-address";
import type { WorkbenchWebGraphSnapshot } from "./types";

type ResolvedTarget = {
  readonly node: WorkbenchWebElementNode;
  readonly by: "node_id" | "selector_address" | "signature" | "css_selector" | "auto";
};

type NativePointerProbeResult = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const DOM_TARGET_ACTION_KINDS = new Set<WorkbenchWebAction["kind"]>([
  "focus",
  "hover",
  "scroll_into_view",
  "expand_probe",
  "click",
  "type",
  "clear_and_type",
  "select_option",
  "set_checked",
  "submit_form",
  "press_key",
  "open_link_node"
]);

const AUTO_TARGET_ACTION_KINDS = new Set<WorkbenchWebAction["kind"]>([
  "type",
  "clear_and_type",
  "press_key",
  "focus"
]);

const normalizeText = (value: string | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const scoreVisibility = (visibility: WorkbenchWebElementNode["visibilityState"]): number => {
  if (visibility === "visible") {
    return 6;
  }
  if (visibility === "offscreen") {
    return 2;
  }
  return -4;
};

const scoreTypingAffinity = (node: WorkbenchWebElementNode): number => {
  const tag = normalizeText(node.tagName);
  const role = normalizeText(node.role);
  let score = 0;
  if (node.interactable.typable) {
    score += 10;
  }
  if (tag === "textarea") {
    score += 6;
  } else if (tag === "input") {
    score += 5;
  } else if (tag === "body") {
    score -= 4;
  }
  if (role === "textbox" || role === "searchbox" || role === "combobox") {
    score += 4;
  }
  if ((node.stableSignature.ariaLabel ?? "").trim().length > 0) {
    score += 2;
  }
  if ((node.textSnippet ?? "").trim().length > 0) {
    score += 1;
  }
  if (node.disabled === true) {
    score -= 10;
  }
  return score + scoreVisibility(node.visibilityState);
};

const parseNameSelector = (selector: string): string | null => {
  const match = selector.match(/^\s*\[name=['"]?([^'"\]]+)['"]?\]\s*$/i);
  return match ? match[1]!.trim().toLowerCase() : null;
};

const parseAriaLabelSelector = (selector: string): string | null => {
  const match = selector.match(/^\s*\[aria-label=['"]?([^'"\]]+)['"]?\]\s*$/i);
  return match ? match[1]!.trim().toLowerCase() : null;
};

const findNodeByCssSelectorHint = (
  nodes: readonly WorkbenchWebElementNode[],
  rawSelector: string
): WorkbenchWebElementNode | null => {
  const selector = rawSelector.trim();
  if (selector.length === 0) {
    return null;
  }

  const idMatch = selector.match(/^#([A-Za-z_][A-Za-z0-9\-_:.]*)$/);
  if (idMatch !== null) {
    const needle = idMatch[1]!.toLowerCase();
    return nodes.find((node) => normalizeText(node.stableSignature.id) === needle) ?? null;
  }

  const byName = parseNameSelector(selector);
  if (byName !== null) {
    return nodes.find((node) => normalizeText(node.stableSignature.name) === byName) ?? null;
  }

  const byAriaLabel = parseAriaLabelSelector(selector);
  if (byAriaLabel !== null) {
    return nodes.find((node) => normalizeText(node.stableSignature.ariaLabel) === byAriaLabel) ?? null;
  }

  if (/^[a-z][a-z0-9-]*$/i.test(selector)) {
    return nodes.find((node) => normalizeText(node.tagName) === selector.toLowerCase()) ?? null;
  }

  if (selector.toLowerCase().includes("textarea")) {
    return nodes.find((node) => normalizeText(node.tagName) === "textarea") ?? null;
  }
  if (selector.toLowerCase().includes("input")) {
    return nodes.find((node) => normalizeText(node.tagName) === "input") ?? null;
  }

  return null;
};

const findAutoTargetNode = (
  graph: WorkbenchWebGraphSnapshot,
  action: WorkbenchWebAction
): WorkbenchWebElementNode | null => {
  if (action.kind === "type" || action.kind === "clear_and_type") {
    const typedCandidates = graph.nodes
      .filter((node) => node.interactable.typable && node.disabled !== true)
      .map((node) => ({ node, score: scoreTypingAffinity(node) }))
      .sort((left, right) => right.score - left.score);
    return typedCandidates[0]?.node ?? null;
  }

  if (action.kind === "press_key" || action.kind === "focus") {
    const focusCandidates = graph.nodes
      .filter((node) => (node.interactable.focusable || node.interactable.typable) && node.disabled !== true)
      .map((node) => ({ node, score: scoreTypingAffinity(node) }))
      .sort((left, right) => right.score - left.score);
    return focusCandidates[0]?.node ?? null;
  }

  return null;
};

const isGenericDocumentNode = (node: WorkbenchWebElementNode): boolean => {
  const tag = normalizeText(node.tagName);
  return tag === "body" || tag === "html";
};

const isWeakResolvedNodeForAction = (
  node: WorkbenchWebElementNode,
  action: WorkbenchWebAction
): boolean => {
  if ((action.kind === "type" || action.kind === "clear_and_type") && node.interactable.typable !== true) {
    return true;
  }
  if (action.kind === "press_key" && node.interactable.focusable !== true && node.interactable.typable !== true) {
    return true;
  }
  if (action.kind === "focus" && node.interactable.focusable !== true && node.interactable.typable !== true) {
    return true;
  }
  if (AUTO_TARGET_ACTION_KINDS.has(action.kind) && isGenericDocumentNode(node)) {
    return true;
  }
  return false;
};

const resolveTarget = ({
  graph,
  action
}: {
  readonly graph: WorkbenchWebGraphSnapshot;
  readonly action: WorkbenchWebAction;
}): ResolvedTarget => {
  if (DOM_TARGET_ACTION_KINDS.has(action.kind) === false) {
    throw createWebAutomationError(
      "invalid_request",
      `action ${action.kind} does not use a DOM target`,
      "precondition",
      false
    );
  }

  const rawTarget = (action as { readonly target: unknown }).target;
  if (rawTarget === null || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
    throw createWebAutomationError(
      "invalid_request",
      `action ${action.kind} target is invalid`,
      "precondition",
      false
    );
  }

  const target = rawTarget as {
    readonly nodeId?: unknown;
    readonly cssSelector?: unknown;
    readonly selectorAddress?: unknown;
    readonly stableSignature?: unknown;
  };

  const nodeId = typeof target.nodeId === "string" ? target.nodeId : undefined;
  if (typeof nodeId === "string" && nodeId.trim().length > 0) {
    const node = graph.nodes.find((entry) => entry.nodeId === nodeId.trim());
    if (node !== undefined) {
      return { node, by: "node_id" };
    }
  }

  const selectorAddress = normalizeSelectorAddress(
    target.selectorAddress as Parameters<typeof normalizeSelectorAddress>[0]
  );
  if (selectorAddress !== null) {
    const node = graph.nodes.find((entry) =>
      entry.selectorAddress.frameTreeNodeId === selectorAddress.frameTreeNodeId
      && entry.selectorAddress.path === selectorAddress.path
    );
    if (node !== undefined) {
      return { node, by: "selector_address" };
    }
  }

  const cssSelector =
    typeof target.cssSelector === "string" && target.cssSelector.trim().length > 0
      ? target.cssSelector.trim()
      : undefined;
  if (cssSelector !== undefined) {
    const node = findNodeByCssSelectorHint(graph.nodes, cssSelector);
    if (node !== null) {
      return { node, by: "css_selector" };
    }
  }

  if (target.stableSignature !== undefined && target.stableSignature !== null && typeof target.stableSignature === "object") {
    const node = findBestSignatureMatch(
      graph.nodes,
      target.stableSignature as Parameters<typeof findBestSignatureMatch>[1]
    );
    if (node !== null) {
      return { node, by: "signature" };
    }
  }

  throw createWebAutomationError(
    "node_not_found",
    "unable to resolve target node",
    "resolve_node",
    true,
    {
      candidateCount: graph.nodes.length,
      selectorAttempts: [
        ...(selectorAddress === null ? [] : [selectorAddress.path]),
        ...(cssSelector === undefined ? [] : [cssSelector]),
      ],
      details: {
        actionKind: action.kind,
      }
    }
  );
};

const buildNativePointerProbeScript = (node: WorkbenchWebElementNode): string => {
  const payload = JSON.stringify({ node });
  return `
    (async () => {
      ${selectorAddressResolverSource}
      const payload = ${payload};

      const normalizeText = (value) => {
        if (typeof value !== "string") {
          return "";
        }
        return value.replace(/\\s+/g, " ").trim();
      };

      const resolveBySignature = (signature) => {
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

          if (score > bestScore) {
            best = element;
            bestScore = score;
          }
        }
        return bestScore >= 8 ? best : null;
      };

      const toTopClientPoint = (x, y) => {
        let nextX = x;
        let nextY = y;
        let currentWindow = window;
        try {
          while (currentWindow !== currentWindow.top) {
            const frameElement = currentWindow.frameElement;
            if (!(frameElement instanceof Element)) {
              return null;
            }
            const frameRect = frameElement.getBoundingClientRect();
            nextX += frameRect.left;
            nextY += frameRect.top;
            currentWindow = currentWindow.parent;
          }
          return { x: Math.round(nextX), y: Math.round(nextY) };
        } catch {
          return null;
        }
      };

      const targetAddress = payload?.node?.selectorAddress;
      let element = __lyraResolveSelectorAddress(targetAddress?.path || "");
      if (!(element instanceof Element)) {
        element = resolveBySignature(payload?.node?.stableSignature);
      }
      if (!(element instanceof Element)) {
        return {
          ok: false,
          errorCode: "node_not_found",
          errorMessage: "target element not found"
        };
      }

      element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
      const rectA = element.getBoundingClientRect();
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));
      const rectB = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const stableDelta = Math.max(
        Math.abs(rectA.left - rectB.left),
        Math.abs(rectA.top - rectB.top),
        Math.abs(rectA.width - rectB.width),
        Math.abs(rectA.height - rectB.height)
      );

      if (rectB.width <= 1 || rectB.height <= 1 || style.display === "none" || style.visibility === "hidden") {
        return {
          ok: false,
          errorCode: "not_interactable",
          errorMessage: "target element is not visibly interactable"
        };
      }

      if (stableDelta > 1.5) {
        return {
          ok: false,
          errorCode: "element_not_stable",
          errorMessage: "target element layout is still moving"
        };
      }

      const localX = Math.max(1, Math.min(window.innerWidth - 1, rectB.left + rectB.width / 2));
      const localY = Math.max(1, Math.min(window.innerHeight - 1, rectB.top + rectB.height / 2));
      const hit = document.elementFromPoint(localX, localY);
      const hitMatches = hit instanceof Element && (
        hit === element
        || element.contains(hit)
        || hit.contains(element)
      );

      if (!hitMatches) {
        return {
          ok: false,
          errorCode: "pointer_intercepted",
          errorMessage: "target center is intercepted by another element",
          details: {
            hitTagName: hit instanceof Element ? hit.tagName.toLowerCase() : null
          }
        };
      }

      const globalPoint = toTopClientPoint(localX, localY);
      if (globalPoint === null) {
        return {
          ok: false,
          errorCode: "cross_origin_frame_blocked",
          errorMessage: "unable to translate frame coordinates into the top page viewport"
        };
      }

      return {
        ok: true,
        x: globalPoint.x,
        y: globalPoint.y,
        width: Math.round(rectB.width),
        height: Math.round(rectB.height)
      };
    })()
  `;
};

const probeNativePointerTarget = async ({
  browserBridge,
  tabId,
  node,
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly tabId: string;
  readonly node: WorkbenchWebElementNode;
}): Promise<NativePointerProbeResult> => {
  const raw = await browserBridge.executeFrameScript(tabId, {
    frameTreeNodeId: node.frameTreeNodeId,
    script: buildNativePointerProbeScript(node),
    userGesture: true
  }) as Record<string, unknown>;

  if (raw?.ok !== true) {
    const code = typeof raw?.errorCode === "string" ? raw.errorCode : "script_execution_failed";
    const message = typeof raw?.errorMessage === "string"
      ? raw.errorMessage
      : "failed to prepare native input target";
    throw createWebAutomationError(
      code as Parameters<typeof createWebAutomationError>[0],
      message,
      "precondition",
      code !== "cross_origin_frame_blocked",
      {
        frameTreeNodeId: node.frameTreeNodeId,
        selectorAttempts: [node.selectorAddress.path],
        ...(raw?.details && typeof raw.details === "object"
          ? { details: raw.details as Record<string, unknown> }
          : {})
      }
    );
  }

  return {
    x: Number(raw.x ?? 0),
    y: Number(raw.y ?? 0),
    width: Number(raw.width ?? 0),
    height: Number(raw.height ?? 0)
  };
};

const dispatchNativePointerClick = async ({
  browserBridge,
  tabId,
  point
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly tabId: string;
  readonly point: NativePointerProbeResult;
}): Promise<void> => {
  await browserBridge.dispatchNativeInput(tabId, [
    {
      type: "mouseMove",
      x: point.x,
      y: point.y,
      delayMs: 12
    },
    {
      type: "mouseDown",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
      delayMs: 18
    },
    {
      type: "mouseUp",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
      delayMs: 48
    }
  ]);
};

const buildActionScript = ({
  action,
  node
}: {
  readonly action: WorkbenchWebAction;
  readonly node: WorkbenchWebElementNode;
}): string => {
  const payload = JSON.stringify({
    action,
    node
  });

  return `
    (async () => {
      ${selectorAddressResolverSource}
      const payload = ${payload};

      const normalizeText = (value) => {
        if (typeof value !== "string") {
          return "";
        }
        return value.replace(/\s+/g, " ").trim();
      };

      const resolveBySignature = (signature) => {
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

          if (score > bestScore) {
            best = element;
            bestScore = score;
          }
        }
        return bestScore >= 8 ? best : null;
      };

      const targetAddress = payload?.node?.selectorAddress;
      let element = __lyraResolveSelectorAddress(targetAddress?.path || "");
      let resolvedBy = "address";
      if (!(element instanceof Element)) {
        element = resolveBySignature(payload?.node?.stableSignature);
        if (element instanceof Element) {
          resolvedBy = "signature";
        }
      }
      if (!(element instanceof Element)) {
        const cssSelector = typeof payload?.action?.target?.cssSelector === "string"
          ? payload.action.target.cssSelector.trim()
          : "";
        if (cssSelector.length > 0) {
          try {
            element = document.querySelector(cssSelector);
            if (element instanceof Element) {
              resolvedBy = "css_selector";
            }
          } catch {
            // keep fallback failure semantics
          }
        }
      }
      if (!(element instanceof Element)) {
        return {
          ok: false,
          errorCode: "node_not_found",
          errorMessage: "target element not found"
        };
      }

      const action = payload.action;
      const tag = element.tagName.toLowerCase();
      const isDisabled = element instanceof HTMLInputElement
        || element instanceof HTMLButtonElement
        || element instanceof HTMLSelectElement
        || element instanceof HTMLTextAreaElement
        ? element.disabled
        : false;
      if (isDisabled) {
        return {
          ok: false,
          errorCode: "not_interactable",
          errorMessage: "target element is disabled"
        };
      }

      const finishOk = (method, note, extra) => ({
        ok: true,
        method,
        resolvedBy,
        ...(typeof note === "string" && note.length > 0 ? { note } : {}),
        ...(extra && typeof extra === "object" ? extra : {})
      });

      const dispatchInputEvents = (target, text, inputType) => {
        const normalizedInputType = typeof inputType === "string" && inputType.length > 0
          ? inputType
          : "insertText";
        const normalizedText = typeof text === "string" ? text : "";
        if (typeof InputEvent === "function") {
          try {
            target.dispatchEvent(new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              data: normalizedText,
              inputType: normalizedInputType
            }));
          } catch {
            // fall through to generic events
          }
          try {
            target.dispatchEvent(new InputEvent("input", {
              bubbles: true,
              cancelable: true,
              data: normalizedText,
              inputType: normalizedInputType
            }));
          } catch {
            target.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
          }
        } else {
          target.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
        }
        target.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
      };

      const setNativeControlValue = (target, value) => {
        const prototype = target instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        if (descriptor && typeof descriptor.set === "function") {
          descriptor.set.call(target, value);
          return;
        }
        target.value = value;
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
        if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") {
          return false;
        }
        return true;
      };

      const isDisabledElement = (candidate) =>
        candidate instanceof HTMLButtonElement
        || candidate instanceof HTMLInputElement
        || candidate instanceof HTMLSelectElement
        || candidate instanceof HTMLTextAreaElement
          ? candidate.disabled
          : candidate.getAttribute?.("aria-disabled") === "true";

      const hasVerticalOverlap = (left, right) =>
        Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 0;

      const collectImplicitSubmitCandidates = (target) => {
        if (!(target instanceof HTMLElement)) {
          return [];
        }
        const targetRect = target.getBoundingClientRect();
        const targetForm = target.closest("form");
        const selector = [
          "button",
          "input[type='submit']",
          "input[type='button']",
          "[role='button']",
          "a[role='button']"
        ].join(", ");
        const deduped = new Set();
        const ranked = [];
        let depth = 0;
        let container = target.parentElement;
        while (container && depth < 6) {
          const matches = Array.from(container.querySelectorAll(selector));
          for (const candidate of matches) {
            if (!(candidate instanceof HTMLElement || candidate instanceof SVGElement)) {
              continue;
            }
            if (candidate === target || candidate.contains(target)) {
              continue;
            }
            if (!isVisibleElement(candidate) || isDisabledElement(candidate)) {
              continue;
            }
            if (deduped.has(candidate)) {
              continue;
            }
            const rect = candidate.getBoundingClientRect();
            const tagName = candidate.tagName.toLowerCase();
            const role = normalizeText(candidate.getAttribute?.("role") || "");
            let score = 0;
            score += Math.max(0, 6 - depth);
            if (candidate.closest("form") === targetForm && targetForm !== null) {
              score += 8;
            }
            if (hasVerticalOverlap(targetRect, rect)) {
              score += 5;
            }
            if (rect.left >= targetRect.right - 80 && rect.left <= targetRect.right + 200) {
              score += 8;
            }
            if (rect.top >= targetRect.top - 40 && rect.top <= targetRect.bottom + 90) {
              score += 4;
            }
            if (rect.width <= 96 && rect.height <= 96) {
              score += 3;
            }
            if (tagName === "button" || tagName === "input") {
              score += 4;
            }
            if (role === "button") {
              score += 3;
            }
            if (rect.width <= 72 && rect.height <= 72) {
              score += 2;
            }
            if (rect.width >= 120 && rect.height <= 44) {
              score -= 4;
            }
            const centerDistance = Math.abs((rect.top + rect.height / 2) - (targetRect.top + targetRect.height / 2))
              + Math.max(0, rect.left - targetRect.right);
            score -= Math.min(12, centerDistance / 40);
            if (score >= 8) {
              deduped.add(candidate);
              ranked.push({ candidate, score });
            }
          }
          container = container.parentElement;
          depth += 1;
        }
        ranked.sort((left, right) => right.score - left.score);
        return ranked.slice(0, 6).map((entry) => entry.candidate);
      };

      const looksLikeComposerTarget = (target) => {
        if (!(target instanceof HTMLElement)) {
          return false;
        }
        const rect = target.getBoundingClientRect();
        const tagName = target.tagName.toLowerCase();
        const inputType = normalizeText(target.getAttribute("type") || "");
        const isTypingSurface = tagName === "textarea"
          || target.isContentEditable
          || (tagName === "input" && (inputType === "" || inputType === "text" || inputType === "search"));
        if (!isTypingSurface) {
          return false;
        }
        return rect.width >= 240 && rect.top >= window.innerHeight * 0.45;
      };

      const dispatchEnterSequence = (target) => {
        const eventInit = {
          key: "Enter",
          code: "Enter",
          bubbles: true,
          cancelable: true
        };
        target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
        target.dispatchEvent(new KeyboardEvent("keypress", eventInit));
        target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
      };

      const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

      const readComposerValue = (target) => {
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          return String(target.value || "");
        }
        if (target instanceof HTMLElement && target.isContentEditable) {
          return normalizeText(target.textContent || "");
        }
        return "";
      };

      const verifySubmitConfirmation = async (target) => {
        const deadline = Date.now() + 1800;
        while (Date.now() <= deadline) {
          await delay(120);
          const nextValue = normalizeText(readComposerValue(target));
          if (nextValue.length === 0) {
            return true;
          }
        }
        return false;
      };

      const shouldTreatEnterAsSubmitAttempt = (target, action) => {
        if (!(target instanceof HTMLElement)) {
          return false;
        }
        const key = normalizeText(typeof action.key === "string" ? action.key : "");
        if (key !== "enter" && key !== "return") {
          return false;
        }
        if (action.shift === true || action.alt === true || action.ctrl === true) {
          return false;
        }
        return looksLikeComposerTarget(target);
      };

      const maybeSubmitAfterTyping = async (target, action) => {
        const wantsSubmit = action.submit === true;
        const allowImplicitSubmit = action.submit !== false && looksLikeComposerTarget(target);
        if (wantsSubmit || allowImplicitSubmit) {
          const targetForm = target instanceof HTMLElement ? target.closest("form") : null;
          if (targetForm instanceof HTMLFormElement) {
            if (typeof targetForm.requestSubmit === "function") {
              targetForm.requestSubmit();
            } else {
              targetForm.submit();
            }
            const confirmedByForm = await verifySubmitConfirmation(target);
            if (confirmedByForm) {
              return {
                submitted: true,
                submissionMethod: "click",
                note: "typed text and submitted it using the nearest form"
              };
            }
          }

          dispatchEnterSequence(target);
          const confirmed = await verifySubmitConfirmation(target);
          if (confirmed) {
            return {
              submitted: true,
              submissionMethod: "enter",
              note: wantsSubmit
                ? "typed text and submitted it with Enter"
                : "typed text and auto-submitted it with Enter"
            };
          }

          const submitCandidates = collectImplicitSubmitCandidates(target);
          for (const submitCandidate of submitCandidates) {
            submitCandidate.click?.();
            if (!(submitCandidate instanceof HTMLElement)) {
              submitCandidate.dispatchEvent(new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window
              }));
            }
            const confirmedByClick = await verifySubmitConfirmation(target);
            if (confirmedByClick) {
              return {
                submitted: true,
                submissionMethod: "click",
                note: wantsSubmit
                  ? "typed text and submitted it by clicking a nearby submit control"
                  : "typed text and auto-submitted it using a nearby composer control"
              };
            }
            document.dispatchEvent(new KeyboardEvent("keydown", {
              key: "Escape",
              code: "Escape",
              bubbles: true,
              cancelable: true
            }));
            await delay(80);
            target.focus?.();
          }

          return {
            ok: false,
            errorCode: "postcondition_timeout",
            errorMessage: "submit was attempted but the composer draft did not clear"
          };
        }
        return {
          submitted: false,
          draftOnly: true,
          submissionMethod: "none",
          note: "typed text only; no submit action was executed"
        };
      };

      if (action.kind === "focus") {
        element.focus();
        return finishOk("focus");
      }

      if (action.kind === "hover") {
        element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));
        element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
        return finishOk("hover");
      }

      if (action.kind === "scroll_into_view") {
        element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
        return finishOk("scroll_into_view");
      }

      if (action.kind === "expand_probe") {
        const attrs = Array.from(element.attributes).slice(0, 20).map((attr) => ({
          name: attr.name,
          value: attr.value
        }));
        return finishOk(
          "expand_probe",
          JSON.stringify({
            tagName: tag,
            role: element.getAttribute("role") || undefined,
            text: normalizeText(element.textContent || "").slice(0, 180),
            attrs
          })
        );
      }

      if (action.kind === "click") {
        element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
        if (element instanceof HTMLElement) {
          element.click();
        } else {
          element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        }
        return finishOk("click");
      }

      if (action.kind === "type" || action.kind === "clear_and_type") {
        const text = typeof action.text === "string" ? action.text : "";
        element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.focus();
          const nextValue = action.kind === "clear_and_type"
            ? text
            : String(element.value) + text;
          setNativeControlValue(element, nextValue);
          dispatchInputEvents(
            element,
            text,
            action.kind === "clear_and_type" ? "insertReplacementText" : "insertText"
          );
          const submitResult = await maybeSubmitAfterTyping(element, action);
          if (submitResult.ok === false) {
            return submitResult;
          }
          return finishOk(action.kind, submitResult.note, {
            submitted: submitResult.submitted,
            ...(submitResult.draftOnly === true ? { draftOnly: true } : {}),
            submissionMethod: submitResult.submissionMethod
          });
        }
        if (element instanceof HTMLElement && element.isContentEditable) {
          element.focus();
          if (action.kind === "clear_and_type") {
            element.textContent = text;
          } else {
            element.textContent = String(element.textContent || "") + text;
          }
          dispatchInputEvents(
            element,
            text,
            action.kind === "clear_and_type" ? "insertReplacementText" : "insertText"
          );
          const submitResult = await maybeSubmitAfterTyping(element, action);
          if (submitResult.ok === false) {
            return submitResult;
          }
          return finishOk(action.kind, submitResult.note, {
            submitted: submitResult.submitted,
            ...(submitResult.draftOnly === true ? { draftOnly: true } : {}),
            submissionMethod: submitResult.submissionMethod
          });
        }
        return {
          ok: false,
          errorCode: "not_interactable",
          errorMessage: "target does not support typing"
        };
      }

      if (action.kind === "select_option") {
        if (!(element instanceof HTMLSelectElement)) {
          return {
            ok: false,
            errorCode: "not_interactable",
            errorMessage: "target is not select"
          };
        }
        const options = Array.from(element.options);
        let selected = null;
        if (typeof action.value === "string") {
          selected = options.find((option) => option.value === action.value) || null;
        }
        if (selected === null && typeof action.text === "string") {
          const normalizedText = normalizeText(action.text);
          selected = options.find((option) => normalizeText(option.text) === normalizedText) || null;
        }
        if (selected === null && Number.isFinite(action.index)) {
          const index = Math.max(0, Math.round(Number(action.index)));
          selected = options[index] || null;
        }
        if (selected === null) {
          return {
            ok: false,
            errorCode: "node_not_found",
            errorMessage: "select option not found"
          };
        }
        element.value = selected.value;
        dispatchInputEvents(element, "", "insertReplacementText");
        return finishOk("select_option");
      }

      if (action.kind === "set_checked") {
        if (!(element instanceof HTMLInputElement) || (element.type !== "checkbox" && element.type !== "radio")) {
          return {
            ok: false,
            errorCode: "not_interactable",
            errorMessage: "target does not support checked state"
          };
        }
        element.checked = action.checked === true;
        dispatchInputEvents(element, "", "insertReplacementText");
        return finishOk("set_checked");
      }

      if (action.kind === "submit_form") {
        const form = element instanceof HTMLFormElement
          ? element
          : element instanceof HTMLElement
            ? element.closest("form")
            : null;
        if (!(form instanceof HTMLFormElement)) {
          return {
            ok: false,
            errorCode: "not_interactable",
            errorMessage: "target form not found"
          };
        }
        if (typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else {
          form.submit();
        }
        return finishOk("submit_form");
      }

      if (action.kind === "press_key") {
        const key = typeof action.key === "string" ? action.key : "";
        if (key.length === 0) {
          return {
            ok: false,
            errorCode: "invalid_request",
            errorMessage: "key is required"
          };
        }
        const target = element instanceof HTMLElement ? element : document.body;
        const shouldVerifySubmit = shouldTreatEnterAsSubmitAttempt(target, action);
        target.focus?.();
        const eventInit = {
          key,
          code: typeof action.code === "string" ? action.code : undefined,
          ctrlKey: action.ctrl === true,
          shiftKey: action.shift === true,
          altKey: action.alt === true,
          metaKey: action.meta === true,
          bubbles: true,
          cancelable: true
        };
        target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
        target.dispatchEvent(new KeyboardEvent("keypress", eventInit));
        target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
        if (shouldVerifySubmit) {
          const confirmed = await verifySubmitConfirmation(target);
          if (!confirmed) {
            return {
              ok: false,
              errorCode: "postcondition_timeout",
              errorMessage: "Enter key was pressed but the composer draft did not clear"
            };
          }
          return finishOk("press_key", "pressed Enter and confirmed submit", {
            submitted: true,
            submissionMethod: "enter"
          });
        }
        return finishOk("press_key");
      }

      return {
        ok: false,
        errorCode: "invalid_request",
        errorMessage: "unsupported action"
      };
    })()
  `;
};

const runElementAction = async ({
  browserBridge,
  tabId,
  action,
  node
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly tabId: string;
  readonly action: WorkbenchWebAction;
  readonly node: WorkbenchWebElementNode;
}): Promise<WorkbenchWebActionResult> => {
  if (action.kind === "click") {
    const point = await probeNativePointerTarget({
      browserBridge,
      tabId,
      node
    });
    await dispatchNativePointerClick({
      browserBridge,
      tabId,
      point
    });
    return {
      tabId,
      actionKind: action.kind,
      ok: true,
      execution: {
        frameTreeNodeId: node.frameTreeNodeId,
        resolvedNodeId: node.nodeId,
        resolvedSelectorAddress: node.selectorAddress,
        method: "native_click"
      }
    };
  }

  if (action.kind === "type" || action.kind === "clear_and_type") {
    try {
      const point = await probeNativePointerTarget({
        browserBridge,
        tabId,
        node
      });
      await dispatchNativePointerClick({
        browserBridge,
        tabId,
        point
      });
    } catch (_error) {
      // Keep DOM typing fallback when a pointer focus path is unavailable.
    }
  }

  const raw = await browserBridge.executeFrameScript(tabId, {
    frameTreeNodeId: node.frameTreeNodeId,
    script: buildActionScript({ action, node }),
    userGesture: true
  }) as Record<string, unknown>;

  if (raw?.ok !== true) {
    const code = typeof raw?.errorCode === "string" ? raw.errorCode : "script_execution_failed";
    const message = typeof raw?.errorMessage === "string" ? raw.errorMessage : "action execution failed";
    throw createWebAutomationError(
      code as Parameters<typeof createWebAutomationError>[0],
      message,
      "execute",
      code === "node_not_found" || code === "stale_node" || code === "postcondition_timeout",
      {
        frameTreeNodeId: node.frameTreeNodeId,
        selectorAttempts: [node.selectorAddress.path]
      }
    );
  }

  const isTypingAction = action.kind === "type" || action.kind === "clear_and_type";
  const isSubmitKeyAction = action.kind === "press_key";
  const submissionMethod = raw.submissionMethod === "click" || raw.submissionMethod === "enter" || raw.submissionMethod === "none"
    ? raw.submissionMethod
    : undefined;
  const submitted = typeof raw.submitted === "boolean"
    ? raw.submitted
    : isTypingAction
      ? false
      : undefined;
  const draftOnly = raw.draftOnly === true
    ? true
    : (isTypingAction || (isSubmitKeyAction && submissionMethod === "enter")) && submitted === false
      ? true
      : undefined;
  const note = typeof raw.note === "string" && raw.note.length > 0
    ? raw.note
    : (isTypingAction || (isSubmitKeyAction && submissionMethod === "enter")) && submitted === false
      ? "typed text only; submission was not confirmed"
      : undefined;

  return {
    tabId,
    actionKind: action.kind,
    ok: true,
    execution: {
      frameTreeNodeId: node.frameTreeNodeId,
      resolvedNodeId: node.nodeId,
      resolvedSelectorAddress: node.selectorAddress,
      method: typeof raw.method === "string" ? raw.method : action.kind
    },
    ...(note === undefined ? {} : { note }),
    ...(submitted === undefined ? {} : { submitted }),
    ...(draftOnly === true ? { draftOnly: true } : {}),
    ...(submissionMethod === undefined
      ? (isTypingAction && submitted === false ? { submissionMethod: "none" as const } : {})
      : { submissionMethod })
  };
};

export const executeWebAction = async ({
  browserBridge,
  graph,
  request
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly graph: WorkbenchWebGraphSnapshot;
  readonly request: WorkbenchWebActionRequest;
}): Promise<WorkbenchWebActionResult> => {
  const { action } = request;
  const tabId = graph.tabId;

  if (action.kind === "goto_url") {
    const address = action.address.trim();
    if (address.length === 0) {
      throw createWebAutomationError("invalid_request", "address is required", "precondition", false);
    }
    const navigation = await browserBridge.navigate({
      tabId,
      address
    });
    return {
      tabId,
      graphId: graph.graphId,
      actionKind: action.kind,
      ok: true,
      note: `navigated to ${navigation.address}`
    };
  }

  if (action.kind === "history_back") {
    browserBridge.goBack(tabId);
    return {
      tabId,
      graphId: graph.graphId,
      actionKind: action.kind,
      ok: true
    };
  }

  if (action.kind === "history_forward") {
    browserBridge.goForward(tabId);
    return {
      tabId,
      graphId: graph.graphId,
      actionKind: action.kind,
      ok: true
    };
  }

  if (action.kind === "reload") {
    browserBridge.reload(tabId);
    return {
      tabId,
      graphId: graph.graphId,
      actionKind: action.kind,
      ok: true
    };
  }

  let resolved: ResolvedTarget;
  try {
    resolved = resolveTarget({ graph, action });
  } catch (error) {
    if (AUTO_TARGET_ACTION_KINDS.has(action.kind)) {
      const autoTarget = findAutoTargetNode(graph, action);
      if (autoTarget !== null) {
        resolved = {
          node: autoTarget,
          by: "auto",
        };
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }
  if (AUTO_TARGET_ACTION_KINDS.has(action.kind) && isWeakResolvedNodeForAction(resolved.node, action)) {
    const autoTarget = findAutoTargetNode(graph, action);
    if (autoTarget !== null && autoTarget.nodeId !== resolved.node.nodeId) {
      resolved = {
        node: autoTarget,
        by: "auto",
      };
    }
  }

  if (action.kind === "open_link_node") {
    const href = typeof resolved.node.href === "string" && resolved.node.href.length > 0
      ? resolved.node.href
      : null;
    if (href === null) {
      throw createWebAutomationError(
        "not_interactable",
        "target node has no href",
        "precondition",
        false,
        {
          frameTreeNodeId: resolved.node.frameTreeNodeId,
          selectorAttempts: [resolved.node.selectorAddress.path]
        }
      );
    }
    const navigation = await browserBridge.navigate({
      tabId,
      address: href
    });
    return {
      tabId,
      graphId: graph.graphId,
      actionKind: action.kind,
      ok: true,
      execution: {
        frameTreeNodeId: resolved.node.frameTreeNodeId,
        resolvedNodeId: resolved.node.nodeId,
        resolvedSelectorAddress: resolved.node.selectorAddress,
        method: resolved.by === "signature" ? "open_link(signature)" : "open_link"
      },
      note: `navigated to ${navigation.address}`
    };
  }

  const result = await runElementAction({
    browserBridge,
    tabId,
    action,
    node: resolved.node
  });
  return {
    ...result,
    graphId: graph.graphId,
    ...(resolved.by === "signature" || resolved.by === "auto" || resolved.by === "css_selector"
      ? {
          note: [
            result.note,
            resolved.by === "signature"
              ? "resolved by signature fallback"
              : resolved.by === "css_selector"
                ? "resolved by css selector hint"
                : "resolved by auto-target fallback",
          ].filter(Boolean).join("; "),
        }
      : {})
  };
};

const buildProbeScript = (node: WorkbenchWebElementNode, expectedState: "present" | "visible" | "hidden"): string => {
  const payload = JSON.stringify({
    node,
    expectedState
  });
  return `
    (() => {
      ${selectorAddressResolverSource}
      const payload = ${payload};
      const element = __lyraResolveSelectorAddress(payload.node.selectorAddress.path);
      if (!(element instanceof Element)) {
        return {
          ok: payload.expectedState === "hidden",
          present: false,
          visible: false
        };
      }
      const styles = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const visible = !(
        styles.display === "none"
        || styles.visibility === "hidden"
        || Number(styles.opacity || "1") === 0
        || rect.width <= 0
        || rect.height <= 0
      );
      const ok = payload.expectedState === "present"
        ? true
        : payload.expectedState === "visible"
          ? visible
          : !visible;
      return {
        ok,
        present: true,
        visible
      };
    })()
  `;
};

export const waitForTarget = async ({
  browserBridge,
  graph,
  request
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly graph: WorkbenchWebGraphSnapshot;
  readonly request: WorkbenchWebWaitRequest;
}): Promise<WorkbenchWebWaitResult> => {
  const tabId = graph.tabId;
  const expectedState = request.state ?? "present";
  const timeoutMs = Math.max(100, Math.min(30_000, Math.round(request.timeoutMs ?? 3_000)));
  const pollIntervalMs = Math.max(30, Math.min(2_000, Math.round(request.pollIntervalMs ?? 120)));

  const targetNode = (() => {
    if (typeof request.target.nodeId === "string" && request.target.nodeId.trim().length > 0) {
      const node = graph.nodes.find((entry) => entry.nodeId === request.target.nodeId!.trim());
      if (node !== undefined) {
        return node;
      }
    }
    const normalizedAddress = normalizeSelectorAddress(request.target.selectorAddress);
    if (normalizedAddress !== null) {
      const node = graph.nodes.find((entry) =>
        entry.selectorAddress.frameTreeNodeId === normalizedAddress.frameTreeNodeId
        && entry.selectorAddress.path === normalizedAddress.path
      );
      if (node !== undefined) {
        return node;
      }
    }
    if (typeof request.target.cssSelector === "string" && request.target.cssSelector.trim().length > 0) {
      const byCss = findNodeByCssSelectorHint(graph.nodes, request.target.cssSelector.trim());
      if (byCss !== null) {
        return byCss;
      }
    }
    if (request.target.stableSignature !== undefined) {
      const bySignature = findBestSignatureMatch(graph.nodes, request.target.stableSignature);
      if (bySignature !== null) {
        return bySignature;
      }
    }
    return null;
  })();

  if (targetNode === null) {
    throw createWebAutomationError(
      "node_not_found",
      "unable to resolve wait target",
      "resolve_node",
      true,
      {
        candidateCount: graph.nodes.length
      }
    );
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const raw = await browserBridge.executeFrameScript(tabId, {
        frameTreeNodeId: targetNode.frameTreeNodeId,
        script: buildProbeScript(targetNode, expectedState),
        userGesture: false
      }) as { readonly ok?: unknown };

      if (raw?.ok === true) {
        return {
          tabId,
          graphId: graph.graphId,
          state: expectedState,
          satisfied: true,
          elapsedMs: Date.now() - startedAt,
          execution: {
            frameTreeNodeId: targetNode.frameTreeNodeId,
            resolvedNodeId: targetNode.nodeId,
            resolvedSelectorAddress: targetNode.selectorAddress,
            method: "wait"
          }
        };
      }
    } catch {
      // keep polling until timeout
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw createWebAutomationError(
    "postcondition_timeout",
    `wait target ${expectedState} timed out`,
    "wait_postcondition",
    true,
    {
      frameTreeNodeId: targetNode.frameTreeNodeId,
      selectorAttempts: [targetNode.selectorAddress.path],
      timeoutMs
    }
  );
};
