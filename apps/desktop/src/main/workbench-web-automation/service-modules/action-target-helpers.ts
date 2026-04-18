import type {
  WorkbenchWebAction,
  WorkbenchWebTargetIntent,
} from "../../../shared/workbench-web-automation";
import { inferCandidateSemanticRole } from "../query-semantics";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";
import { normalizeText, queryTextHaystack } from "./query-skeleton-helpers";

export const isWeakCssSelector = (value: string): boolean => {
  const selector = value.trim().toLowerCase();
  return selector.length === 0
    || selector === "*"
    || selector === "body"
    || selector === "html"
    || selector === "document"
    || selector.includes(":has-text(")
    || selector.includes(":contains(")
    || selector.includes(">>")
    || selector.includes("text=");
};

export const readActionTargetString = (
  target: Record<string, unknown> | undefined,
  key: string
): string | undefined =>
  typeof target?.[key] === "string" && (target[key] as string).trim().length > 0
    ? (target[key] as string).trim()
    : undefined;

export const readActionTargetNumber = (
  target: Record<string, unknown> | undefined,
  key: string
): number | undefined =>
  typeof target?.[key] === "number" && Number.isFinite(target[key] as number)
    ? Math.max(0, Math.round(target[key] as number))
    : undefined;

const hasMeaningfulActionTargetTextHint = (value: string): boolean =>
  /[a-z0-9\u4e00-\u9fff]/i.test(normalizeText(value));

export const readActionTargetTextHint = (
  target: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  const raw = readActionTargetString(target, key);
  if (raw === undefined) {
    return undefined;
  }
  return hasMeaningfulActionTargetTextHint(raw) ? raw : undefined;
};

const ACTION_TARGET_STRUCTURAL_KEYS = [
  "tagName",
  "role",
  "inputType",
  "id",
  "name",
  "testId",
  "ariaLabel"
] as const;

const ACTION_TARGET_TEXT_HINT_KEYS = [
  "text",
  "textContains",
  "textSnippet",
  "placeholder",
  "label"
] as const;

export const hasExplicitActionTargetSignal = (target: Record<string, unknown> | undefined): boolean => {
  const cssSelector =
    typeof target?.cssSelector === "string" && target.cssSelector.trim().length > 0
      ? target.cssSelector.trim()
      : null;
  return typeof target?.candidateId === "string"
    || typeof target?.nodeId === "string"
    || readActionTargetNumber(target, "index") !== undefined
    || (
      target?.nodeRef !== null
      && typeof target?.nodeRef === "object"
      && !Array.isArray(target.nodeRef)
      && typeof (target.nodeRef as Record<string, unknown>).nodeId === "string"
    )
    || (target?.selectorAddress !== undefined && target.selectorAddress !== null)
    || (target?.stableSignature !== undefined && target.stableSignature !== null)
    || (cssSelector !== null && !isWeakCssSelector(cssSelector))
    || ACTION_TARGET_STRUCTURAL_KEYS.some((key) => readActionTargetString(target, key) !== undefined)
    || ACTION_TARGET_TEXT_HINT_KEYS.some((key) => readActionTargetTextHint(target, key) !== undefined);
};

export const hasHardStructuredActionTargetSignal = (target: Record<string, unknown> | undefined): boolean => {
  const cssSelector =
    typeof target?.cssSelector === "string" && target.cssSelector.trim().length > 0
      ? target.cssSelector.trim()
      : null;
  return typeof target?.candidateId === "string"
    || typeof target?.nodeId === "string"
    || readActionTargetNumber(target, "index") !== undefined
    || (
      target?.nodeRef !== null
      && typeof target?.nodeRef === "object"
      && !Array.isArray(target.nodeRef)
      && typeof (target.nodeRef as Record<string, unknown>).nodeId === "string"
    )
    || (target?.selectorAddress !== undefined && target.selectorAddress !== null)
    || (target?.stableSignature !== undefined && target.stableSignature !== null)
    || (cssSelector !== null && !isWeakCssSelector(cssSelector));
};

