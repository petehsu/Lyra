import type {
  WorkbenchLumenStaleTarget,
  WorkbenchLumenTargetCandidate,
  WorkbenchLumenTargetExplanation,
  WorkbenchLumenTargetKind,
  WorkbenchLumenTargetRef,
  WorkbenchLumenTargetStaleReason
} from "../../shared/desktop-bridge";
import type {
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentElementBounds,
  WorkbenchBrowserAgentTargetMode
} from "./types";

export const LUMEN_TARGET_REF_PREFIX = "lumen:";
export const DEFAULT_LUMEN_TARGET_TTL_MS = 5 * 60_000;

type LumenTargetElementInput = Pick<
  WorkbenchBrowserAgentElement,
  | "frameTreeNodeId"
  | "tagName"
  | "role"
  | "label"
  | "selectorPreview"
  | "bounds"
  | "focusable"
  | "disabled"
  | "editable"
  | "href"
  | "inputType"
  | "frameUrl"
  | "discoveryScope"
  | "hostChainFingerprint"
>;

export type LumenTargetRegistryEntry = {
  readonly target: WorkbenchLumenTargetRef;
  readonly element: WorkbenchBrowserAgentElement;
  readonly observationId: string;
  readonly tabId: string;
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly url: string;
  readonly title: string;
  readonly firstSeenAt: number;
  lastSeenAt: number;
  staleReason?: WorkbenchLumenTargetStaleReason;
};

type LumenTargetRegistryObservation = {
  readonly tabId: string;
  readonly targetMode: WorkbenchBrowserAgentTargetMode;
  readonly observationId: string;
  readonly mapEpoch: number;
  readonly url: string;
  readonly title: string;
  readonly elements: readonly WorkbenchBrowserAgentElement[];
  readonly observedAt?: number;
};

export type LumenTargetResolveResult =
  | {
      readonly ok: true;
      readonly entry: LumenTargetRegistryEntry;
    }
  | {
      readonly ok: false;
      readonly staleTarget: WorkbenchLumenStaleTarget;
    };

const hashStableString = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const normalizeIdentityText = (value: string): string =>
  value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();

const boundsBucket = (bounds: WorkbenchBrowserAgentElementBounds): string => [
  Math.round(bounds.x / 8),
  Math.round(bounds.y / 8),
  Math.round(bounds.width / 8),
  Math.round(bounds.height / 8)
].join(",");

const targetRegistryKey = (
  tabId: string,
  targetMode: WorkbenchBrowserAgentTargetMode
): string => `${targetMode}:${tabId}`;

export const buildLumenElementFingerprint = (
  pageUrl: string,
  element: LumenTargetElementInput
): string => [
  element.frameUrl ?? pageUrl,
  element.frameTreeNodeId,
  element.tagName,
  element.role,
  normalizeIdentityText(element.label),
  element.selectorPreview,
  element.href ?? "",
  element.inputType ?? "",
  element.discoveryScope ?? "document",
  element.hostChainFingerprint ?? "",
  boundsBucket(element.bounds)
].join("|");

const classifyLumenTargetKind = (
  element: LumenTargetElementInput
): WorkbenchLumenTargetKind => {
  if (element.discoveryScope === "visual") {
    return "visual";
  }
  const role = element.role.toLocaleLowerCase();
  const tagName = element.tagName.toLocaleLowerCase();
  if (element.editable || tagName === "input" || tagName === "textarea" || role === "textbox" || role === "searchbox") {
    return "input";
  }
  if (role === "button" || role === "menuitem" || tagName === "button" || tagName === "summary") {
    return "button";
  }
  if (role === "link" || tagName === "a" || typeof element.href === "string") {
    return "link";
  }
  return "element";
};

export const createLumenTargetIdentity = ({
  tabId,
  pageUrl,
  mapEpoch,
  element,
  now = Date.now(),
  ttlMs = DEFAULT_LUMEN_TARGET_TTL_MS
}: {
  readonly tabId: string;
  readonly pageUrl: string;
  readonly mapEpoch: number;
  readonly element: LumenTargetElementInput;
  readonly now?: number;
  readonly ttlMs?: number;
}): {
  readonly stableId: string;
  readonly targetRef: string;
  readonly frameRef: string;
  readonly elementFingerprint: string;
  readonly target: WorkbenchLumenTargetRef;
} => {
  const elementFingerprint = buildLumenElementFingerprint(pageUrl, element);
  const stableId = hashStableString(elementFingerprint);
  const targetRef = `${LUMEN_TARGET_REF_PREFIX}${stableId}`;
  const frameRef = `frame:${element.frameTreeNodeId}:${hashStableString(element.frameUrl ?? pageUrl)}`;
  const target: WorkbenchLumenTargetRef = {
    targetRef,
    targetKind: classifyLumenTargetKind(element),
    tabId,
    frameRef,
    frameChain: [frameRef],
    elementFingerprint,
    mapEpoch,
    expiresAt: now + ttlMs
  };
  return {
    stableId,
    targetRef,
    frameRef,
    elementFingerprint,
    target
  };
};

