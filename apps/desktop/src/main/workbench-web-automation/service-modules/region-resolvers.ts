import type {
  WorkbenchWebFocusAtlas,
  WorkbenchWebTargetCandidate,
  WorkbenchWebTargetIntent,
  WorkbenchWebTargetScanResult,
  WorkbenchWebWidgetScanResult,
} from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebSession } from "../agent-session/types";
import type { LiveSelectorScanCandidateRecord } from "../live-selector/types";

const expandBounds = (
  bounds: WorkbenchWebTargetCandidate["bounds"],
  paddingX: number,
  paddingY: number
): WorkbenchWebTargetCandidate["bounds"] => ({
  x: bounds.x - paddingX,
  y: bounds.y - paddingY,
  width: bounds.width + paddingX * 2,
  height: bounds.height + paddingY * 2
});

export const resolveHoverRevealRegion = ({
  seed,
  widgets,
  containerNodes
}: {
  readonly seed: LiveSelectorScanCandidateRecord;
  readonly widgets: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
  readonly containerNodes: readonly NonNullable<WorkbenchWebWidgetScanResult["containerNodes"]>[number][];
}): WorkbenchWebTargetCandidate["bounds"] => {
  const widget = seed.widgetId === undefined
    ? undefined
    : widgets.find((entry) => entry.widgetId === seed.widgetId);
  const ownerWidget = seed.ownerWidgetId === undefined
    ? undefined
    : widgets.find((entry) => entry.widgetId === seed.ownerWidgetId);
  const container = widget?.containerId === undefined
    ? undefined
    : containerNodes.find((entry) => entry.containerId === widget.containerId);
  const baseBounds = widget?.bounds ?? ownerWidget?.bounds ?? container?.bounds ?? seed.bounds;
  return expandBounds(baseBounds, 180, 96);
};

export const resolveWorkflowRegionForCandidate = ({
  candidate,
  widgets,
  containerNodes
}: {
  readonly candidate: LiveSelectorScanCandidateRecord;
  readonly widgets?: readonly NonNullable<WorkbenchWebTargetScanResult["widgets"]>[number][];
  readonly containerNodes?: readonly NonNullable<WorkbenchWebWidgetScanResult["containerNodes"]>[number][];
}): WorkbenchWebTargetCandidate["bounds"] => {
  const widget = candidate.widgetId === undefined
    ? undefined
    : widgets?.find((entry) => entry.widgetId === candidate.widgetId);
  const ownerWidget = candidate.ownerWidgetId === undefined
    ? undefined
    : widgets?.find((entry) => entry.widgetId === candidate.ownerWidgetId);
  const container = widget?.containerId === undefined
    ? undefined
    : containerNodes?.find((entry) => entry.containerId === widget.containerId);
  return widget?.bounds ?? ownerWidget?.bounds ?? container?.bounds ?? candidate.bounds;
};

export const resolveSessionFocusRegion = (
  session: WorkbenchAgentWebSession | null | undefined,
  intent: WorkbenchWebTargetIntent
): WorkbenchWebFocusAtlas["regions"][number]["bounds"] | undefined => {
  if (session === null || session === undefined) {
    return undefined;
  }

  const subgoal = session.currentSubgoal?.trim().toLowerCase();
  const useWorkflowRegion = (): WorkbenchWebTargetCandidate["bounds"] | undefined =>
    session.revealRegion ?? session.workflowRegion;

  switch (intent.operation) {
    case "type":
      return subgoal === "locate composer" || subgoal === "type" || subgoal === "submit"
        ? useWorkflowRegion()
        : undefined;
    case "focus":
      return subgoal === "locate composer"
        || subgoal === "type"
        || subgoal === "submit"
        || subgoal === "locate target"
        ? useWorkflowRegion()
        : undefined;
    case "select":
      return subgoal === "toggle mode" ? useWorkflowRegion() : undefined;
    case "click":
    case "hover":
    case "submit":
    default:
      return useWorkflowRegion();
  }
};
