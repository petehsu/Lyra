import type {
  WorkbenchWebAction,
  WorkbenchWebActionResult,
  WorkbenchWebScanAndActRequest,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanResult,
  WorkbenchWebVerificationStateTransition,
} from "../../../shared/workbench-web-automation";
import { rankLiveSelectorCandidates } from "../live-selector/candidate-ranker";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";
import {
  findBestActionTargetCandidate,
  normalizeActionTargetValues,
} from "./action-target-helpers";
import { normalizeText } from "./query-skeleton-helpers";

const SCAN_AND_ACT_DEFAULT_MAX_LATENCY_MS = 350;
const SCAN_AND_ACT_MIN_MAX_LATENCY_MS = 120;
const SCAN_AND_ACT_MAX_MAX_LATENCY_MS = 2_000;

const normalizeScanAndActRoleHint = (
  value: string | readonly string[] | undefined
): string | undefined =>
  Array.isArray(value)
    ? value.find((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)?.trim()
    : typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;

const isWildcardLikeHint = (value: string): boolean => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return true;
  }
  if (normalized === "*" || normalized === ".*" || normalized === ".+") {
    return true;
  }
  if (/^[.*+?^${}()[\]|\\/\s]+$/.test(normalized)) {
    return true;
  }
  return false;
};