const candidateReasonAndConfidence = (
  staleEntry: LumenTargetRegistryEntry | null,
  candidate: WorkbenchBrowserAgentElement
): { readonly reason: string; readonly confidence: number } => {
  if (staleEntry === null) {
    return {
      reason: "recent-target",
      confidence: 0.35
    };
  }
  let score = 0;
  const staleElement = staleEntry.element;
  if (normalizeIdentityText(staleElement.label) === normalizeIdentityText(candidate.label)) {
    score += 0.34;
  }
  if (staleElement.role === candidate.role) {
    score += 0.18;
  }
  if (staleElement.selectorPreview.length > 0 && staleElement.selectorPreview === candidate.selectorPreview) {
    score += 0.2;
  }
  if ((staleElement.href ?? "") === (candidate.href ?? "")) {
    score += 0.1;
  }
  if (staleElement.frameRef === candidate.frameRef) {
    score += 0.1;
  }
  if (boundsBucket(staleElement.bounds) === boundsBucket(candidate.bounds)) {
    score += 0.08;
  }
  const confidence = Math.max(0.05, Math.min(0.98, score));
  return {
    reason: confidence >= 0.72 ? "probable-rebind" : "nearby-recent-target",
    confidence
  };
};

const buildCandidate = (
  staleEntry: LumenTargetRegistryEntry | null,
  element: WorkbenchBrowserAgentElement
): WorkbenchLumenTargetCandidate => {
  const scored = candidateReasonAndConfidence(staleEntry, element);
  return {
    targetRef: element.targetRef,
    targetKind: element.target.targetKind,
    label: element.label,
    role: element.role,
    frameRef: element.frameRef,
    confidence: Number(scored.confidence.toFixed(2)),
    reason: scored.reason
  };
};

export class LumenTargetRegistry {
  private readonly ttlMs: number;
  private readonly epochs = new Map<string, number>();
  private readonly entries = new Map<string, Map<string, LumenTargetRegistryEntry>>();
  private readonly invalidatedReasons = new Map<string, WorkbenchLumenTargetStaleReason>();
  private readonly latestObservations = new Map<string, {
    readonly observationId: string;
    readonly mapEpoch: number;
    readonly elements: readonly WorkbenchBrowserAgentElement[];
    readonly elementsById: ReadonlyMap<number, WorkbenchBrowserAgentElement>;
    readonly observedAt: number;
  }>();

