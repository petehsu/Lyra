import type { WorkbenchBrowserAgentElement } from "../types";
import { browserAgentTargetFingerprint } from "./normalizers";

export type ElementMatchLevel = "exact" | "stable" | "xpath" | "axName" | "attribute" | "nearest";

export type WorkflowElementIdentity = {
  readonly elementFingerprint: string;
  readonly stableFingerprint: string;
  readonly label: string;
  readonly role: string;
  readonly frameRef: string;
  readonly selectorPreview: string;
  readonly xpath?: string;
  readonly semanticNodeKey?: string;
};

export type ElementMatchResult = {
  readonly element: WorkbenchBrowserAgentElement;
  readonly matchLevel: ElementMatchLevel;
  readonly confidence: number;
};

const DYNAMIC_CLASS_PATTERNS = [
  "hover",
  "focus",
  "active",
  "selected",
  "pressed",
  "expanded",
  "collapsed",
  "open",
  "closed",
  "current",
  "highlight",
  "animate",
  "transition",
  "loading",
  "pending"
];

const normalizeIdentityText = (value: string): string =>
  value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();

const filterDynamicSelectorClasses = (selectorPreview: string): string =>
  selectorPreview.replace(/\.([a-zA-Z0-9_-]+)/g, (match, className: string) => {
    const lower = className.toLowerCase();
    if (DYNAMIC_CLASS_PATTERNS.some((pattern) => lower.includes(pattern))) {
      return "";
    }
    return match;
  });

export const buildStableElementFingerprint = (
  pageUrl: string,
  element: Pick<
    WorkbenchBrowserAgentElement,
    | "frameTreeNodeId"
    | "tagName"
    | "role"
    | "label"
    | "selectorPreview"
    | "href"
    | "inputType"
    | "frameUrl"
    | "discoveryScope"
    | "hostChainFingerprint"
  >
): string => [
  element.frameUrl ?? pageUrl,
  element.frameTreeNodeId,
  element.tagName,
  element.role,
  normalizeIdentityText(element.label),
  filterDynamicSelectorClasses(element.selectorPreview),
  element.href ?? "",
  element.inputType ?? "",
  element.discoveryScope ?? "document",
  element.hostChainFingerprint ?? ""
].join("|");

export const buildWorkflowElementIdentity = (
  pageUrl: string,
  element: WorkbenchBrowserAgentElement
): WorkflowElementIdentity => ({
  elementFingerprint: element.elementFingerprint,
  stableFingerprint: buildStableElementFingerprint(pageUrl, element),
  label: element.label,
  role: element.role,
  frameRef: element.frameRef,
  selectorPreview: element.selectorPreview,
  ...(element.xpath === undefined ? {} : { xpath: element.xpath }),
  ...(element.semanticNodeKey === undefined ? {} : { semanticNodeKey: element.semanticNodeKey })
});

type ParsedAttributes = {
  readonly id?: string;
  readonly name?: string;
  readonly testId?: string;
};

