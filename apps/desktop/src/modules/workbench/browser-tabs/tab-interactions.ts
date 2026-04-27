import type { WorkbenchSplitTriggerMode } from "../preferences";
import type { WorkspaceTabsInteractionPolicy } from "../interaction-policy";

export type WorkspaceTabDropRect = {
  readonly id: string;
  readonly left: number;
  readonly right: number;
};

export type WorkspaceTabDropTarget = {
  readonly targetIndex: number;
  readonly indicatorX: number;
};

export type ResolveWorkspaceTabDropTargetInput = {
  readonly clientX: number;
  readonly hostLeft: number;
  readonly hostWidth: number;
  readonly stripLeft: number;
  readonly tabIds: readonly string[];
  readonly tabRects: readonly WorkspaceTabDropRect[];
  readonly splitGroupTabIds: readonly string[];
  readonly reorderSnapPx: number;
  readonly draggingWorkspaceTabId?: string;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const hasClassicCtrlLeftSplitIntent = (
  splitTriggerMode: WorkbenchSplitTriggerMode,
  ctrlKey: boolean,
  hasSplitHandler: boolean,
  interactionPolicy: WorkspaceTabsInteractionPolicy
): boolean =>
  splitTriggerMode === "ctrl_left_drag" &&
  ctrlKey &&
  hasSplitHandler &&
  interactionPolicy.supportsCtrlLeftDragSplit;

export const isClassicRightDragSplitEnabled = (
  splitTriggerMode: WorkbenchSplitTriggerMode,
  hasSplitHandler: boolean,
  interactionPolicy: WorkspaceTabsInteractionPolicy
): boolean =>
  splitTriggerMode === "right_drag" &&
  hasSplitHandler &&
  interactionPolicy.supportsRightDragSplit;

export const hasMovedPastRightDragThreshold = (
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  thresholdPx: number
): boolean => Math.hypot(currentX - startX, currentY - startY) >= thresholdPx;

export const resolveWorkspaceTabDropTarget = ({
  clientX,
  hostLeft,
  hostWidth,
  stripLeft,
  tabIds,
  tabRects,
  splitGroupTabIds,
  reorderSnapPx,
  draggingWorkspaceTabId
}: ResolveWorkspaceTabDropTargetInput): WorkspaceTabDropTarget => {
  if (tabRects.length === 0) {
    return {
      targetIndex: 0,
      indicatorX: clamp(stripLeft - hostLeft, 0, hostWidth)
    };
  }

  const splitSet = new Set(splitGroupTabIds);
  const splitIndexes = tabIds
    .map((tabId, index) => (splitSet.has(tabId) ? index : -1))
    .filter((index) => index >= 0);
  const normalizeTargetIndex = (candidateIndex: number): number => {
    if (splitIndexes.length < 2) {
      return candidateIndex;
    }
    const first = splitIndexes[0] ?? 0;
    const last = splitIndexes[splitIndexes.length - 1] ?? first;
    const afterLast = last + 1;
    if (candidateIndex <= first || candidateIndex >= afterLast) {
      return candidateIndex;
    }
    const distanceToStart = Math.abs(candidateIndex - first);
    const distanceToEnd = Math.abs(afterLast - candidateIndex);
    return distanceToStart <= distanceToEnd ? first : afterLast;
  };

  const toIndicatorScreenX = (targetIndex: number): number => {
    if (targetIndex <= 0) {
      return tabRects[0]!.left;
    }
    if (targetIndex >= tabRects.length) {
      return tabRects[tabRects.length - 1]!.right;
    }
    return tabRects[targetIndex]!.left;
  };

  if (draggingWorkspaceTabId !== undefined) {
    const draggedIndex = tabIds.findIndex((tabId) => tabId === draggingWorkspaceTabId);
    if (draggedIndex >= 0) {
      const splitFirstIndex = splitIndexes[0] ?? -1;
      const splitLastIndex = splitIndexes[splitIndexes.length - 1] ?? -1;
      const isDraggingSplitGroup =
        splitIndexes.length >= 2 && splitSet.has(draggingWorkspaceTabId);
      const hoveredIndex = tabRects.findIndex((rect) =>
        clientX >= rect.left - reorderSnapPx &&
        clientX <= rect.right + reorderSnapPx
      );

      if (hoveredIndex >= 0) {
        const candidateIndex = isDraggingSplitGroup
          ? hoveredIndex < splitFirstIndex
            ? hoveredIndex
            : hoveredIndex > splitLastIndex
              ? hoveredIndex + 1
              : splitFirstIndex
          : hoveredIndex === draggedIndex
            ? draggedIndex
            : hoveredIndex > draggedIndex
              ? hoveredIndex + 1
              : hoveredIndex;
        const targetIndex = normalizeTargetIndex(candidateIndex);
        return {
          targetIndex,
          indicatorX: clamp(toIndicatorScreenX(targetIndex) - hostLeft, 0, hostWidth)
        };
      }
    }
  }

  let targetIndex = tabRects.length;
  for (let index = 0; index < tabRects.length; index += 1) {
    const rect = tabRects[index];
    if (rect === undefined) {
      continue;
    }
    if (clientX < rect.left + (rect.right - rect.left) / 2) {
      targetIndex = index;
      break;
    }
  }
  targetIndex = normalizeTargetIndex(targetIndex);

  return {
    targetIndex,
    indicatorX: clamp(toIndicatorScreenX(targetIndex) - hostLeft, 0, hostWidth)
  };
};