  constructor(ttlMs = DEFAULT_LUMEN_TARGET_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  nextMapEpoch(tabId: string, targetMode: WorkbenchBrowserAgentTargetMode): number {
    const key = targetRegistryKey(tabId, targetMode);
    const next = (this.epochs.get(key) ?? 0) + 1;
    this.epochs.set(key, next);
    return next;
  }

  targetTtlMs(): number {
    return this.ttlMs;
  }

  registerObservation(observation: LumenTargetRegistryObservation): void {
    const key = targetRegistryKey(observation.tabId, observation.targetMode);
    const observedAt = observation.observedAt ?? Date.now();
    const tabEntries = this.entries.get(key) ?? new Map<string, LumenTargetRegistryEntry>();
    const seenRefs = new Set(observation.elements.map((element) => element.targetRef));
    for (const entry of tabEntries.values()) {
      if (!seenRefs.has(entry.target.targetRef)) {
        entry.staleReason = "mapEpochReplaced";
      }
    }
    for (const element of observation.elements) {
      const existing = tabEntries.get(element.targetRef);
      tabEntries.set(element.targetRef, {
        target: element.target,
        element,
        observationId: observation.observationId,
        tabId: observation.tabId,
        targetMode: observation.targetMode,
        url: observation.url,
        title: observation.title,
        firstSeenAt: existing?.firstSeenAt ?? observedAt,
        lastSeenAt: observedAt
      });
    }
    this.entries.set(key, tabEntries);
    this.invalidatedReasons.delete(key);
    this.latestObservations.set(key, {
      observationId: observation.observationId,
      mapEpoch: observation.mapEpoch,
      elements: observation.elements,
      elementsById: new Map(observation.elements.map((element) => [element.id, element])),
      observedAt
    });
  }

  invalidateTab(
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    reason: WorkbenchLumenTargetStaleReason = "navigation"
  ): void {
    const key = targetRegistryKey(tabId, targetMode);
    const tabEntries = this.entries.get(key);
    if (tabEntries !== undefined) {
      for (const entry of tabEntries.values()) {
        entry.staleReason = reason;
      }
    }
    this.invalidatedReasons.set(key, reason);
    this.latestObservations.delete(key);
  }

  clear(): void {
    this.epochs.clear();
    this.entries.clear();
    this.invalidatedReasons.clear();
    this.latestObservations.clear();
  }

  resolveElementId(
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    elementId: number,
    observationId?: string
  ): LumenTargetResolveResult {
    const key = targetRegistryKey(tabId, targetMode);
    const latest = this.latestObservations.get(key);
    if (
      latest === undefined
      || (observationId !== undefined && latest.observationId !== observationId)
    ) {
      return {
        ok: false,
        staleTarget: this.staleTarget(
          tabId,
          targetMode,
          null,
          this.invalidatedReasons.get(key) ?? "observationLocalId"
        )
      };
    }
    const element = latest.elementsById.get(elementId) ?? null;
    if (element === null) {
      return {
        ok: false,
        staleTarget: this.staleTarget(tabId, targetMode, null, "observationLocalId")
      };
    }
    const entry = this.entries.get(key)?.get(element.targetRef);
    if (entry === undefined) {
      return {
        ok: false,
        staleTarget: this.staleTarget(tabId, targetMode, null, "notFound")
      };
    }
    return { ok: true, entry };
  }

  getTargetRefSnapshot(
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    targetRef: string
  ): LumenTargetRegistryEntry | null {
    const key = targetRegistryKey(tabId, targetMode);
    return this.entries.get(key)?.get(targetRef) ?? null;
  }

  resolveTargetRef(
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    targetRef: string,
    now = Date.now()
  ): LumenTargetResolveResult {
    if (!targetRef.startsWith(LUMEN_TARGET_REF_PREFIX)) {
      return {
        ok: false,
        staleTarget: this.staleTarget(tabId, targetMode, null, "invalidRef")
      };
    }
    const key = targetRegistryKey(tabId, targetMode);
    const entry = this.entries.get(key)?.get(targetRef) ?? null;
    if (entry === null) {
      return {
        ok: false,
        staleTarget: this.staleTarget(
          tabId,
          targetMode,
          null,
          this.invalidatedReasons.get(key) ?? "notFound"
        )
      };
    }
    if (entry.target.expiresAt <= now) {
      entry.staleReason = "expired";
    }
    if (entry.staleReason !== undefined) {
      return {
        ok: false,
        staleTarget: this.staleTarget(tabId, targetMode, entry, entry.staleReason)
      };
    }
    return { ok: true, entry };
  }

  explainTargetRef({
    tabId,
    targetMode,
    targetRef,
    maxCandidates = 5,
    now = Date.now()
  }: {
    readonly tabId: string;
    readonly targetMode: WorkbenchBrowserAgentTargetMode;
    readonly targetRef: string;
    readonly maxCandidates?: number;
    readonly now?: number;
  }): WorkbenchLumenTargetExplanation {
    const resolved = this.resolveTargetRef(tabId, targetMode, targetRef, now);
    if (resolved.ok) {
      return {
        ok: true,
        kind: "lyraLumenTargetExplanation",
        tabId,
        targetMode,
        targetRef,
        available: true,
        target: resolved.entry.target,
        lastSeenAt: resolved.entry.lastSeenAt,
        recommendedAction: "lyra_lumen.act"
      };
    }
    const staleTarget = {
      ...resolved.staleTarget,
      nearestCandidates: resolved.staleTarget.nearestCandidates.slice(0, maxCandidates)
    };
    return {
      ok: true,
      kind: "lyraLumenTargetExplanation",
      tabId,
      targetMode,
      targetRef,
      available: false,
      lastSeenAt: staleTarget.lastSeenAt,
      staleTarget,
      recommendedAction: "lyra_lumen.map"
    };
  }

  listRecentTargets(
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    maxTargets = 10
  ): readonly WorkbenchLumenTargetRef[] {
    const key = targetRegistryKey(tabId, targetMode);
    return [...(this.entries.get(key)?.values() ?? [])]
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
      .slice(0, Math.max(0, maxTargets))
      .map((entry) => entry.target);
  }

  private staleTarget(
    tabId: string,
    targetMode: WorkbenchBrowserAgentTargetMode,
    staleEntry: LumenTargetRegistryEntry | null,
    reason: WorkbenchLumenTargetStaleReason
  ): WorkbenchLumenStaleTarget {
    const key = targetRegistryKey(tabId, targetMode);
    const latest = this.latestObservations.get(key);
    const candidates = (latest?.elements ?? [])
      .filter((element) => staleEntry === null || element.targetRef !== staleEntry.target.targetRef)
      .map((element) => buildCandidate(staleEntry, element))
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 5);
    return {
      reason,
      lastSeenAt: staleEntry?.lastSeenAt ?? null,
      recommendedAction: reason === "invalidRef" ? "lyra_lumen_explain_target" : "lyra_lumen.map",
      nearestCandidates: candidates
    };
  }
}