const splitHintAlternatives = (value: string): readonly string[] =>
  value
    .split(/[|,/，、；;]+/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const extractMeaningfulHintTokens = (value: unknown): readonly string[] => {
  if (typeof value !== "string") {
    return [];
  }
  const raw = value.trim();
  if (raw.length === 0) {
    return [];
  }
  const normalizedAlternatives = splitHintAlternatives(raw);
  const candidates = normalizedAlternatives.length > 0 ? normalizedAlternatives : [raw];
  return Array.from(new Set(
    candidates.filter((entry) =>
      !isWildcardLikeHint(entry)
      && /[a-z0-9\u4e00-\u9fff]/i.test(entry)
    )
  ));
};

const readScanAndActHintString = (value: unknown): string | undefined =>
  extractMeaningfulHintTokens(value)[0];

const readScanAndActHintNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : undefined;

const extractActionTargetHintRecord = (action: WorkbenchWebAction): Record<string, unknown> | undefined => {
  const rawTarget = (action as { readonly target?: unknown }).target;
  if (rawTarget === null || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
    return undefined;
  }
  const target = rawTarget as Record<string, unknown>;
  const targetSignature =
    target.stableSignature !== null
    && typeof target.stableSignature === "object"
    && !Array.isArray(target.stableSignature)
      ? target.stableSignature as Record<string, unknown>
      : undefined;
  const roleHint = normalizeScanAndActRoleHint(
    readScanAndActHintString(target.role)
    ?? readScanAndActHintString(targetSignature?.role)
  );
  const tagNameHint = readScanAndActHintString(target.tagName) ?? readScanAndActHintString(targetSignature?.tagName);
  const inputTypeHint = readScanAndActHintString(target.inputType);
  const idHint = readScanAndActHintString(target.id) ?? readScanAndActHintString(targetSignature?.id);
  const testIdHint = readScanAndActHintString(target.testId) ?? readScanAndActHintString(targetSignature?.testId);
  const nameHint = readScanAndActHintString(target.name) ?? readScanAndActHintString(targetSignature?.name);
  const textHint = readScanAndActHintString(target.text);
  const textContainsHint = readScanAndActHintString(target.textContains);
  const textSnippetHint = readScanAndActHintString(target.textSnippet);
  const ariaLabelHint = readScanAndActHintString(target.ariaLabel) ?? readScanAndActHintString(targetSignature?.ariaLabel);
  const labelHint = readScanAndActHintString(target.label);
  const placeholderHint = readScanAndActHintString(target.placeholder);
  const indexHint = readScanAndActHintNumber(target.index);
  const record: Record<string, unknown> = {
    ...(roleHint === undefined ? {} : { role: roleHint }),
    ...(tagNameHint === undefined ? {} : { tagName: tagNameHint }),
    ...(inputTypeHint === undefined ? {} : { inputType: inputTypeHint }),
    ...(idHint === undefined ? {} : { id: idHint }),
    ...(testIdHint === undefined ? {} : { testId: testIdHint }),
    ...(nameHint === undefined ? {} : { name: nameHint }),
    ...(textHint === undefined ? {} : { text: textHint }),
    ...(textContainsHint === undefined ? {} : { textContains: textContainsHint }),
    ...(textSnippetHint === undefined ? {} : { textSnippet: textSnippetHint }),
    ...(ariaLabelHint === undefined ? {} : { ariaLabel: ariaLabelHint }),
    ...(labelHint === undefined ? {} : { label: labelHint }),
    ...(placeholderHint === undefined ? {} : { placeholder: placeholderHint }),
    ...(indexHint === undefined ? {} : { index: indexHint })
  };
  return Object.keys(record).length > 0 ? record : undefined;
};

export const mergeActionWithScanAndActHints = (
  action: WorkbenchWebAction,
  targetHints?: WorkbenchWebScanAndActRequest["targetHints"]
): WorkbenchWebAction => {
  if (targetHints === undefined) {
    return action;
  }
  const rawTarget = (action as { readonly target?: unknown }).target;
  if (rawTarget === null || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
    return action;
  }
  const target = rawTarget as Record<string, unknown>;
  const roleHint = normalizeScanAndActRoleHint(targetHints.role);
  const mergedTarget = {
    ...target,
    ...(target.role === undefined && roleHint !== undefined ? { role: roleHint } : {}),
    ...(target.name === undefined && targetHints.name !== undefined ? { name: targetHints.name } : {}),
    ...(target.text === undefined && targetHints.text !== undefined ? { text: targetHints.text } : {}),
    ...(target.textContains === undefined && targetHints.textContains !== undefined
      ? { textContains: targetHints.textContains }
      : {}),
    ...(target.textSnippet === undefined && targetHints.textSnippet !== undefined
      ? { textSnippet: targetHints.textSnippet }
      : {}),
    ...(target.ariaLabel === undefined && targetHints.ariaLabel !== undefined
      ? { ariaLabel: targetHints.ariaLabel }
      : {}),
    ...(target.label === undefined && targetHints.label !== undefined ? { label: targetHints.label } : {}),
    ...(target.placeholder === undefined && targetHints.placeholder !== undefined
      ? { placeholder: targetHints.placeholder }
      : {}),
  };
  return {
    ...(action as Record<string, unknown>),
    target: mergedTarget
  } as WorkbenchWebAction;
};

export const buildScanAndActIntent = ({
  action,
  targetHints,
  toActionIntent,
}: {
  readonly action: WorkbenchWebAction;
  readonly targetHints?: WorkbenchWebScanAndActRequest["targetHints"];
  readonly toActionIntent: (action: WorkbenchWebAction, seed?: Record<string, unknown>) => WorkbenchWebTargetIntent;
}): WorkbenchWebTargetIntent => {
  const actionTargetRecord = extractActionTargetHintRecord(action);
  const roleHint = normalizeScanAndActRoleHint(
    targetHints?.role
    ?? readScanAndActHintString(actionTargetRecord?.role)
  );
  const textHints = normalizeActionTargetValues([
    targetHints?.text,
    targetHints?.textContains,
    targetHints?.textSnippet,
    targetHints?.name,
    targetHints?.ariaLabel,
    targetHints?.label,
    targetHints?.near,
    targetHints?.within,
    readScanAndActHintString(actionTargetRecord?.text),
    readScanAndActHintString(actionTargetRecord?.textContains),
    readScanAndActHintString(actionTargetRecord?.textSnippet),
    readScanAndActHintString(actionTargetRecord?.name),
    readScanAndActHintString(actionTargetRecord?.ariaLabel),
    readScanAndActHintString(actionTargetRecord?.label)
  ]);
  const placeholderHints = normalizeActionTargetValues([
    targetHints?.placeholder,
    targetHints?.name,
    targetHints?.label,
    readScanAndActHintString(actionTargetRecord?.placeholder),
    readScanAndActHintString(actionTargetRecord?.name),
    readScanAndActHintString(actionTargetRecord?.label)
  ]);
  const seedAriaLabel = targetHints?.name ?? readScanAndActHintString(actionTargetRecord?.name);
  const seedPlaceholder = targetHints?.placeholder ?? readScanAndActHintString(actionTargetRecord?.placeholder);
  const defaultIntent = toActionIntent(action, {
    ...(roleHint === undefined ? {} : { role: roleHint }),
    ...(seedAriaLabel === undefined ? {} : { ariaLabel: seedAriaLabel }),
    ...(textHints[0] === undefined ? {} : { textSnippet: textHints[0] }),
    ...(seedPlaceholder === undefined ? {} : { placeholder: seedPlaceholder })
  });
  if (targetHints === undefined && actionTargetRecord === undefined) {
    return defaultIntent;
  }
  return {
    ...defaultIntent,
    desiredRoles: normalizeActionTargetValues([...(defaultIntent.desiredRoles ?? []), roleHint]),
    textHints: normalizeActionTargetValues([...(defaultIntent.textHints ?? []), ...textHints]),
    placeholderHints: normalizeActionTargetValues([
      ...(defaultIntent.placeholderHints ?? []),
      ...placeholderHints
    ])
  };
};

const buildScanAndActTargetRecord = (
  targetHints?: WorkbenchWebScanAndActRequest["targetHints"]
): Record<string, unknown> | undefined => {
  if (targetHints === undefined) {
    return undefined;
  }
  const roleHint = normalizeScanAndActRoleHint(targetHints.role);
  const record: Record<string, unknown> = {
    ...(roleHint === undefined ? {} : { role: roleHint }),
    ...(targetHints.name === undefined ? {} : { name: targetHints.name }),
    ...(targetHints.text === undefined ? {} : { text: targetHints.text }),
    ...(targetHints.textContains === undefined ? {} : { textContains: targetHints.textContains }),
    ...(targetHints.textSnippet === undefined ? {} : { textSnippet: targetHints.textSnippet }),
    ...(targetHints.ariaLabel === undefined ? {} : { ariaLabel: targetHints.ariaLabel }),
    ...(targetHints.label === undefined ? {} : { label: targetHints.label }),
    ...(targetHints.placeholder === undefined ? {} : { placeholder: targetHints.placeholder }),
    ...(targetHints.index === undefined ? {} : { index: targetHints.index })
  };
  return Object.keys(record).length > 0 ? record : undefined;
};

const buildMergedScanAndActTargetRecord = ({
  action,
  targetHints
}: {
  readonly action: WorkbenchWebAction;
  readonly targetHints?: WorkbenchWebScanAndActRequest["targetHints"];
}): Record<string, unknown> | undefined => {
  const actionTargetRecord = extractActionTargetHintRecord(action);
  const hintTargetRecord = buildScanAndActTargetRecord(targetHints);
  if (actionTargetRecord === undefined) {
    return hintTargetRecord;
  }
  if (hintTargetRecord === undefined) {
    return actionTargetRecord;
  }
  const merged = {
    ...actionTargetRecord,
    ...hintTargetRecord
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
};

const hasStrictScanAndActTargetConstraints = ({
  targetRecord,
  targetHints
}: {
  readonly targetRecord: Record<string, unknown> | undefined;
  readonly targetHints?: WorkbenchWebScanAndActRequest["targetHints"];
}): boolean => {
  if (targetRecord === undefined) {
    return false;
  }
  const strictHintRequested = targetHints !== undefined && (
    targetHints.index !== undefined
    || readScanAndActHintString(targetHints.text) !== undefined
    || readScanAndActHintString(targetHints.textContains) !== undefined
    || readScanAndActHintString(targetHints.textSnippet) !== undefined
    || readScanAndActHintString(targetHints.ariaLabel) !== undefined
    || readScanAndActHintString(targetHints.placeholder) !== undefined
  );
  return strictHintRequested
    || readScanAndActHintNumber(targetRecord.index) !== undefined
    || readScanAndActHintString(targetRecord.id) !== undefined
    || readScanAndActHintString(targetRecord.testId) !== undefined;
};

const candidateMatchesContextHint = (
  candidate: LiveSelectorScanCandidateRecord,
  hintNeedle: string
): boolean => {
  if (hintNeedle.length === 0) {
    return false;
  }
  const haystack = [
    candidate.textSnippet,
    candidate.ariaLabel,
    candidate.affordanceLabel,
    candidate.itemIdentity?.label,
    candidate.stableSignature.ariaLabel,
    candidate.stableSignature.name,
    candidate.stableSignature.id,
    candidate.stableSignature.testId,
    candidate.containerHint?.label,
    candidate.selectorPreview
  ].map((value) => normalizeText(value)).filter((value) => value.length > 0);
  return haystack.some((value) => value.includes(hintNeedle) || hintNeedle.includes(value));
};

const constrainCandidatesByContextHint = ({
  candidates,
  hint,
  strict
}: {
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly hint?: string;
  readonly strict?: boolean;
}): readonly LiveSelectorScanCandidateRecord[] => {
  const needles = extractMeaningfulHintTokens(hint).map((entry) => normalizeText(entry));
  if (needles.length === 0) {
    return candidates;
  }
  const anchored = candidates.filter((candidate) =>
    needles.some((needle) => candidateMatchesContextHint(candidate, needle))
  );
  if (anchored.length === 0) {
    return strict === true ? [] : candidates;
  }
  const ownerIds = new Set(
    anchored
      .map((candidate) => candidate.ownerWidgetId)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  const widgetIds = new Set(
    anchored
      .map((candidate) => candidate.widgetId)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  const regionIds = new Set(
    anchored
      .map((candidate) => candidate.focusRegionId)
      .filter((value): value is string => typeof value === "string" && value.length > 0)
  );
  const contextual = candidates.filter((candidate) => {
    if (candidate.ownerWidgetId !== undefined && ownerIds.has(candidate.ownerWidgetId)) {
      return true;
    }
    if (candidate.widgetId !== undefined && widgetIds.has(candidate.widgetId)) {
      return true;
    }
    if (candidate.ownerWidgetId !== undefined && widgetIds.has(candidate.ownerWidgetId)) {
      return true;
    }
    return candidate.focusRegionId !== undefined && regionIds.has(candidate.focusRegionId);
  });
  return contextual.length > 0 ? contextual : anchored;
};

export const buildScanAndActFingerprint = ({
  action,
  targetHints
}: {
  readonly action: WorkbenchWebAction;
  readonly targetHints?: WorkbenchWebScanAndActRequest["targetHints"];
}): string => {
  const mergedTargetRecord = buildMergedScanAndActTargetRecord({
    action,
    ...(targetHints === undefined ? {} : { targetHints })
  });
  const roleHint = normalizeScanAndActRoleHint(
    readScanAndActHintString(mergedTargetRecord?.role)
    ?? targetHints?.role
  );
  const parts = [
    action.kind,
    roleHint,
    normalizeText(readScanAndActHintString(mergedTargetRecord?.name)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.text)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.textContains)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.textSnippet)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.ariaLabel)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.label)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.placeholder)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.id)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.testId)),
    normalizeText(readScanAndActHintString(mergedTargetRecord?.tagName)),
    normalizeText(targetHints?.within),
    normalizeText(targetHints?.near),
    normalizeText(targetHints?.regionId),
    normalizeText(targetHints?.groupId),
    readScanAndActHintNumber(mergedTargetRecord?.index) === undefined
      ? ""
      : String(readScanAndActHintNumber(mergedTargetRecord?.index))
  ];
  return parts.join("::");
};

