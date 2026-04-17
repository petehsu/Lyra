import type {
  WorkbenchWebFocusAtlas,
  WorkbenchWebSurfaceAffordanceHint,
  WorkbenchWebSurfaceModel,
  WorkbenchWebSurfaceControl,
} from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebSession } from "../agent-session/types";
import type { LiveSelectorScanCandidateRecord } from "./types";

const normalizeText = (value: string | undefined): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const labelForCandidate = (candidate: LiveSelectorScanCandidateRecord): string => {
  const label =
    normalizeText(candidate.itemIdentity?.label)
    || normalizeText(candidate.ariaLabel)
    || normalizeText(candidate.placeholder)
    || normalizeText(candidate.textSnippet)
    || normalizeText(candidate.affordanceLabel)
    || normalizeText(candidate.selectorPreview);
  return label.length > 0 ? label : `<${candidate.tagName.toLowerCase()}>`;
};

const actionLabelForCandidate = (candidate: LiveSelectorScanCandidateRecord): string | undefined => {
  const affordance = normalizeText(candidate.affordanceAction);
  if (affordance.length > 0) {
    return affordance;
  }
  if (candidate.interactable.typable) {
    return "type";
  }
  if (candidate.interactable.selectable) {
    return "select";
  }
  if (candidate.interactable.clickable) {
    return candidate.widgetKind === "menu-trigger" ? "open menu" : "click";
  }
  if (candidate.interactable.focusable) {
    return "focus";
  }
  return undefined;
};

const descriptionForCandidate = (candidate: LiveSelectorScanCandidateRecord): string | undefined => {
  const parts = [
    normalizeText(candidate.affordanceLabel),
    normalizeText(candidate.stateHint),
    normalizeText(candidate.tooltipText),
  ].filter((value) => value.length > 0);
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join(" · ");
};

const candidateKey = (candidate: LiveSelectorScanCandidateRecord): string =>
  `${candidate.frameTreeNodeId}:${candidate.selectorAddress.path}`;

const controlFromCandidate = (
  candidate: LiveSelectorScanCandidateRecord,
  focusAtlas?: WorkbenchWebFocusAtlas | null,
  session?: WorkbenchAgentWebSession | null,
): WorkbenchWebSurfaceControl => ({
  controlId: candidate.candidateId,
  ...(candidate.widgetId === undefined ? {} : { widgetId: candidate.widgetId }),
  ...(candidate.ownerWidgetId === undefined ? {} : { ownerWidgetId: candidate.ownerWidgetId }),
  ...(candidate.widgetKind === undefined ? {} : { widgetKind: candidate.widgetKind }),
  ...(candidate.itemIdentity === undefined ? {} : { itemIdentity: candidate.itemIdentity }),
  label: labelForCandidate(candidate),
  ...(actionLabelForCandidate(candidate) === undefined
    ? {}
    : { actionLabel: actionLabelForCandidate(candidate) }),
  ...(descriptionForCandidate(candidate) === undefined
    ? {}
    : { description: descriptionForCandidate(candidate) }),
  bounds: candidate.bounds,
  ...(session?.hoveredCandidateId === candidate.candidateId ? { hovered: true } : {}),
  ...(session?.activeWidgetId !== undefined
      && (candidate.widgetId === session.activeWidgetId || candidate.ownerWidgetId === session.activeWidgetId)
    ? { active: true }
    : {}),
  ...(candidate.discoveryMode !== undefined ? { revealed: true } : {}),
  humanOperable: candidate.isHumanOperable !== false,
  ...(normalizeText(candidate.cursorStyle).length === 0 ? {} : { cursorStyle: normalizeText(candidate.cursorStyle) }),
  ...(normalizeText(candidate.tooltipText).length === 0 ? {} : { tooltipText: normalizeText(candidate.tooltipText) }),
  ...(candidate.focusOrder === undefined ? {} : { focusOrder: candidate.focusOrder }),
  ...(candidate.focusRegionId === undefined ? {} : { focusRegionId: candidate.focusRegionId }),
  ...(candidate.atlasConfidence === undefined ? {} : { atlasConfidence: candidate.atlasConfidence }),
  ...(focusAtlas?.activeFocusRegionId !== undefined && candidate.focusRegionId === focusAtlas.activeFocusRegionId
    ? { inActiveFocusRegion: true }
    : {}),
});

