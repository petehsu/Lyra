export const WORKBENCH_ALLOW_SELECT_CLASS = "lyra-allow-select";
export const WORKBENCH_ALLOW_WEB_DRAG_CLASS = "lyra-allow-web-drag";
export const CLASSIC_WORKSPACE_TAB_REORDER_SNAP_PX = 16;
export const CLASSIC_WORKSPACE_TAB_RIGHT_DRAG_THRESHOLD_PX = 10;

export type WorkbenchDragPolicy = {
  readonly allowSelector: string;
  readonly shouldPreventDragStart: (target: EventTarget | null) => boolean;
};

export type WorkspaceTabsInteractionPolicy = {
  readonly reorderSnapPx: number;
  readonly rightDragThresholdPx: number;
  readonly supportsCtrlLeftDragSplit: boolean;
  readonly supportsRightDragSplit: boolean;
};

export type WorkbenchInteractionPolicies = {
  readonly workbenchDrag: WorkbenchDragPolicy;
  readonly workspaceTabs: WorkspaceTabsInteractionPolicy;
};

const resolveTargetElement = (target: EventTarget | null): Element | null => {
  if (target instanceof Element) {
    return target;
  }
  if (target instanceof Node) {
    return target.parentElement;
  }
  return null;
};

const matchesClosestSelector = (target: EventTarget | null, selector: string): boolean => {
  const element = resolveTargetElement(target);
  if (element === null) {
    return false;
  }

  return element.closest(selector) !== null;
};

export const shouldPreventWorkbenchDragStart = (target: EventTarget | null): boolean =>
  matchesClosestSelector(
    target,
    `.${WORKBENCH_ALLOW_WEB_DRAG_CLASS}, [data-lyra-allow-web-drag="true"]`
  ) === false;

export const CLASSIC_WORKBENCH_INTERACTION_POLICIES = {
  workbenchDrag: {
    allowSelector: `.${WORKBENCH_ALLOW_WEB_DRAG_CLASS}, [data-lyra-allow-web-drag="true"]`,
    shouldPreventDragStart: shouldPreventWorkbenchDragStart
  },
  workspaceTabs: {
    reorderSnapPx: CLASSIC_WORKSPACE_TAB_REORDER_SNAP_PX,
    rightDragThresholdPx: CLASSIC_WORKSPACE_TAB_RIGHT_DRAG_THRESHOLD_PX,
    supportsCtrlLeftDragSplit: true,
    supportsRightDragSplit: true
  }
} satisfies WorkbenchInteractionPolicies;