export const normalizeScanAndActLatencyBudget = (value: number | undefined): number => {
  const candidate = Math.round(value ?? SCAN_AND_ACT_DEFAULT_MAX_LATENCY_MS);
  return Math.max(
    SCAN_AND_ACT_MIN_MAX_LATENCY_MS,
    Math.min(SCAN_AND_ACT_MAX_MAX_LATENCY_MS, candidate)
  );
};

export const candidateSupportsActionKind = (
  candidate: LiveSelectorScanCandidateRecord,
  action: WorkbenchWebAction
): boolean => {
  switch (action.kind) {
    case "type":
    case "clear_and_type":
      return candidate.interactable.typable || candidate.interactable.focusable;
    case "select_option":
    case "set_checked":
      return candidate.interactable.selectable || candidate.interactable.clickable;
    case "press_key":
    case "focus":
      return candidate.interactable.focusable || candidate.interactable.typable;
    case "hover":
    case "scroll_into_view":
    case "expand_probe":
    case "click":
    case "submit_form":
    case "open_link_node":
      return candidate.interactable.clickable || candidate.interactable.focusable;
    default:
      return true;
  }
};

export const selectScanAndActCandidate = ({
  scanResult,
  action,
  targetHints,
  isActionRevealTriggerCandidate,
  toActionIntent,
}: {
  readonly scanResult: WorkbenchWebTargetScanResult;
  readonly action: WorkbenchWebAction;
  readonly targetHints?: WorkbenchWebScanAndActRequest["targetHints"];
  readonly isActionRevealTriggerCandidate: (candidate: LiveSelectorScanCandidateRecord) => boolean;
  readonly toActionIntent: (action: WorkbenchWebAction, seed?: Record<string, unknown>) => WorkbenchWebTargetIntent;
}): LiveSelectorScanCandidateRecord | undefined => {
  const allCandidates = scanResult.candidates as readonly LiveSelectorScanCandidateRecord[];
  if (allCandidates.length === 0) {
    return undefined;
  }
  const regionId = normalizeText(targetHints?.regionId);
  const groupId = normalizeText(targetHints?.groupId);
  const regionFiltered = regionId.length === 0
    ? allCandidates
    : allCandidates.filter((candidate) => normalizeText(candidate.focusRegionId) === regionId);
  const groupFiltered = groupId.length === 0
    ? regionFiltered
    : regionFiltered.filter((candidate) =>
      normalizeText(candidate.ownerWidgetId) === groupId
      || normalizeText(candidate.widgetId) === groupId
    );
  const strictContextConstraint = action.kind === "click";
  const scopedCandidates = groupFiltered.length > 0 ? groupFiltered : regionFiltered;
  const nearConstrained = constrainCandidatesByContextHint({
    candidates: scopedCandidates,
    ...(targetHints?.near === undefined ? {} : { hint: targetHints.near }),
    ...(strictContextConstraint ? { strict: true } : {})
  });
  const contextConstrained = constrainCandidatesByContextHint({
    candidates: nearConstrained,
    ...(targetHints?.within === undefined ? {} : { hint: targetHints.within }),
    ...(strictContextConstraint ? { strict: true } : {})
  });
  let candidates = contextConstrained;
  if (candidates.length === 0) {
    return undefined;
  }
  const targetRecord = buildMergedScanAndActTargetRecord({
    action,
    ...(targetHints === undefined ? {} : { targetHints })
  });
  const hasMeaningfulContextHint =
    extractMeaningfulHintTokens(targetHints?.near).length > 0
    || extractMeaningfulHintTokens(targetHints?.within).length > 0;
  const roleHint = normalizeText(
    normalizeScanAndActRoleHint(targetHints?.role)
    ?? readScanAndActHintString(targetRecord?.role)
  );
  const isBroadRoleHint = roleHint.length === 0
    || roleHint === "button"
    || roleHint === "link"
    || roleHint === "listitem"
    || roleHint === "list-item"
    || roleHint === "navigation"
    || roleHint === "list";
  const hasStrongTargetSignal = targetRecord !== undefined && (
    readScanAndActHintNumber(targetRecord.index) !== undefined
    || readScanAndActHintString(targetRecord.id) !== undefined
    || readScanAndActHintString(targetRecord.testId) !== undefined
    || readScanAndActHintString(targetRecord.name) !== undefined
    || readScanAndActHintString(targetRecord.ariaLabel) !== undefined
    || readScanAndActHintString(targetRecord.label) !== undefined
    || readScanAndActHintString(targetRecord.text) !== undefined
    || readScanAndActHintString(targetRecord.textContains) !== undefined
    || readScanAndActHintString(targetRecord.textSnippet) !== undefined
    || readScanAndActHintString(targetRecord.placeholder) !== undefined
  );
  if (action.kind === "click" && !hasStrongTargetSignal && !hasMeaningfulContextHint && isBroadRoleHint) {
    return undefined;
  }
  const hasExplicitTextTarget =
    readScanAndActHintString(targetRecord?.text) !== undefined
    || readScanAndActHintString(targetRecord?.textContains) !== undefined
    || readScanAndActHintString(targetRecord?.textSnippet) !== undefined
    || readScanAndActHintString(targetRecord?.label) !== undefined
    || readScanAndActHintString(targetRecord?.ariaLabel) !== undefined;
  if (
    action.kind === "click"
    && !hasExplicitTextTarget
    && (normalizeText(targetHints?.near).length > 0 || normalizeText(targetHints?.within).length > 0)
  ) {
    const revealTriggerCandidates = candidates.filter((candidate) => isActionRevealTriggerCandidate(candidate));
    if (revealTriggerCandidates.length > 0) {
      candidates = revealTriggerCandidates;
    }
  }
  if (targetRecord !== undefined) {
    const matched = findBestActionTargetCandidate({
      candidates,
      target: targetRecord,
      actionKind: action.kind,
      action
    });
    if (matched !== undefined) {
      return matched;
    }
    if (hasStrictScanAndActTargetConstraints({
      targetRecord,
      ...(targetHints === undefined ? {} : { targetHints })
    })) {
      return undefined;
    }
  }
  const ranked = rankLiveSelectorCandidates(candidates, buildScanAndActIntent({
    action,
    ...(targetHints === undefined ? {} : { targetHints }),
    toActionIntent
  }));
  return ranked[0] ?? (scanResult.bestCandidate as LiveSelectorScanCandidateRecord | undefined);
};