export const normalizeActionTargetValues = (values: readonly (string | undefined)[]): readonly string[] =>
  Array.from(new Set(values.map((value) => normalizeText(value)).filter((value) => value.length > 0)));

const candidateTargetValues = (
  candidate: LiveSelectorScanCandidateRecord,
  kind: "text" | "label" | "ariaLabel" | "name" | "placeholder" | "profile"
): readonly string[] => {
  switch (kind) {
    case "label":
      return normalizeActionTargetValues([
        candidate.itemIdentity?.label,
        candidate.affordanceLabel,
        candidate.ariaLabel,
        candidate.stableSignature.ariaLabel,
        candidate.stableSignature.name,
        candidate.textSnippet
      ]);
    case "ariaLabel":
      return normalizeActionTargetValues([candidate.ariaLabel, candidate.stableSignature.ariaLabel]);
    case "name":
      return normalizeActionTargetValues([
        candidate.stableSignature.name,
        candidate.itemIdentity?.label,
        candidate.affordanceLabel,
        candidate.ariaLabel
      ]);
    case "placeholder":
      return normalizeActionTargetValues([candidate.placeholder]);
    case "profile":
      return normalizeActionTargetValues([
        candidate.ariaLabel,
        candidate.textSnippet,
        candidate.itemIdentity?.label,
        candidate.affordanceLabel,
        candidate.stableSignature.id,
        candidate.stableSignature.name,
        candidate.stableSignature.testId,
        candidate.stableSignature.ariaLabel
      ]);
    case "text":
    default:
      return normalizeActionTargetValues([
        ...queryTextHaystack(candidate),
        candidate.stableSignature.testId
      ]);
  }
};

const valuesContainNeedle = (
  values: readonly string[],
  needle: string
): boolean => values.some((value) => value.includes(needle) || needle.includes(value));

const semanticRoleMatchesTarget = (
  candidate: LiveSelectorScanCandidateRecord,
  targetRole: string
): boolean => {
  const normalizedRole = normalizeText(targetRole);
  if (normalizedRole.length === 0) {
    return false;
  }
  const candidateRoles = normalizeActionTargetValues([
    candidate.role,
    inferCandidateSemanticRole(candidate)
  ]);
  if (candidateRoles.includes(normalizedRole)) {
    return true;
  }
  if (
    normalizedRole === "navigation"
    && ["sidebar", "history-list", "history-item", "navigation", "list", "list-item"].includes(candidate.widgetKind ?? "")
  ) {
    return true;
  }
  return false;
};

const signatureScoreForActionTarget = (
  candidate: LiveSelectorScanCandidateRecord,
  target: {
    readonly tagName: string | undefined;
    readonly role: string | undefined;
    readonly inputType: string | undefined;
    readonly id: string | undefined;
    readonly name: string | undefined;
    readonly testId: string | undefined;
    readonly ariaLabel: string | undefined;
  }
): number => {
  let score = 0;
  const scoreField = ({
    candidateValue,
    targetValue,
    exactWeight,
    fuzzyWeight,
    allowSemanticRole = false,
    penalizeMismatch = true
  }: {
    readonly candidateValue: string | undefined;
    readonly targetValue: string | undefined;
    readonly exactWeight: number;
    readonly fuzzyWeight?: number;
    readonly allowSemanticRole?: boolean;
    readonly penalizeMismatch?: boolean;
  }) => {
    const normalizedTarget = normalizeText(targetValue);
    if (normalizedTarget.length === 0) {
      return;
    }
    const normalizedCandidate = normalizeText(candidateValue);
    if (normalizedCandidate === normalizedTarget) {
      score += exactWeight;
      return;
    }
    if (allowSemanticRole && semanticRoleMatchesTarget(candidate, normalizedTarget)) {
      score += exactWeight;
      return;
    }
    if (fuzzyWeight !== undefined && normalizedCandidate.length > 0 && (
      normalizedCandidate.includes(normalizedTarget) || normalizedTarget.includes(normalizedCandidate)
    )) {
      score += fuzzyWeight;
      return;
    }
    if (penalizeMismatch) {
      score -= exactWeight;
    }
  };

  scoreField({
    candidateValue: candidate.tagName,
    targetValue: target.tagName,
    exactWeight: 22
  });
  scoreField({
    candidateValue: candidate.role,
    targetValue: target.role,
    exactWeight: 28,
    fuzzyWeight: 14,
    allowSemanticRole: true
  });
  scoreField({
    candidateValue: candidate.inputType,
    targetValue: target.inputType,
    exactWeight: 18
  });
  scoreField({
    candidateValue: candidate.stableSignature.id,
    targetValue: target.id,
    exactWeight: 68,
    fuzzyWeight: 24
  });
  scoreField({
    candidateValue: candidate.stableSignature.name,
    targetValue: target.name,
    exactWeight: 46,
    fuzzyWeight: 18
  });
  scoreField({
    candidateValue: candidate.stableSignature.testId,
    targetValue: target.testId,
    exactWeight: 84,
    fuzzyWeight: 28
  });
  scoreField({
    candidateValue: candidate.stableSignature.ariaLabel ?? candidate.ariaLabel,
    targetValue: target.ariaLabel,
    exactWeight: 44,
    fuzzyWeight: 18,
    penalizeMismatch: false
  });
  return score;
};

