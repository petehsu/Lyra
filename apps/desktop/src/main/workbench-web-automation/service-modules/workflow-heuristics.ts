import type {
  WorkbenchWebAction,
  WorkbenchWebActionResult,
  WorkbenchWebTargetIntent,
} from "../../../shared/workbench-web-automation";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";

export const inferSubgoalFromIntent = (intent: WorkbenchWebTargetIntent): string => {
  switch (intent.operation) {
    case "hover":
      return "reveal item actions";
    case "submit":
      return "submit";
    case "type":
      return "locate composer";
    case "click":
      return "locate item";
    case "select":
      return "toggle mode";
    case "focus":
    default:
      return "locate target";
  }
};

export const resolveActiveItemId = (
  candidate: Pick<LiveSelectorScanCandidateRecord, "widgetId" | "ownerWidgetId" | "widgetKind">
): string | undefined => {
  if (candidate.widgetKind === "list-item") {
    return candidate.widgetId;
  }
  return candidate.ownerWidgetId;
};

export const inferSubgoalFromAction = (action: WorkbenchWebAction): string => {
  switch (action.kind) {
    case "hover":
      return "reveal item actions";
    case "click":
      return "execute menu action";
    case "type":
    case "clear_and_type":
      return "type";
    case "press_key":
    case "submit_form":
      return "submit";
    case "select_option":
    case "set_checked":
      return "toggle mode";
    case "focus":
      return "locate composer";
    case "goto_url":
    case "open_link_node":
    case "history_back":
    case "history_forward":
    case "reload":
      return "navigate";
    default:
      return "act";
  }
};

export const isActionRevealTriggerCandidate = (
  candidate: Pick<
    LiveSelectorScanCandidateRecord,
    "widgetKind" | "affordanceAction" | "ariaLabel" | "affordanceLabel" | "tooltipText" | "stateHint"
  >
): boolean => {
  if (
    candidate.widgetKind === "menu-trigger"
    || candidate.widgetKind === "mode-switcher"
    || candidate.widgetKind === "toggle-group"
  ) {
    return true;
  }

  const action = candidate.affordanceAction?.trim().toLowerCase();
  if (action === "open menu" || action === "expand") {
    return true;
  }
  return candidate.stateHint === "collapsed" || candidate.stateHint === "expanded";
};

export const shouldResetWorkflowContext = (
  result: Pick<WorkbenchWebActionResult, "verification" | "actionKind">
): boolean => {
  if (
    result.actionKind === "goto_url"
    || result.actionKind === "history_back"
    || result.actionKind === "history_forward"
    || result.actionKind === "reload"
    || result.actionKind === "open_link_node"
  ) {
    return true;
  }
  if (result.verification?.stateTransition !== "navigation_changed") {
    return false;
  }
  if (result.actionKind !== "click") {
    return true;
  }
  const widgetKind = result.verification?.widgetKind;
  if (
    widgetKind === "menu-trigger"
    || widgetKind === "toggle-group"
    || widgetKind === "mode-switcher"
    || widgetKind === "list-item"
    || widgetKind === "history-item"
    || widgetKind === "history-list"
    || widgetKind === "sidebar"
    || widgetKind === "navigation"
  ) {
    return false;
  }
  return true;
};

export const isRevealStateTransition = (
  transition: NonNullable<WorkbenchWebActionResult["verification"]>["stateTransition"] | undefined
): boolean =>
  transition === "menu_opened"
  || transition === "region_expanded"
  || transition === "state_changed";
