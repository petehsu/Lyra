import type {
  WorkbenchWebElementNode,
  WorkbenchWebGraphHighlights,
  WorkbenchWebNodeHint,
} from "../../shared/workbench-web-automation";

type GraphActionKind = "type" | "click" | "focus";

const normalizeText = (value: string | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const visibilityScore = (node: WorkbenchWebElementNode): number => {
  if (node.visibilityState === "visible") {
    return 10;
  }
  if (node.visibilityState === "offscreen") {
    return 3;
  }
  return -8;
};

const textMatchScore = (node: WorkbenchWebElementNode, textNeedle: string): number => {
  if (textNeedle.length === 0) {
    return 0;
  }
  let score = 0;
  const textSnippet = normalizeText(node.textSnippet);
  const ariaLabel = normalizeText(node.stableSignature.ariaLabel);
  const name = normalizeText(node.stableSignature.name);
  const id = normalizeText(node.stableSignature.id);
  if (textSnippet.includes(textNeedle)) {
    score += 14;
  }
  if (ariaLabel.includes(textNeedle)) {
    score += 12;
  }
  if (name.includes(textNeedle)) {
    score += 8;
  }
  if (id.includes(textNeedle)) {
    score += 6;
  }
  return score;
};

const actionScore = (node: WorkbenchWebElementNode, action: GraphActionKind): number => {
  const tag = normalizeText(node.tagName);
  const role = normalizeText(node.role);
  let score = visibilityScore(node);

  if (node.disabled === true) {
    score -= 20;
  }

  if (action === "type") {
    if (node.interactable.typable) {
      score += 24;
    }
    if (tag === "textarea") {
      score += 16;
    } else if (tag === "input") {
      score += 12;
    }
    if (role === "textbox" || role === "searchbox" || role === "combobox") {
      score += 10;
    }
  }

  if (action === "click") {
    if (node.interactable.clickable) {
      score += 20;
    }
    if (tag === "button" || tag === "a") {
      score += 10;
    }
    if (role === "button" || role === "link" || role === "tab" || role === "menuitem") {
      score += 8;
    }
  }

  if (action === "focus") {
    if (node.interactable.focusable) {
      score += 18;
    }
    if (node.interactable.typable) {
      score += 6;
    }
    if (tag === "textarea" || tag === "input") {
      score += 8;
    }
  }

  return score;
};

export const toNodeHint = (node: WorkbenchWebElementNode): WorkbenchWebNodeHint => ({
  nodeId: node.nodeId,
  tagName: node.tagName,
  ...(node.role === undefined ? {} : { role: node.role }),
  ...(node.inputType === undefined ? {} : { inputType: node.inputType }),
  ...(node.textSnippet === undefined ? {} : { textSnippet: node.textSnippet }),
  selectorAddress: node.selectorAddress,
  visibilityState: node.visibilityState,
  interactable: node.interactable,
});

export const rankNodesForAction = (
  nodes: readonly WorkbenchWebElementNode[],
  action: GraphActionKind,
  textNeedle = ""
): readonly WorkbenchWebElementNode[] =>
  [...nodes].sort((left, right) => {
    const leftScore = actionScore(left, action) + textMatchScore(left, textNeedle);
    const rightScore = actionScore(right, action) + textMatchScore(right, textNeedle);
    return rightScore - leftScore;
  });

export const buildGraphHighlights = (
  nodes: readonly WorkbenchWebElementNode[]
): WorkbenchWebGraphHighlights => ({
  typable: rankNodesForAction(
    nodes.filter((node) => node.interactable.typable),
    "type"
  ).slice(0, 3).map(toNodeHint),
  clickable: rankNodesForAction(
    nodes.filter((node) => node.interactable.clickable),
    "click"
  ).slice(0, 3).map(toNodeHint),
  focusable: rankNodesForAction(
    nodes.filter((node) => node.interactable.focusable || node.interactable.typable),
    "focus"
  ).slice(0, 3).map(toNodeHint),
});