const parseSelectorAttributes = (selectorPreview: string): ParsedAttributes => {
  const idMatch = selectorPreview.match(/#([a-zA-Z][\w-]*)/);
  const nameMatch = selectorPreview.match(/\[name="([^"]+)"\]/);
  const testIdMatch = selectorPreview.match(/\[data-testid="([^"]+)"\]/);
  return {
    ...(idMatch?.[1] === undefined ? {} : { id: idMatch[1] }),
    ...(nameMatch?.[1] === undefined ? {} : { name: nameMatch[1] }),
    ...(testIdMatch?.[1] === undefined ? {} : { testId: testIdMatch[1] })
  };
};

const nearestCandidateScore = (
  snapshot: WorkflowElementIdentity,
  candidate: WorkbenchBrowserAgentElement
): number => {
  let score = 0;
  if (normalizeIdentityText(snapshot.label) === normalizeIdentityText(candidate.label)) {
    score += 0.34;
  }
  if (snapshot.role === candidate.role) {
    score += 0.18;
  }
  if (
    snapshot.selectorPreview.length > 0
    && snapshot.selectorPreview === candidate.selectorPreview
  ) {
    score += 0.2;
  }
  if (snapshot.frameRef === candidate.frameRef) {
    score += 0.1;
  }
  if (snapshot.semanticNodeKey !== undefined && snapshot.semanticNodeKey === candidate.semanticNodeKey) {
    score += 0.12;
  }
  return Math.max(0.05, Math.min(0.98, score));
};

const matchByAttribute = (
  snapshot: WorkflowElementIdentity,
  candidates: readonly WorkbenchBrowserAgentElement[]
): WorkbenchBrowserAgentElement | null => {
  const attrs = parseSelectorAttributes(snapshot.selectorPreview);
  const normalizedTag = snapshot.selectorPreview.split(/[.#\[]/u)[0]?.toLowerCase() ?? "";
  for (const candidate of candidates) {
    const candidateTag = candidate.tagName.toLowerCase();
    if (normalizedTag.length > 0 && candidateTag !== normalizedTag && candidate.role !== snapshot.role) {
      continue;
    }
    const candidateAttrs = parseSelectorAttributes(candidate.selectorPreview);
    if (attrs.id !== undefined && candidateAttrs.id === attrs.id) {
      return candidate;
    }
    if (attrs.name !== undefined && candidateAttrs.name === attrs.name) {
      return candidate;
    }
    if (attrs.testId !== undefined && candidateAttrs.testId === attrs.testId) {
      return candidate;
    }
  }
  return null;
};

export const matchElementIdentity = (
  pageUrl: string,
  snapshot: WorkflowElementIdentity,
  candidates: readonly WorkbenchBrowserAgentElement[],
  options?: { readonly nearestThreshold?: number }
): ElementMatchResult | null => {
  if (candidates.length === 0) {
    return null;
  }
  const nearestThreshold = options?.nearestThreshold ?? 0.72;

  for (const candidate of candidates) {
    if (candidate.elementFingerprint === snapshot.elementFingerprint) {
      return { element: candidate, matchLevel: "exact", confidence: 1 };
    }
  }

  for (const candidate of candidates) {
    if (buildStableElementFingerprint(pageUrl, candidate) === snapshot.stableFingerprint) {
      return { element: candidate, matchLevel: "stable", confidence: 0.95 };
    }
  }

  if (typeof snapshot.xpath === "string" && snapshot.xpath.length > 0) {
    const xpathMatches = candidates.filter(
      (candidate) => candidate.xpath === snapshot.xpath && snapshot.frameRef === candidate.frameRef
    );
    if (xpathMatches.length === 1) {
      return { element: xpathMatches[0]!, matchLevel: "xpath", confidence: 0.9 };
    }
  }

  const normalizedLabel = normalizeIdentityText(snapshot.label);
  const axMatches = candidates.filter(
    (candidate) =>
      normalizeIdentityText(candidate.label) === normalizedLabel
      && candidate.role === snapshot.role
      && snapshot.frameRef === candidate.frameRef
  );
  if (axMatches.length === 1) {
    return { element: axMatches[0]!, matchLevel: "axName", confidence: 0.88 };
  }
  if (axMatches.length > 1) {
    const semanticMatch = axMatches.find(
      (candidate) =>
        snapshot.semanticNodeKey !== undefined
        && candidate.semanticNodeKey === snapshot.semanticNodeKey
    );
    if (semanticMatch !== undefined) {
      return { element: semanticMatch, matchLevel: "axName", confidence: 0.86 };
    }
  }

  const attributeMatch = matchByAttribute(snapshot, candidates);
  if (attributeMatch !== null) {
    return { element: attributeMatch, matchLevel: "attribute", confidence: 0.82 };
  }

  let best: { readonly element: WorkbenchBrowserAgentElement; readonly confidence: number } | null = null;
  for (const candidate of candidates) {
    const confidence = nearestCandidateScore(snapshot, candidate);
    if (confidence >= nearestThreshold && (best === null || confidence > best.confidence)) {
      best = { element: candidate, confidence };
    }
  }
  if (best !== null) {
    return {
      element: best.element,
      matchLevel: "nearest",
      confidence: Number(best.confidence.toFixed(2))
    };
  }
  return null;
};

export const fingerprintElementForPage = (
  pageUrl: string,
  element: WorkbenchBrowserAgentElement
): { readonly exact: string; readonly stable: string } => ({
  exact: browserAgentTargetFingerprint(pageUrl, element),
  stable: buildStableElementFingerprint(pageUrl, element)
});