export const hasSidebarHistoryIntent = (target: Record<string, unknown> | undefined): boolean =>
  normalizeActionTargetValues([
    readActionTargetString(target, "role"),
    readActionTargetString(target, "ariaLabel"),
    readActionTargetTextHint(target, "text"),
    readActionTargetTextHint(target, "textContains"),
    readActionTargetTextHint(target, "textSnippet"),
    readActionTargetTextHint(target, "label"),
    readActionTargetString(target, "name"),
    readActionTargetString(
      target?.stableSignature !== null && typeof target?.stableSignature === "object"
        ? target.stableSignature as Record<string, unknown>
        : undefined,
      "ariaLabel"
    ),
    readActionTargetString(
      target?.stableSignature !== null && typeof target?.stableSignature === "object"
        ? target.stableSignature as Record<string, unknown>
        : undefined,
      "testId"
    )
  ]).some((value) =>
    value.includes("sidebar")
    || value.includes("history")
    || value.includes("chat history")
    || value.includes("recents")
    || value.includes("conversation")
    || value.includes("navigation")
  );

const hasSearchSemanticHint = (value: string): boolean =>
  value.includes("search")
  || value.includes("find")
  || value.includes("lookup")
  || value.includes("查找")
  || value.includes("搜索")
  || value.includes("检索");

const hasComposerSemanticHint = (value: string): boolean =>
  value.includes("chat")
  || value.includes("message")
  || value.includes("reply")
  || value.includes("prompt")
  || value.includes("composer")
  || value.includes("ask")
  || value.includes("question")
  || value.includes("input")
  || value.includes("输入")
  || value.includes("消息")
  || value.includes("提问")
  || value.includes("对话")
  || value.includes("发送");

const isTypingActionKind = (actionKind: WorkbenchWebAction["kind"] | undefined): boolean =>
  actionKind === "type" || actionKind === "clear_and_type";