export const isVerifiedActionResult = (result: WorkbenchWebActionResult): boolean =>
  result.verified === true
  || (
    result.ok
    && (
      result.actionKind === "goto_url"
      || result.actionKind === "history_back"
      || result.actionKind === "history_forward"
      || result.actionKind === "reload"
      || result.actionKind === "open_link_node"
    )
  );

const actionResultStateTransition = (
  result: WorkbenchWebActionResult
): WorkbenchWebVerificationStateTransition | undefined =>
  result.verification?.stateTransition;

const normalizeGoalTransitionToken = (value: string): string =>
  normalizeText(value).replace(/[\s_-]+/g, "");

const mapGoalExpectedTransition = (
  value: string
): WorkbenchWebVerificationStateTransition | undefined => {
  const token = normalizeGoalTransitionToken(value);
  switch (token) {
    case "valuechanged":
      return "value_changed";
    case "menuopened":
    case "menuopen":
    case "menuvisible":
    case "optionsvisible":
    case "optionsmenuvisible":
    case "panelopened":
    case "dropdownopened":
    case "popoveropened":
    case "openmenu":
      return "menu_opened";
    case "regionexpanded":
    case "expanded":
    case "sidebarexpanded":
      return "region_expanded";
    case "statechanged":
      return "state_changed";
    case "validationchanged":
      return "validation_changed";
    case "navigationchanged":
    case "urlchanged":
    case "pagechanged":
    case "conversationselected":
    case "chatselected":
    case "threadselected":
      return "navigation_changed";
    case "modelchanged":
    case "modechanged":
    case "modelswitched":
    case "modeswitched":
    case "switchmode":
    case "switchmodel":
      return "model_changed";
    case "conversationdeleted":
    case "conversationremoved":
    case "itemremoved":
    case "itemdeleted":
    case "chatdeleted":
    case "threaddeleted":
    case "deleteconversation":
      return "conversation_deleted";
    case "messagesubmitted":
      return "message_submitted";
    case "responsestarted":
      return "response_started";
    case "focuschanged":
      return "focus_changed";
    case "none":
      return "none";
    default:
      return undefined;
  }
};

