import type { WorkbenchBrowserAgentTargetInfo } from "../../../shared/desktop-bridge";
import type { WorkbenchWebElementBounds } from "../../../shared/workbench-web-automation";

export type WorkbenchAgentWebLocalDeltaKind =
  | "revealed_controls_added"
  | "menu_opened"
  | "tooltip_opened"
  | "cursor_changed"
  | "focus_group_changed"
  | "focus_target_added"
  | "focus_target_removed"
  | "focus_region_changed"
  | "region_expanded"
  | "region_collapsed"
  | "hover_state_changed"
  | "toggle_state_changed"
  | "list_item_removed"
  | "composer_state_changed";

export type WorkbenchAgentWebPointerState = {
  readonly x: number;
  readonly y: number;
  readonly frameTreeNodeId?: number;
  readonly updatedAt: number;
};

export type WorkbenchAgentWebLocalDelta = {
  readonly kinds: readonly WorkbenchAgentWebLocalDeltaKind[];
  readonly observedAt: number;
  readonly candidateCount?: number;
  readonly cursorStyle?: string;
  readonly tooltipText?: string;
  readonly stateHint?: string;
  readonly workflowRegion?: WorkbenchWebElementBounds;
  readonly revealRegion?: WorkbenchWebElementBounds;
};

export type WorkbenchAgentWebSession = {
  readonly sessionKey: string;
  readonly agentSessionId: string;
  readonly agentTurnId: string;
  readonly tabId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly scanSessionId?: string;
  readonly currentTarget?: WorkbenchBrowserAgentTargetInfo;
  readonly activeWidgetId?: string;
  readonly activeItemId?: string;
  readonly currentSubgoal?: string;
  readonly pointer?: WorkbenchAgentWebPointerState;
  readonly hoveredCandidateId?: string;
  readonly hoveredWidgetId?: string;
  readonly hoveredItemId?: string;
  readonly workflowRegion?: WorkbenchWebElementBounds;
  readonly revealRegion?: WorkbenchWebElementBounds;
  readonly lastLocalDelta?: WorkbenchAgentWebLocalDelta;
  readonly currentCursorStyle?: string;
  readonly lastRevealObserved?: boolean;
  readonly focusAtlasVersion?: string;
  readonly activeFocusRegionId?: string;
  readonly lastFocusProbeVerified?: boolean;
  readonly lastFocusDeltaObserved?: boolean;
  readonly lastVerifiedTransition?: string;
  readonly lastFailureCode?: string;
};