const inferTypingTargetSemantics = ({
  target,
  action
}: {
  readonly target: Record<string, unknown>;
  readonly action?: WorkbenchWebAction;
}): {
  readonly searchIntent: boolean;
  readonly composerIntent: boolean;
  readonly submitIntent: boolean;
} => {
  const values = normalizeActionTargetValues([
    readActionTargetString(target, "id"),
    readActionTargetString(target, "name"),
    readActionTargetString(target, "testId"),
    readActionTargetString(target, "ariaLabel"),
    readActionTargetTextHint(target, "label"),
    readActionTargetTextHint(target, "text"),
    readActionTargetTextHint(target, "textContains"),
    readActionTargetTextHint(target, "placeholder"),
    readActionTargetString(target, "selectorPreview"),
    readActionTargetString(
      target.stableSignature !== null && typeof target.stableSignature === "object"
        ? target.stableSignature as Record<string, unknown>
        : undefined,
      "id"
    ),
    readActionTargetString(
      target.stableSignature !== null && typeof target.stableSignature === "object"
        ? target.stableSignature as Record<string, unknown>
        : undefined,
      "name"
    ),
    readActionTargetString(
      target.stableSignature !== null && typeof target.stableSignature === "object"
        ? target.stableSignature as Record<string, unknown>
        : undefined,
      "ariaLabel"
    )
  ]);

  const searchIntent = values.some((value) => hasSearchSemanticHint(value));
  const composerIntent = values.some((value) => hasComposerSemanticHint(value));
  const submitIntent = action?.kind === "type" || action?.kind === "clear_and_type"
    ? action.submit === true
    : false;

  return {
    searchIntent,
    composerIntent,
    submitIntent
  };
};

const isProfileLikeCandidate = (candidate: LiveSelectorScanCandidateRecord): boolean =>
  candidateTargetValues(candidate, "profile").some((value) =>
    value.includes("profile")
    || value.includes("account")
    || value.includes("avatar")
    || value.includes("user menu")
  );

