import type {
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentObservation,
  WorkbenchBrowserAgentPlanResult,
  WorkbenchBrowserAgentTargetMode,
  WorkbenchBrowserPlanCandidate,
  WorkbenchBrowserSemanticActionCapability
} from "../types";
import { actionCapabilitiesForElement } from "./normalizers";

const DEFAULT_MAX_CANDIDATES = 20;
const PROBABLE_REBIND_THRESHOLD = 0.72;

const deriveInteraction = (
  element: WorkbenchBrowserAgentElement,
  capabilities: readonly WorkbenchBrowserSemanticActionCapability[]
): WorkbenchBrowserPlanCandidate["interaction"] => {
  if (element.editable || capabilities.includes("type")) {
    return "type";
  }
  if (capabilities.includes("toggle") || element.role === "checkbox" || element.role === "switch") {
    return "toggle";
  }
  if (element.role === "combobox" || element.role === "listbox" || element.tagName === "select") {
    return "select";
  }
  return "click";
};

const deriveSensitiveSlot = (
  element: WorkbenchBrowserAgentElement
): WorkbenchBrowserPlanCandidate["sensitiveSlot"] | undefined => {
  const autocomplete = String(element.inputType ?? "").toLowerCase();
  const label = element.label.toLowerCase();
  if (element.inputType === "password" || label.includes("password")) {
    return "password";
  }
  if (label.includes("username") || label.includes("user name") || autocomplete === "username") {
    return "username";
  }
  if (label.includes("email") || element.inputType === "email") {
    return "email";
  }
  return undefined;
};

const matchesLabelIncludes = (element: WorkbenchBrowserAgentElement, needles: readonly string[]): boolean => {
  const haystack = `${element.label} ${element.textSnippet ?? ""} ${element.actionHint ?? ""}`.toLowerCase();
  return needles.some((needle) => haystack.includes(needle.trim().toLowerCase()));
};

const distanceToAnchor = (
  element: WorkbenchBrowserAgentElement,
  anchor: { readonly x: number; readonly y: number }
): number => {
  const centerX = element.bounds.x + element.bounds.width / 2;
  const centerY = element.bounds.y + element.bounds.height / 2;
  return Math.hypot(centerX - anchor.x, centerY - anchor.y);
};

export const buildPlanCandidates = (request: {
  readonly observation: WorkbenchBrowserAgentObservation;
  readonly roles?: readonly string[];
  readonly labelIncludes?: readonly string[];
  readonly anchorRect?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly maxCandidates?: number;
}): readonly WorkbenchBrowserPlanCandidate[] => {
  const maxCandidates = Math.max(1, Math.min(request.maxCandidates ?? DEFAULT_MAX_CANDIDATES, 40));
  const roleSet = request.roles === undefined
    ? null
    : new Set(request.roles.map((role) => role.trim().toLowerCase()).filter((role) => role.length > 0));
  const labelNeedles = (request.labelIncludes ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const anchor = request.anchorRect === undefined
    ? null
    : {
        x: request.anchorRect.x + request.anchorRect.width / 2,
        y: request.anchorRect.y + request.anchorRect.height / 2
      };

  const filtered = request.observation.elements.filter((element) => {
    if (element.disabled || element.discoveryScope === "visual") {
      return false;
    }
    if (roleSet !== null && !roleSet.has(element.role.toLowerCase())) {
      return false;
    }
    if (labelNeedles.length > 0 && !matchesLabelIncludes(element, labelNeedles)) {
      return false;
    }
    return true;
  });

  const ranked = [...filtered].sort((left, right) => {
    if (anchor !== null) {
      return distanceToAnchor(left, anchor) - distanceToAnchor(right, anchor);
    }
    return left.id - right.id;
  });

  return ranked.slice(0, maxCandidates).map((element) => {
    const actionCapabilities = actionCapabilitiesForElement(element);
    return {
      targetRef: element.targetRef,
      elementId: element.id,
      role: element.role,
      label: element.label,
      interaction: deriveInteraction(element, actionCapabilities),
      actionCapabilities,
      ...(element.textSnippet === undefined ? {} : { sectionHint: element.textSnippet }),
      ...(deriveSensitiveSlot(element) === undefined ? {} : { sensitiveSlot: deriveSensitiveSlot(element) })
    };
  });
};

export const toPlanResult = (
  tabId: string,
  targetMode: WorkbenchBrowserAgentTargetMode,
  observation: WorkbenchBrowserAgentObservation,
  candidates: readonly WorkbenchBrowserPlanCandidate[]
): WorkbenchBrowserAgentPlanResult => ({
  ok: true,
  kind: "lyraLumenPlan",
  tabId,
  targetMode,
  observationId: observation.observationId,
  candidates,
  message:
    candidates.length === 0
      ? "No actionable plan candidates matched the requested filters."
      : `Prepared ${candidates.length} deterministic action candidate${candidates.length === 1 ? "" : "s"}.`,
  nextRecommendedAction: candidates.length === 0 ? "lyra_lumen.map" : "lyra_lumen.act"
});

export const PROBABLE_REBIND_CONFIDENCE_THRESHOLD = PROBABLE_REBIND_THRESHOLD;