import type { WorkbenchWebActionResult, WorkbenchWebElementBounds } from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebLocalDelta } from "../agent-session/types";
import type { LiveSelectorScanCandidateRecord } from "./types";

const toKey = (candidate: LiveSelectorScanCandidateRecord): string =>
  `${candidate.selectorAddress.frameTreeNodeId}:${candidate.selectorAddress.path}`;

export const deriveLocalDeltaFromReveal = ({
  baseline,
  revealed,
  workflowRegion,
  revealRegion,
}: {
  readonly baseline: readonly LiveSelectorScanCandidateRecord[];
  readonly revealed: readonly LiveSelectorScanCandidateRecord[];
  readonly workflowRegion?: WorkbenchWebElementBounds;
  readonly revealRegion?: WorkbenchWebElementBounds;
}): WorkbenchAgentWebLocalDelta | undefined => {
  const baselineKeys = new Set(baseline.map(toKey));
  const newCandidates = revealed.filter((candidate) => !baselineKeys.has(toKey(candidate)));
  if (newCandidates.length === 0) {
    return undefined;
  }
  const tooltipCandidate = newCandidates.find((candidate) =>
    typeof candidate.tooltipText === "string" && candidate.tooltipText.trim().length > 0
  );
  const cursorCandidate = newCandidates.find((candidate) =>
    typeof candidate.cursorStyle === "string" && candidate.cursorStyle.trim().length > 0
  );
  const stateHintCandidate = newCandidates.find((candidate) =>
    typeof candidate.stateHint === "string" && candidate.stateHint.trim().length > 0
  );
  return {
    kinds: [
      "revealed_controls_added",
      ...(tooltipCandidate === undefined ? [] : ["tooltip_opened"] as const),
      ...(cursorCandidate === undefined ? [] : ["cursor_changed"] as const),
      "hover_state_changed"
    ],
    observedAt: Date.now(),
    candidateCount: newCandidates.length,
    ...(cursorCandidate?.cursorStyle === undefined ? {} : { cursorStyle: cursorCandidate.cursorStyle }),
    ...(tooltipCandidate?.tooltipText === undefined ? {} : { tooltipText: tooltipCandidate.tooltipText }),
    ...(stateHintCandidate?.stateHint === undefined ? {} : { stateHint: stateHintCandidate.stateHint }),
    ...(workflowRegion === undefined ? {} : { workflowRegion }),
    ...(revealRegion === undefined ? {} : { revealRegion })
  };
};

export const deriveLocalDeltaFromVerification = ({
  result,
  workflowRegion,
  revealRegion,
}: {
  readonly result: WorkbenchWebActionResult;
  readonly workflowRegion?: WorkbenchWebElementBounds;
  readonly revealRegion?: WorkbenchWebElementBounds;
}): WorkbenchAgentWebLocalDelta | undefined => {
  const transition = result.verification?.stateTransition;
  if (transition === undefined || transition === "none") {
    return undefined;
  }
  const kinds: WorkbenchAgentWebLocalDelta["kinds"] = (() => {
    switch (transition) {
      case "menu_opened":
        return ["menu_opened"];
      case "conversation_deleted":
        return ["list_item_removed"];
      case "model_changed":
        return ["toggle_state_changed"];
      case "focus_changed":
        return ["hover_state_changed"];
      case "region_expanded":
        return ["region_expanded"];
      case "state_changed":
      case "validation_changed":
        return ["toggle_state_changed"];
      case "response_started":
        return ["composer_state_changed", "region_expanded"];
      case "message_submitted":
      case "value_changed":
        return ["composer_state_changed"];
      default:
        return [];
    }
  })();
  const cursorChanged =
    typeof result.verification?.cursorStyle === "string"
    && result.verification.cursorStyle.trim().length > 0;
  const tooltipOpened =
    typeof result.verification?.tooltipText === "string"
    && result.verification.tooltipText.trim().length > 0;
  const stateHint = result.verification?.affordanceHints?.find((entry) => entry.kind === "state")?.detail;
  const nextKinds = [
    ...kinds,
    ...(cursorChanged ? ["cursor_changed"] as const : []),
    ...(tooltipOpened ? ["tooltip_opened"] as const : []),
  ];
  if (nextKinds.length === 0) {
    return undefined;
  }
  return {
    kinds: nextKinds,
    observedAt: Date.now(),
    ...(result.verification?.cursorStyle === undefined ? {} : { cursorStyle: result.verification.cursorStyle }),
    ...(result.verification?.tooltipText === undefined ? {} : { tooltipText: result.verification.tooltipText }),
    ...(stateHint === undefined ? {} : { stateHint }),
    ...(workflowRegion === undefined ? {} : { workflowRegion }),
    ...(revealRegion === undefined ? {} : { revealRegion })
  };
};