export const scoreActionTargetCandidate = ({
  actionKind,
  action,
  target,
  candidate
}: {
  readonly actionKind: WorkbenchWebAction["kind"] | undefined;
  readonly action?: WorkbenchWebAction;
  readonly target: Record<string, unknown>;
  readonly candidate: LiveSelectorScanCandidateRecord;
}): number => {
  let score = 0;
  let matchedSignal = false;

  if (typeof target.candidateId === "string" && target.candidateId === candidate.candidateId) {
    return 500;
  }
  if (
    target.nodeRef !== null
    && typeof target.nodeRef === "object"
    && !Array.isArray(target.nodeRef)
    && typeof (target.nodeRef as Record<string, unknown>).nodeId === "string"
    && (target.nodeRef as Record<string, unknown>).nodeId === candidate.candidateId
  ) {
    return 500;
  }
  if (typeof target.nodeId === "string" && target.nodeId === candidate.candidateId) {
    return 480;
  }
  if (
    target.selectorAddress !== null
    && typeof target.selectorAddress === "object"
    && !Array.isArray(target.selectorAddress)
  ) {
    const selectorAddress = target.selectorAddress as Record<string, unknown>;
    matchedSignal = true;
    if (
      selectorAddress.frameTreeNodeId === candidate.selectorAddress.frameTreeNodeId
      && selectorAddress.path === candidate.selectorAddress.path
    ) {
      return 460;
    }
    score -= 160;
  }
  if (typeof target.cssSelector === "string" && target.cssSelector.trim().length > 0) {
    matchedSignal = true;
    score += candidate.selectorPreview === target.cssSelector.trim() ? 54 : -28;
  }

  const targetSignatureSource =
    target.stableSignature !== null && typeof target.stableSignature === "object" && !Array.isArray(target.stableSignature)
      ? target.stableSignature as Record<string, unknown>
      : target;
  const signatureScore = signatureScoreForActionTarget(candidate, {
    tagName: readActionTargetString(targetSignatureSource, "tagName"),
    role: readActionTargetString(targetSignatureSource, "role"),
    inputType: readActionTargetString(targetSignatureSource, "inputType"),
    id: readActionTargetString(targetSignatureSource, "id"),
    name: readActionTargetString(targetSignatureSource, "name"),
    testId: readActionTargetString(targetSignatureSource, "testId"),
    ariaLabel: readActionTargetString(targetSignatureSource, "ariaLabel")
  });
  if (signatureScore !== 0) {
    matchedSignal = true;
    score += signatureScore;
  }

  const scoreTextField = ({
    values,
    targetValue,
    exactWeight,
    containsWeight,
    mismatchWeight
  }: {
    readonly values: readonly string[];
    readonly targetValue: string | undefined;
    readonly exactWeight: number;
    readonly containsWeight: number;
    readonly mismatchWeight: number;
  }) => {
    const normalizedTarget = normalizeText(targetValue);
    if (normalizedTarget.length === 0) {
      return;
    }
    matchedSignal = true;
    if (values.includes(normalizedTarget)) {
      score += exactWeight;
      return;
    }
    if (valuesContainNeedle(values, normalizedTarget)) {
      score += containsWeight;
      return;
    }
    score -= mismatchWeight;
  };

  scoreTextField({
    values: candidateTargetValues(candidate, "text"),
    targetValue: readActionTargetTextHint(target, "text"),
    exactWeight: 48,
    containsWeight: 26,
    mismatchWeight: 28
  });
  scoreTextField({
    values: candidateTargetValues(candidate, "text"),
    targetValue: readActionTargetTextHint(target, "textContains") ?? readActionTargetTextHint(target, "textSnippet"),
    exactWeight: 38,
    containsWeight: 22,
    mismatchWeight: 18
  });
  scoreTextField({
    values: candidateTargetValues(candidate, "text"),
    targetValue: readActionTargetTextHint(target, "ariaLabel"),
    exactWeight: 24,
    containsWeight: 14,
    mismatchWeight: 6
  });
  scoreTextField({
    values: candidateTargetValues(candidate, "placeholder"),
    targetValue: readActionTargetTextHint(target, "placeholder"),
    exactWeight: 34,
    containsWeight: 18,
    mismatchWeight: 20
  });
  scoreTextField({
    values: candidateTargetValues(candidate, "label"),
    targetValue: readActionTargetTextHint(target, "label"),
    exactWeight: 34,
    containsWeight: 18,
    mismatchWeight: 20
  });

  if (hasSidebarHistoryIntent(target)) {
    matchedSignal = true;
    score += ["sidebar", "history-list", "history-item", "navigation", "list", "list-item"].includes(candidate.widgetKind ?? "")
      ? 46
      : -18;
    if (actionKind === "expand_probe" && candidate.widgetKind === "menu-trigger") {
      score -= 14;
    }
    if (isProfileLikeCandidate(candidate)) {
      score -= 96;
    }
  }

  if (isTypingActionKind(actionKind)) {
    matchedSignal = true;
    const typingSemantics = inferTypingTargetSemantics({
      target,
      ...(action === undefined ? {} : { action })
    });
    const candidateTextProfile = candidateTargetValues(candidate, "profile");
    const candidateLooksSearch =
      candidate.widgetKind === "search-bar"
      || candidateTextProfile.some((value) => hasSearchSemanticHint(value));
    const candidateLooksComposer =
      candidate.widgetKind === "composer"
      || candidate.widgetKind === "chat-composer"
      || candidate.widgetKind === "form"
      || candidateTextProfile.some((value) => hasComposerSemanticHint(value));

    if (candidate.interactable.typable) {
      score += 28;
    } else {
      score -= 72;
    }
    if (candidate.widgetKind === "search-bar") {
      score -= 18;
    }
    if (candidateLooksComposer) {
      score += 20;
    }
    if (candidate.bounds.height >= 44) {
      score += 8;
    }
    if (candidate.bounds.height <= 32) {
      score -= 10;
    }
    if (candidate.bounds.width >= 240) {
      score += 6;
    }

    if (typingSemantics.searchIntent) {
      score += candidateLooksSearch ? 36 : -18;
    }

    if (typingSemantics.composerIntent || typingSemantics.submitIntent) {
      score += candidateLooksComposer ? 34 : -16;
      score += candidateLooksSearch ? -52 : 0;
      score += candidate.bounds.y >= 280 ? 12 : -14;
    }
  }

  score += candidate.visibilityState === "visible" ? 4 : 0;
  score += candidate.keyboardReachable !== false ? 3 : 0;
  score += candidate.withinCurrentWorkflow === true ? 4 : 0;

  if (!matchedSignal) {
    return Number.NEGATIVE_INFINITY;
  }
  return score;
};