const hintsFromSession = (session?: WorkbenchAgentWebSession | null): readonly WorkbenchWebSurfaceAffordanceHint[] => {
  if (session?.lastLocalDelta === undefined) {
    return [];
  }
  const hints: WorkbenchWebSurfaceAffordanceHint[] = [];
  for (const kind of session.lastLocalDelta.kinds) {
    switch (kind) {
      case "revealed_controls_added":
        hints.push({ kind: "reveal", label: "New nearby controls appeared" });
        break;
      case "menu_opened":
        hints.push({ kind: "reveal", label: "A local menu opened" });
        break;
      case "tooltip_opened":
        hints.push({
          kind: "tooltip",
          label: "A tooltip or inline explanation appeared",
          ...(normalizeText(session.lastLocalDelta.tooltipText).length === 0
            ? {}
            : { detail: normalizeText(session.lastLocalDelta.tooltipText) })
        });
        break;
      case "cursor_changed":
        hints.push({
          kind: "cursor",
          label: "Pointer affordance changed",
          ...(normalizeText(session.lastLocalDelta.cursorStyle).length === 0
            ? {}
            : { detail: normalizeText(session.lastLocalDelta.cursorStyle) })
        });
        break;
      case "focus_group_changed":
        hints.push({ kind: "focus", label: "The local operable map changed" });
        break;
      case "focus_target_added":
        hints.push({ kind: "focus", label: "A new nearby focus target appeared" });
        break;
      case "focus_target_removed":
        hints.push({ kind: "focus", label: "A nearby focus target disappeared" });
        break;
      case "focus_region_changed":
        hints.push({ kind: "focus", label: "The active focus region changed" });
        break;
      case "region_expanded":
        hints.push({ kind: "state", label: "The nearby region expanded" });
        break;
      case "region_collapsed":
        hints.push({ kind: "state", label: "The nearby region collapsed" });
        break;
      case "toggle_state_changed":
        hints.push({ kind: "state", label: "The local selection state changed" });
        break;
      case "list_item_removed":
        hints.push({ kind: "state", label: "A list item was removed" });
        break;
      case "composer_state_changed":
        hints.push({ kind: "state", label: "The current composer or result region changed" });
        break;
      case "hover_state_changed":
        hints.push({ kind: "reveal", label: "Hover changed the nearby controls" });
        break;
      default:
        break;
    }
  }
  return hints;
};

export const buildSurfaceModel = ({
  candidates,
  focusAtlas,
  session,
}: {
  readonly candidates: readonly LiveSelectorScanCandidateRecord[];
  readonly focusAtlas?: WorkbenchWebFocusAtlas | null;
  readonly session?: WorkbenchAgentWebSession | null;
}): WorkbenchWebSurfaceModel => {
  const seen = new Set<string>();
  const controls: WorkbenchWebSurfaceControl[] = [];
  for (const candidate of candidates) {
    if (candidate.isHumanOperable === false) {
      continue;
    }
    const key = candidateKey(candidate);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    controls.push(controlFromCandidate(candidate, focusAtlas, session));
    if (controls.length >= 12) {
      break;
    }
  }

  return {
    ...(session?.hoveredCandidateId === undefined ? {} : { pointerTargetId: session.hoveredCandidateId }),
    ...(session?.hoveredCandidateId === undefined ? {} : { hoverTargetId: session.hoveredCandidateId }),
    ...(session?.activeWidgetId === undefined ? {} : { activeWidgetId: session.activeWidgetId }),
    ...(session?.activeItemId === undefined ? {} : { activeItemId: session.activeItemId }),
    controls,
    hints: hintsFromSession(session),
    ...(session?.workflowRegion === undefined
      ? {}
      : {
          workflowRegion: {
            kind: "workflow",
            label: "Current workflow region",
            bounds: session.workflowRegion,
          }
        }),
    ...(session?.revealRegion === undefined
      ? {}
      : {
          revealRegion: {
            kind: "reveal",
            label: "Current reveal region",
            bounds: session.revealRegion,
          }
        })
  };
};