const normalizeGoalExpectedTransitions = (
  value: readonly string[] | undefined
): readonly WorkbenchWebVerificationStateTransition[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }
  const mapped = value
    .map((entry) => mapGoalExpectedTransition(entry))
    .filter((entry): entry is WorkbenchWebVerificationStateTransition => entry !== undefined);
  return Array.from(new Set(mapped));
};

export const isGoalSatisfiedForResult = ({
  goal,
  result
}: {
  readonly goal?: WorkbenchWebScanAndActRequest["goal"];
  readonly result: WorkbenchWebActionResult;
}): boolean => {
  if (goal === undefined) {
    return result.ok;
  }
  const transition = actionResultStateTransition(result);
  const normalizedExpectedTransitions = normalizeGoalExpectedTransitions(
    Array.isArray(goal.expectedTransitions)
      ? goal.expectedTransitions as readonly string[]
      : undefined
  );
  if (normalizedExpectedTransitions.length > 0) {
    if (transition === undefined || !normalizedExpectedTransitions.includes(transition)) {
      return false;
    }
  }
  if (goal.mustAdvance === true) {
    if (result.ok !== true || isVerifiedActionResult(result) !== true) {
      return false;
    }
    if (transition === undefined || transition === "none") {
      return false;
    }
  }
  return result.ok;
};