export const findBestActionTargetCandidate = ({
  candidates,
  target,
  actionKind,
  action
}: {
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly target: Record<string, unknown>;
  readonly actionKind: WorkbenchWebAction["kind"] | undefined;
  readonly action?: WorkbenchWebAction;
}): LiveSelectorScanCandidateRecord | undefined => {
  const scoredCandidates = candidates
    .map((candidate) => ({
      candidate,
      score: scoreActionTargetCandidate({
        actionKind,
        ...(action === undefined ? {} : { action }),
        target,
        candidate
      })
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score);

  const targetIndex = readActionTargetNumber(target, "index");
  if (targetIndex !== undefined) {
    const indexed = scoredCandidates[targetIndex];
    return indexed !== undefined && indexed.score >= 8
      ? indexed.candidate
      : undefined;
  }

  const best = scoredCandidates[0];
  return best !== undefined && best.score >= 18
    ? best.candidate
    : undefined;
};

export const hasTextualActionTargetHints = (target: Record<string, unknown> | undefined): boolean =>
  normalizeActionTargetValues([
    readActionTargetTextHint(target, "text"),
    readActionTargetTextHint(target, "textContains"),
    readActionTargetTextHint(target, "textSnippet"),
    readActionTargetString(target, "ariaLabel"),
    readActionTargetTextHint(target, "label"),
    readActionTargetString(target, "name"),
    readActionTargetTextHint(target, "placeholder"),
    readActionTargetString(target, "testId"),
    readActionTargetString(
      target?.stableSignature !== null && typeof target?.stableSignature === "object"
        ? target.stableSignature as Record<string, unknown>
        : undefined,
      "ariaLabel"
    ),
    readActionTargetString(
      target?.stableSignature !== null && typeof target?.stableSignature === "object"
        ? target.stableSignature as Record<string, unknown>
        : undefined,
      "testId"
    )
  ]).length > 0;

export const buildExplicitTargetRecoveryIntent = ({
  target,
  actionKind
}: {
  readonly target: Record<string, unknown>;
  readonly actionKind: WorkbenchWebAction["kind"] | undefined;
}): WorkbenchWebTargetIntent => {
  const targetSignature =
    target.stableSignature !== null && typeof target.stableSignature === "object"
      ? target.stableSignature as Record<string, unknown>
      : undefined;
  const tagName = readActionTargetString(target, "tagName") ?? readActionTargetString(targetSignature, "tagName");
  const role = readActionTargetString(target, "role") ?? readActionTargetString(targetSignature, "role");
  const operation: WorkbenchWebTargetIntent["operation"] =
    actionKind === "type" || actionKind === "clear_and_type"
      ? "type"
      : actionKind === "focus" || actionKind === "press_key" || actionKind === "scroll_into_view"
        ? "focus"
        : actionKind === "select_option"
          ? "select"
          : actionKind === "hover"
            ? "hover"
            : actionKind === "submit_form"
              ? "submit"
              : "click";
  return {
    operation,
    desiredTags: [tagName ?? "button", "a", "input", "textarea", "div"],
    desiredRoles: [role ?? "button", "link", "menuitem", "textbox", "option"],
    textHints: normalizeActionTargetValues([
      readActionTargetTextHint(target, "text"),
      readActionTargetTextHint(target, "textContains"),
      readActionTargetTextHint(target, "textSnippet"),
      readActionTargetString(target, "ariaLabel"),
      readActionTargetTextHint(target, "label"),
      readActionTargetString(target, "name"),
      readActionTargetString(targetSignature, "ariaLabel"),
      readActionTargetString(targetSignature, "testId")
    ]),
    placeholderHints: normalizeActionTargetValues([
      readActionTargetTextHint(target, "placeholder")
    ]),
    ...(operation === "type" || operation === "focus" ? { allowContentEditable: true } : {})
  };
};
