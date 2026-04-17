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
import {
  captureWebActionVerificationSnapshot,
  verifyWebActionOutcome,
} from "./verification";

type ResolvedTarget = {
  readonly node: WorkbenchWebElementNode;
  readonly by: "node_id" | "selector_address" | "signature" | "css_selector" | "target_hint" | "indexed_hint" | "auto";
};

type NativePointerProbeResult = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type WorkbenchWebPointerState = {
  readonly x: number;
  readonly y: number;
};

type SemanticTargetHints = {
  readonly id?: string;
  readonly name?: string;
  readonly ariaLabel?: string;
  readonly tagName?: string;
  readonly role?: string;
  readonly text?: string;
  readonly label?: string;
  readonly textContains?: string;
  readonly textSnippet?: string;
  readonly placeholder?: string;
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

const VERIFIED_ACTION_KINDS = new Set<WorkbenchWebAction["kind"]>([
  "focus",
  "hover",
  "click",
  "type",
  "clear_and_type",
  "select_option",
  "set_checked",
  "submit_form",
  "press_key"
]);
const NATIVE_POINTER_PROBE_TIMEOUT_MS = 1_800;

const normalizeText = (value: string | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const hasMeaningfulSemanticToken = (value: string): boolean =>
  /[a-z0-9\u4e00-\u9fff]/i.test(value);

const readTargetString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const readTargetTextHint = (value: unknown): string | undefined => {
  const raw = readTargetString(value);
  if (raw === undefined) {
    return undefined;
  }
  return hasMeaningfulSemanticToken(normalizeText(raw)) ? raw : undefined;
};

const BROAD_SEMANTIC_ROLES = new Set([
  "button",
  "link",
  "listitem",
  "list-item",
  "list",
  "navigation",
  "generic",
  "region"
]);

const hasAnySemanticTextOrIdentityHint = (target: SemanticTargetHints): boolean =>
  target.id !== undefined
  || target.name !== undefined
  || target.ariaLabel !== undefined
  || target.text !== undefined
  || target.label !== undefined
  || target.textContains !== undefined
  || target.textSnippet !== undefined
  || target.placeholder !== undefined;

const hasUsableSemanticTargetHint = ({
  target,
  actionKind,
  indexHint
}: {
  readonly target: SemanticTargetHints;
  readonly actionKind: WorkbenchWebAction["kind"];
  readonly indexHint: number | undefined;
}): boolean => {
  if (indexHint !== undefined) {
    return true;
  }
  if (hasAnySemanticTextOrIdentityHint(target)) {
    return true;
  }
  const role = normalizeText(target.role);
  if (role.length > 0 && !BROAD_SEMANTIC_ROLES.has(role)) {
    return true;
  }
  if (actionKind === "type" || actionKind === "clear_and_type" || actionKind === "focus" || actionKind === "press_key") {
    return role === "textbox" || role === "searchbox" || role === "combobox";
  }
  return false;
};

const extractSemanticTargetHints = (
  target: Record<string, unknown>
): SemanticTargetHints => {
  const id = readTargetString(target.id);
  const name = readTargetString(target.name);
  const ariaLabel = readTargetTextHint(target.ariaLabel);
  const tagName = readTargetString(target.tagName);
  const role = readTargetString(target.role);
  const text = readTargetTextHint(target.text);
  const label = readTargetTextHint(target.label);
  const textContains = readTargetTextHint(target.textContains);
  const textSnippet = readTargetTextHint(target.textSnippet);
  const placeholder = readTargetTextHint(target.placeholder);
  return {
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
    ...(ariaLabel === undefined ? {} : { ariaLabel }),
    ...(tagName === undefined ? {} : { tagName }),
    ...(role === undefined ? {} : { role }),
    ...(text === undefined ? {} : { text }),
    ...(label === undefined ? {} : { label }),
    ...(textContains === undefined ? {} : { textContains }),
    ...(textSnippet === undefined ? {} : { textSnippet }),
    ...(placeholder === undefined ? {} : { placeholder })
  };
};

const isDisallowedNavigationAddress = (address: string): boolean => {
  const normalized = address.trim().toLowerCase();
  return normalized.startsWith("javascript:")
    || normalized.startsWith("data:")
    || normalized.startsWith("vbscript:");
};

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

const isLooseAutoSelector = (selector: string): boolean => {
  const normalized = selector.trim().toLowerCase();
  return normalized === ""
    || normalized === "*"
    || normalized === "body"
    || normalized === "html"
    || normalized === "document";
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

const semanticHintScoreForNode = ({
  node,
  target
}: {
  readonly node: WorkbenchWebElementNode;
  readonly target: SemanticTargetHints;
}): number => {
  let score = 0;
  let hasSignal = false;

  const scoreField = ({
    nodeValue,
    targetValue,
    exactWeight,
    fuzzyWeight = 0
  }: {
    readonly nodeValue: string | undefined;
    readonly targetValue: string | undefined;
    readonly exactWeight: number;
    readonly fuzzyWeight?: number;
  }) => {
    const left = normalizeText(nodeValue);
    const right = normalizeText(targetValue);
    if (right.length === 0) {
      return;
    }
    hasSignal = true;
    if (left.length === 0) {
      score -= Math.round(exactWeight * 0.6);
      return;
    }
    if (left === right) {
      score += exactWeight;
      return;
    }
    if (left.includes(right) || right.includes(left)) {
      score += fuzzyWeight;
      return;
    }
    score -= Math.round(exactWeight * 0.5);
  };

  scoreField({
    nodeValue: node.stableSignature.id,
    targetValue: target.id,
    exactWeight: 42,
    fuzzyWeight: 18
  });
  scoreField({
    nodeValue: node.stableSignature.name,
    targetValue: target.name,
    exactWeight: 28,
    fuzzyWeight: 12
  });
  scoreField({
    nodeValue: node.stableSignature.ariaLabel ?? node.textSnippet,
    targetValue: target.ariaLabel,
    exactWeight: 28,
    fuzzyWeight: 12
  });
  scoreField({
    nodeValue: node.tagName,
    targetValue: target.tagName,
    exactWeight: 14,
    fuzzyWeight: 6
  });
  scoreField({
    nodeValue: node.role,
    targetValue: target.role,
    exactWeight: 18,
    fuzzyWeight: 8
  });

  const textNeedle = normalizeText(
    target.textContains
    ?? target.textSnippet
    ?? target.text
    ?? target.label
    ?? target.placeholder
  );
  if (textNeedle.length > 0) {
    hasSignal = true;
    const textHaystack = [
      normalizeText(node.textSnippet),
      normalizeText(node.stableSignature.ariaLabel),
      normalizeText(node.stableSignature.name)
    ].filter((value) => value.length > 0);
    if (textHaystack.some((value) => value.includes(textNeedle) || textNeedle.includes(value))) {
      score += 14;
    } else {
      score -= 10;
    }
  }

  if (!hasSignal) {
    return Number.NEGATIVE_INFINITY;
  }
  if (node.visibilityState === "visible") {
    score += 4;
  }
  if (node.interactable.clickable || node.interactable.focusable || node.interactable.typable) {
    score += 4;
  }
  return score;
};

const findNodeBySemanticTargetHints = (
  nodes: readonly WorkbenchWebElementNode[],
  target: SemanticTargetHints
): WorkbenchWebElementNode | null => {
  let best: WorkbenchWebElementNode | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const score = semanticHintScoreForNode({ node, target });
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return bestScore >= 18 ? best : null;
};

const nodeSupportsActionKind = (
  node: WorkbenchWebElementNode,
  actionKind: WorkbenchWebAction["kind"]
): boolean => {
  switch (actionKind) {
    case "type":
    case "clear_and_type":
      return node.interactable.typable;
    case "focus":
    case "press_key":
      return node.interactable.focusable || node.interactable.typable;
    case "select_option":
      return node.interactable.selectable || normalizeText(node.tagName) === "select";
    case "set_checked": {
      const normalizedTag = normalizeText(node.tagName);
      const normalizedType = normalizeText(node.inputType);
      return normalizedTag === "input" && (normalizedType === "checkbox" || normalizedType === "radio");
    }
    case "submit_form":
      return normalizeText(node.tagName) === "form" || node.interactable.clickable;
    case "scroll_into_view":
    case "expand_probe":
      return true;
    case "click":
    case "hover":
    case "open_link_node":
      return node.interactable.clickable || node.interactable.focusable;
    case "goto_url":
    case "history_back":
    case "history_forward":
    case "reload":
      return false;
    default:
      return true;
  }
};

const compareRankedNodes = (
  left: { readonly node: WorkbenchWebElementNode; readonly score: number },
  right: { readonly node: WorkbenchWebElementNode; readonly score: number }
): number => {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  const leftVisibility = scoreVisibility(left.node.visibilityState);
  const rightVisibility = scoreVisibility(right.node.visibilityState);
  if (rightVisibility !== leftVisibility) {
    return rightVisibility - leftVisibility;
  }
  const leftInteractable =
    Number(left.node.interactable.clickable)
    + Number(left.node.interactable.focusable)
    + Number(left.node.interactable.typable)
    + Number(left.node.interactable.selectable);
  const rightInteractable =
    Number(right.node.interactable.clickable)
    + Number(right.node.interactable.focusable)
    + Number(right.node.interactable.typable)
    + Number(right.node.interactable.selectable);
  if (rightInteractable !== leftInteractable) {
    return rightInteractable - leftInteractable;
  }
  if (left.node.bounds.y !== right.node.bounds.y) {
    return left.node.bounds.y - right.node.bounds.y;
  }
  if (left.node.bounds.x !== right.node.bounds.x) {
    return left.node.bounds.x - right.node.bounds.x;
  }
  return left.node.nodeId.localeCompare(right.node.nodeId);
};

const rankNodesBySemanticTargetHints = ({
  nodes,
  target,
  actionKind
}: {
  readonly nodes: readonly WorkbenchWebElementNode[];
  readonly target: SemanticTargetHints;
  readonly actionKind: WorkbenchWebAction["kind"];
}): readonly WorkbenchWebElementNode[] =>
  nodes
    .filter((node) => nodeSupportsActionKind(node, actionKind))
    .map((node) => ({ node, score: semanticHintScoreForNode({ node, target }) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort(compareRankedNodes)
    .map((entry) => entry.node);

const resolveNodeByIndexedTargetHint = ({
  nodes,
  target,
  actionKind,
  index
}: {
  readonly nodes: readonly WorkbenchWebElementNode[];
  readonly target: SemanticTargetHints;
  readonly actionKind: WorkbenchWebAction["kind"];
  readonly index: number;
}): WorkbenchWebElementNode | null => {
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }
  const rankedNodes = rankNodesBySemanticTargetHints({
    nodes,
    target,
    actionKind
  });
  return rankedNodes[index] ?? null;
};

const toStableSignatureOrUndefined = (
  value: unknown
): WorkbenchWebElementNode["stableSignature"] | undefined => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const maybe = value as Record<string, unknown>;
  if (typeof maybe.tagName !== "string" || maybe.tagName.trim().length === 0) {
    return undefined;
  }
  return maybe as WorkbenchWebElementNode["stableSignature"];
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
    readonly candidateId?: unknown;
    readonly nodeId?: unknown;
    readonly index?: unknown;
    readonly nodeRef?: unknown;
    readonly cssSelector?: unknown;
    readonly selectorAddress?: unknown;
    readonly stableSignature?: unknown;
    readonly id?: unknown;
    readonly name?: unknown;
    readonly ariaLabel?: unknown;
    readonly tagName?: unknown;
    readonly role?: unknown;
    readonly text?: unknown;
    readonly label?: unknown;
    readonly textContains?: unknown;
    readonly textSnippet?: unknown;
    readonly placeholder?: unknown;
  };
  const nodeRef =
    target.nodeRef !== null && typeof target.nodeRef === "object" && !Array.isArray(target.nodeRef)
      ? target.nodeRef as Record<string, unknown>
      : undefined;

  const candidateId = typeof target.candidateId === "string" ? target.candidateId : undefined;
  const nodeId = typeof target.nodeId === "string" ? target.nodeId : undefined;
  const nodeRefId =
    typeof nodeRef?.nodeId === "string" && nodeRef.nodeId.trim().length > 0
      ? nodeRef.nodeId.trim()
      : undefined;
  const indexHint =
    typeof target.index === "number" && Number.isFinite(target.index)
      ? Math.max(0, Math.round(target.index))
      : undefined;
  const directNodeId = candidateId ?? nodeId ?? nodeRefId;
  if (typeof directNodeId === "string" && directNodeId.trim().length > 0) {
    const node = graph.nodes.find((entry) => entry.nodeId === directNodeId.trim());
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
  const cssSelectorHintNode =
    cssSelector === undefined ? null : findNodeByCssSelectorHint(graph.nodes, cssSelector);
  if (cssSelector !== undefined) {
    if (cssSelectorHintNode !== null) {
      return { node: cssSelectorHintNode, by: "css_selector" };
    }
  }

  const nodeRefStableFingerprint = toStableSignatureOrUndefined(nodeRef?.stableFingerprint);
  const stableSignatureSource =
    toStableSignatureOrUndefined(target.stableSignature)
    ?? nodeRefStableFingerprint;

  if (stableSignatureSource !== undefined) {
    const node = findBestSignatureMatch(
      graph.nodes,
      stableSignatureSource
    );
    if (node !== null) {
      return { node, by: "signature" };
    }
  }

  const hasExplicitStructuredTarget =
    candidateId !== undefined
    || nodeId !== undefined
    || indexHint !== undefined
    || nodeRefId !== undefined
    || selectorAddress !== null
    || stableSignatureSource !== undefined;
  const semanticTargetHints = extractSemanticTargetHints(target);
  if (
    !hasExplicitStructuredTarget
    && !hasUsableSemanticTargetHint({
      target: semanticTargetHints,
      actionKind: action.kind,
      indexHint
    })
  ) {
    throw createWebAutomationError(
      "invalid_request",
      "target constraints are too broad; provide nodeRef/candidateId or text/name/aria hints",
      "precondition",
      true,
      {
        details: {
          actionKind: action.kind
        }
      }
    );
  }
  if (indexHint !== undefined) {
    const indexedTargetNode = resolveNodeByIndexedTargetHint({
      nodes: graph.nodes,
      target: semanticTargetHints,
      actionKind: action.kind,
      index: indexHint
    });
    if (indexedTargetNode !== null) {
      return { node: indexedTargetNode, by: "indexed_hint" };
    }
  }

  const semanticTargetNode = findNodeBySemanticTargetHints(graph.nodes, semanticTargetHints);
  if (semanticTargetNode !== null) {
    return { node: semanticTargetNode, by: "target_hint" };
  }
  const canAutoResolve =
    AUTO_TARGET_ACTION_KINDS.has(action.kind)
    && !hasExplicitStructuredTarget
    && (cssSelector === undefined || isLooseAutoSelector(cssSelector) || cssSelectorHintNode === null);

  if (canAutoResolve) {
    const node = findAutoTargetNode(graph, action);
    if (node !== null) {
      return { node, by: "auto" };
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
          // Bounds proximity boost: element near expected position gets extra confidence
          if (boundsHint && typeof boundsHint.x === "number" && score >= 4) {
            const rect = element.getBoundingClientRect();
            const dx = Math.abs(rect.left + rect.width / 2 - (boundsHint.x + boundsHint.width / 2));
            const dy = Math.abs(rect.top + rect.height / 2 - (boundsHint.y + boundsHint.height / 2));
            if (dx < 80 && dy < 80) score += 2;
          }

          if (score > bestScore) {
            best = element;
            bestScore = score;
          }
        }
        return bestScore >= 6 ? best : null;
      };

      const toTopClientPoint = (x, y) => {
        let nextX = x;
        let nextY = y;
        let currentWindow = window;
        try {
          while (currentWindow !== currentWindow.top) {
            const frameElement = currentWindow.frameElement;
            if (!(frameElement instanceof Element)) {
              // Cross-origin — frameElement is null. Return local coords for
              // the Electron main process to translate via resolveFrameGlobalBounds.
              return { x: Math.round(x), y: Math.round(y), isLocalCoordinate: true };
            }
            const frameRect = frameElement.getBoundingClientRect();
            nextX += frameRect.left;
            nextY += frameRect.top;
            currentWindow = currentWindow.parent;
          }
          return { x: Math.round(nextX), y: Math.round(nextY), isLocalCoordinate: false };
        } catch {
          // Cross-origin access blocked — return local coords with flag.
          return { x: Math.round(x), y: Math.round(y), isLocalCoordinate: true };
        }
      };

      const targetAddress = payload?.node?.selectorAddress;
      let element = __lyraResolveSelectorAddress(targetAddress?.path || "");
      if (!(element instanceof Element)) {
        element = resolveBySignature(payload?.node?.stableSignature, payload?.node?.bounds);
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

      return {
        ok: true,
        x: globalPoint.x,
        y: globalPoint.y,
        width: Math.round(rectB.width),
        height: Math.round(rectB.height),
        isLocalCoordinate: globalPoint.isLocalCoordinate === true
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
  let raw: Record<string, unknown>;
  try {
    raw = await browserBridge.executeFrameScript(tabId, {
      frameTreeNodeId: node.frameTreeNodeId,
      script: buildNativePointerProbeScript(node),
      userGesture: true,
      timeoutMs: NATIVE_POINTER_PROBE_TIMEOUT_MS
    }) as Record<string, unknown>;
  } catch (error) {
    const message =
      error instanceof Error && typeof error.message === "string" && error.message.trim().length > 0
        ? error.message
        : "failed to evaluate pointer probe script";
    throw createWebAutomationError(
      "script_execution_failed",
      message,
      "precondition",
      true,
      {
        frameTreeNodeId: node.frameTreeNodeId,
        selectorAttempts: [node.selectorAddress.path]
      }
    );
  }

  if (raw?.ok !== true) {
    const code = typeof raw?.errorCode === "string" ? raw.errorCode : "script_execution_failed";
    const message = typeof raw?.errorMessage === "string"
      ? raw.errorMessage
      : "failed to prepare native input target";
    throw createWebAutomationError(
      code as Parameters<typeof createWebAutomationError>[0],
      message,
      "precondition",
      true,
      {
        frameTreeNodeId: node.frameTreeNodeId,
        selectorAttempts: [node.selectorAddress.path],
        ...(raw?.details && typeof raw.details === "object"
          ? { details: raw.details as Record<string, unknown> }
          : {})
      }
    );
  }

  let probeX = Number(raw.x ?? 0);
  let probeY = Number(raw.y ?? 0);

  // When the probe script runs inside a cross-origin iframe, it cannot access
  // window.top to translate coordinates. Use Electron's main-process privilege
  // to resolve the frame's global position and translate manually.
  if (raw.isLocalCoordinate === true) {
    const frameBounds = await browserBridge.resolveFrameGlobalBounds(tabId, node.frameTreeNodeId);
    if (frameBounds !== null) {
      probeX += frameBounds.x;
      probeY += frameBounds.y;
    } else {
      throw createWebAutomationError(
        "cross_origin_frame_blocked",
        "unable to resolve frame global bounds for cross-origin iframe",
        "precondition",
        true,
        {
          frameTreeNodeId: node.frameTreeNodeId,
          selectorAttempts: [node.selectorAddress.path]
        }
      );
    }
  }

  return {
    x: probeX,
    y: probeY,
    width: Number(raw.width ?? 0),
    height: Number(raw.height ?? 0)
  };
};

// --- Humanized pointer click with Bézier curve trajectory ---

const randomInRange = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const cubicBezier = (
  t: number,
  p0: number,
  p1: number,
  p2: number,
  p3: number
): number =>
  Math.pow(1 - t, 3) * p0
  + 3 * Math.pow(1 - t, 2) * t * p1
  + 3 * (1 - t) * Math.pow(t, 2) * p2
  + Math.pow(t, 3) * p3;

const generateMousePath = (
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): readonly { readonly x: number; readonly y: number }[] => {
  const steps = randomInRange(6, 14);
  const path: { x: number; y: number }[] = [];

  // Randomized control points for a natural-looking cubic Bézier curve.
  const dx = toX - fromX;
  const dy = toY - fromY;
  const cp1x = fromX + dx * (0.2 + Math.random() * 0.2);
  const cp1y = fromY + dy * (0.0 + Math.random() * 0.4) + (Math.random() - 0.5) * 40;
  const cp2x = fromX + dx * (0.6 + Math.random() * 0.2);
  const cp2y = fromY + dy * (0.6 + Math.random() * 0.4) + (Math.random() - 0.5) * 30;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(cubicBezier(t, fromX, cp1x, cp2x, toX));
    const y = Math.round(cubicBezier(t, fromY, cp1y, cp2y, toY));
    path.push({ x, y });
  }

  // Add micro-jitter near the target (±2px).
  const last = path[path.length - 1];
  if (last !== undefined) {
    last.x = toX + randomInRange(-2, 2);
    last.y = toY + randomInRange(-2, 2);
  }

  return path;
};

const dispatchHumanizedPointerClick = async ({
  browserBridge,
  tabId,
  point,
  pointerState
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly tabId: string;
  readonly point: NativePointerProbeResult;
  readonly pointerState?: WorkbenchWebPointerState;
}): Promise<void> => {
  const fromX = Math.round(pointerState?.x ?? point.x);
  const fromY = Math.round(pointerState?.y ?? point.y);
  const path = generateMousePath(fromX, fromY, point.x, point.y);

  // 1. Generate mouse movement trajectory along the Bézier path.
  const moveEvents: Parameters<WorkbenchBrowserIpcBridge["dispatchNativeInput"]>[1] = path.map((step) => ({
    type: "mouseMove" as const,
    x: step.x,
    y: step.y,
    delayMs: randomInRange(8, 22)
  }));

  // 2. Click with randomized hold duration.
  const holdDurationMs = randomInRange(65, 135);
  const clickEvents: Parameters<WorkbenchBrowserIpcBridge["dispatchNativeInput"]>[1] = [
    {
      type: "mouseDown",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
      delayMs: randomInRange(12, 28)
    },
    {
      type: "mouseUp",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
      delayMs: holdDurationMs
    }
  ];

  await browserBridge.dispatchNativeInput(tabId, [...moveEvents, ...clickEvents]);

};

const dispatchHumanizedPointerHover = async ({
  browserBridge,
  tabId,
  point,
  pointerState
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly tabId: string;
  readonly point: NativePointerProbeResult;
  readonly pointerState?: WorkbenchWebPointerState;
}): Promise<void> => {
  const fromX = Math.round(pointerState?.x ?? point.x);
  const fromY = Math.round(pointerState?.y ?? point.y);
  const path = generateMousePath(fromX, fromY, point.x, point.y);
  const moveEvents: Parameters<WorkbenchBrowserIpcBridge["dispatchNativeInput"]>[1] = [
    ...path.map((step) => ({
      type: "mouseMove" as const,
      x: step.x,
      y: step.y,
      delayMs: randomInRange(8, 22)
    })),
    {
      type: "mouseMove" as const,
      x: point.x,
      y: point.y,
      delayMs: randomInRange(90, 160)
    }
  ];

  await browserBridge.dispatchNativeInput(tabId, moveEvents);
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
          // Bounds proximity boost
          if (boundsHint && typeof boundsHint.x === "number" && score >= 4) {
            const rect = element.getBoundingClientRect();
            const dx = Math.abs(rect.left + rect.width / 2 - (boundsHint.x + boundsHint.width / 2));
            const dy = Math.abs(rect.top + rect.height / 2 - (boundsHint.y + boundsHint.height / 2));
            if (dx < 80 && dy < 80) score += 2;
          }

          if (score > bestScore) {
            best = element;
            bestScore = score;
          }
        }
        return bestScore >= 6 ? best : null;
      };

      const targetAddress = payload?.node?.selectorAddress;
      let element = __lyraResolveSelectorAddress(targetAddress?.path || "");
      let resolvedBy = "address";
      if (!(element instanceof Element)) {
        element = resolveBySignature(payload?.node?.stableSignature, payload?.node?.bounds);
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
  node,
  pointerState
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly tabId: string;
  readonly action: WorkbenchWebAction;
  readonly node: WorkbenchWebElementNode;
  readonly pointerState?: WorkbenchWebPointerState;
}): Promise<WorkbenchWebActionResult> => {
  if (action.kind === "click") {
    try {
      const point = await probeNativePointerTarget({
        browserBridge,
        tabId,
        node
      });
      await dispatchHumanizedPointerClick({
        browserBridge,
        tabId,
        point,
        ...(pointerState === undefined ? {} : { pointerState })
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
    } catch (_error) {
      // Keep DOM click fallback when native pointer probing is unavailable.
    }
  }

  if (action.kind === "hover") {
    try {
      const point = await probeNativePointerTarget({
        browserBridge,
        tabId,
        node
      });
      await dispatchHumanizedPointerHover({
        browserBridge,
        tabId,
        point,
        ...(pointerState === undefined ? {} : { pointerState })
      });
      return {
        tabId,
        actionKind: action.kind,
        ok: true,
        execution: {
          frameTreeNodeId: node.frameTreeNodeId,
          resolvedNodeId: node.nodeId,
          resolvedSelectorAddress: node.selectorAddress,
          method: "native_hover"
        }
      };
    } catch (_error) {
      // Keep DOM hover fallback when native pointer movement is unavailable.
    }
  }

  if (action.kind === "type" || action.kind === "clear_and_type") {
    try {
      const point = await probeNativePointerTarget({
        browserBridge,
        tabId,
        node
      });
      await dispatchHumanizedPointerClick({
        browserBridge,
        tabId,
        point,
        ...(pointerState === undefined ? {} : { pointerState })
      });
    } catch (_error) {
      // Keep DOM typing fallback when a pointer focus path is unavailable.
    }
  }

  let raw: Record<string, unknown>;
  try {
    raw = await browserBridge.executeFrameScript(tabId, {
      frameTreeNodeId: node.frameTreeNodeId,
      script: buildActionScript({ action, node }),
      userGesture: true,
      timeoutMs: 8_000
    }) as Record<string, unknown>;
  } catch (error) {
    const message =
      error instanceof Error && typeof error.message === "string" && error.message.trim().length > 0
        ? error.message
        : "action script execution failed";
    throw createWebAutomationError(
      "script_execution_failed",
      message,
      "execute",
      true,
      {
        frameTreeNodeId: node.frameTreeNodeId,
        selectorAttempts: [node.selectorAddress.path]
      }
    );
  }

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
  request,
  pointerState
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
  readonly graph: WorkbenchWebGraphSnapshot;
  readonly request: WorkbenchWebActionRequest;
  readonly pointerState?: WorkbenchWebPointerState;
}): Promise<WorkbenchWebActionResult> => {
  const { action } = request;
  const tabId = graph.tabId;

  if (action.kind === "goto_url") {
    const address = action.address.trim();
    if (address.length === 0) {
      throw createWebAutomationError("invalid_request", "address is required", "precondition", false);
    }
    if (isDisallowedNavigationAddress(address)) {
      throw createWebAutomationError(
        "action_blocked_by_policy",
        "javascript/data pseudo-navigation is not allowed for browser automation",
        "precondition",
        false
      );
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

  const verificationBefore = VERIFIED_ACTION_KINDS.has(action.kind)
    ? await captureWebActionVerificationSnapshot({
        browserBridge,
        tabId,
        node: resolved.node
      })
    : null;

  const result = await runElementAction({
    browserBridge,
    tabId,
    action,
    node: resolved.node,
    ...(pointerState === undefined ? {} : { pointerState })
  });

  if (VERIFIED_ACTION_KINDS.has(action.kind)) {
    const verified = await verifyWebActionOutcome({
      browserBridge,
      tabId,
      node: resolved.node,
      action,
      result,
      before: verificationBefore ?? await captureWebActionVerificationSnapshot({
        browserBridge,
        tabId,
        node: resolved.node
      })
    });
    return {
      ...verified,
      graphId: graph.graphId,
      ...(resolved.by === "signature" || resolved.by === "auto" || resolved.by === "css_selector" || resolved.by === "target_hint" || resolved.by === "indexed_hint"
        ? {
            note: [
              verified.note,
              resolved.by === "signature"
                ? "resolved by signature fallback"
                : resolved.by === "css_selector"
                  ? "resolved by css selector hint"
                  : resolved.by === "target_hint"
                    ? "resolved by semantic target hints"
                  : resolved.by === "indexed_hint"
                    ? "resolved by indexed semantic hint"
                  : "resolved by auto-target fallback",
            ].filter(Boolean).join("; "),
          }
        : {})
    };
  }

  return {
    ...result,
    graphId: graph.graphId,
    ...(resolved.by === "signature" || resolved.by === "auto" || resolved.by === "css_selector" || resolved.by === "target_hint" || resolved.by === "indexed_hint"
      ? {
          note: [
            result.note,
            resolved.by === "signature"
              ? "resolved by signature fallback"
              : resolved.by === "css_selector"
                ? "resolved by css selector hint"
                : resolved.by === "target_hint"
                  ? "resolved by semantic target hints"
                : resolved.by === "indexed_hint"
                  ? "resolved by indexed semantic hint"
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
    const target = request.target as Record<string, unknown>;
    const nodeRef =
      target.nodeRef !== null && typeof target.nodeRef === "object" && !Array.isArray(target.nodeRef)
        ? target.nodeRef as Record<string, unknown>
        : undefined;
    const directNodeId =
      typeof target.candidateId === "string" && target.candidateId.trim().length > 0
        ? target.candidateId.trim()
        : typeof target.nodeId === "string" && target.nodeId.trim().length > 0
          ? target.nodeId.trim()
          : typeof nodeRef?.nodeId === "string" && nodeRef.nodeId.trim().length > 0
            ? nodeRef.nodeId.trim()
            : undefined;
    const indexHint =
      typeof target.index === "number" && Number.isFinite(target.index)
        ? Math.max(0, Math.round(target.index))
        : undefined;
    if (directNodeId !== undefined) {
      const node = graph.nodes.find((entry) => entry.nodeId === directNodeId);
      if (node !== undefined) {
        return node;
      }
    }

    const normalizedAddress = normalizeSelectorAddress(
      target.selectorAddress as Parameters<typeof normalizeSelectorAddress>[0]
    );
    if (normalizedAddress !== null) {
      const node = graph.nodes.find((entry) =>
        entry.selectorAddress.frameTreeNodeId === normalizedAddress.frameTreeNodeId
        && entry.selectorAddress.path === normalizedAddress.path
      );
      if (node !== undefined) {
        return node;
      }
    }
    if (typeof target.cssSelector === "string" && target.cssSelector.trim().length > 0) {
      const byCss = findNodeByCssSelectorHint(graph.nodes, target.cssSelector.trim());
      if (byCss !== null) {
        return byCss;
      }
    }

    const stableSignatureSource =
      toStableSignatureOrUndefined(target.stableSignature)
      ?? toStableSignatureOrUndefined(nodeRef?.stableFingerprint);
    if (stableSignatureSource !== undefined) {
      const bySignature = findBestSignatureMatch(graph.nodes, stableSignatureSource);
      if (bySignature !== null) {
        return bySignature;
      }
    }

    const semanticTargetHints = extractSemanticTargetHints(target);
    if (indexHint !== undefined) {
      const byIndexedTarget = resolveNodeByIndexedTargetHint({
        nodes: graph.nodes,
        target: semanticTargetHints,
        actionKind: "focus",
        index: indexHint
      });
      if (byIndexedTarget !== null) {
        return byIndexedTarget;
      }
    }
    const bySemanticTarget = findNodeBySemanticTargetHints(graph.nodes, semanticTargetHints);
    if (bySemanticTarget !== null) {
      return bySemanticTarget;
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
        userGesture: false,
        timeoutMs: Math.max(500, Math.min(2_000, pollIntervalMs + 400))
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
