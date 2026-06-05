import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent
} from "react";

import type { WorkspaceTabsInteractionPolicy } from "../interaction-policy";
import type { WorkbenchSplitTriggerMode } from "../preferences";
import {
  clearTerminalTabDragPayload,
  readTerminalTabDragPayload,
  setTerminalTabDragImage,
  writeTerminalTabDragPayload
} from "../terminal-dock/drag-transfer";
import type { WorkspaceTab } from "../workspace-tabs/types";
import {
  hasClassicCtrlLeftSplitIntent,
  hasMovedPastRightDragThreshold,
  isClassicRightDragSplitEnabled,
  resolveWorkspaceTabDropTarget
} from "./tab-interactions";
import type {
  BrowserTabDropRequest,
  RightDragPreview,
  RightDragState,
  SplitHoverTarget
} from "./tab-strip-types";
import {
  clearWorkspaceTabDragPayload,
  hasWorkspaceTabDragPayload,
  readWorkspaceTabDragPayload,
  writeWorkspaceTabDragPayload
} from "./workspace-drag-transfer";

type UseBrowserTabStripRuntimeInput = {
  readonly tabs: readonly WorkspaceTab[];
  readonly splitGroupTabIds: readonly string[];
  readonly splitTriggerMode: WorkbenchSplitTriggerMode;
  readonly interactionPolicy: WorkspaceTabsInteractionPolicy;
  readonly onTabContextMenu?: ((
    tab: WorkspaceTab,
    anchorX: number,
    anchorY: number
  ) => void) | undefined;
  readonly onDropTerminalDockTab?: ((request: BrowserTabDropRequest) => void) | undefined;
  readonly onReorderTabs?: ((tabId: string, targetIndex: number) => void) | undefined;
  readonly onSplitTabs?: ((sourceTabId: string, targetTabId: string) => void) | undefined;
  readonly onDetachTabFromSplit?: ((tabId: string) => void) | undefined;
};

type WorkspaceTabSortState = {
  readonly tabId: string;
  readonly startClientX: number;
  readonly startX: number;
  readonly positions: readonly number[];
  readonly lastTargetIndex: number;
};

export type BrowserTabStripRuntimeState = {
  readonly isTerminalDropActive: boolean;
  readonly dropIndicatorX: number | null;
  readonly isSplitDropActive: boolean;
  readonly splitDropTargetTabId: string | null;
  readonly workspaceDragTabId: string | null;
  readonly rightDragPreview: RightDragPreview | null;
};

export type BrowserTabStripRuntime = {
  readonly navRef: RefObject<HTMLElement>;
  readonly state: BrowserTabStripRuntimeState;
  readonly onTabBarDragOver: (event: ReactDragEvent<HTMLElement>) => void;
  readonly onTabBarDragLeave: (event: ReactDragEvent<HTMLElement>) => void;
  readonly onTabBarDrop: (event: ReactDragEvent<HTMLElement>) => void;
  readonly onTabStripWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  readonly onTabItemMouseDown: (
    event: ReactMouseEvent<HTMLElement>,
    tabId: string
  ) => void;
  readonly onTabItemMouseUp: (
    event: ReactMouseEvent<HTMLElement>,
    tab: WorkspaceTab
  ) => void;
  readonly onWorkspaceTabDragStart: (
    event: ReactDragEvent<HTMLElement>,
    tab: WorkspaceTab
  ) => void;
  readonly onTabItemContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  readonly onTabDragEnd: () => void;
};

const closestPositionIndex = (
  value: number,
  positions: readonly number[]
): number => {
  let closestDistance = Infinity;
  let closestIndex = -1;
  positions.forEach((position, index) => {
    const distance = Math.abs(value - position);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  });
  return closestIndex;
};

export const useBrowserTabStripRuntime = ({
  tabs,
  splitGroupTabIds,
  splitTriggerMode,
  interactionPolicy,
  onTabContextMenu,
  onDropTerminalDockTab,
  onReorderTabs,
  onSplitTabs,
  onDetachTabFromSplit
}: UseBrowserTabStripRuntimeInput): BrowserTabStripRuntime => {
  const navRef = useRef<HTMLElement | null>(null);
  const rightDragRef = useRef<RightDragState | null>(null);
  const workspaceSortRef = useRef<WorkspaceTabSortState | null>(null);
  const suppressContextMenuRef = useRef(false);

  const [isTerminalDropActive, setIsTerminalDropActive] = useState(false);
  const [dropIndicatorX, setDropIndicatorX] = useState<number | null>(null);
  const [isSplitDropActive, setIsSplitDropActive] = useState(false);
  const [splitDropTargetTabId, setSplitDropTargetTabId] = useState<string | null>(null);
  const [workspaceDragTabId, setWorkspaceDragTabId] = useState<string | null>(null);
  const [rightDragPreview, setRightDragPreview] = useState<RightDragPreview | null>(null);

  const clearDragUiState = useCallback((): void => {
    setIsTerminalDropActive(false);
    setDropIndicatorX(null);
    setIsSplitDropActive(false);
    setSplitDropTargetTabId(null);
    setWorkspaceDragTabId(null);
    setRightDragPreview(null);
  }, []);

  const clearWorkspaceSortState = useCallback((): void => {
    workspaceSortRef.current = null;
  }, []);

  const clearAllDragPayloads = useCallback((): void => {
    clearWorkspaceTabDragPayload();
    clearTerminalTabDragPayload();
  }, []);

  const resolveDockDraggedTerminalTabId = useCallback(
    (event: ReactDragEvent<HTMLElement>): string | null => {
      const payload = readTerminalTabDragPayload(event.dataTransfer);
      if (payload === null || payload.source !== "dock") {
        return null;
      }
      return payload.tabId;
    },
    []
  );

  const resolveWorkspaceDropTarget = useCallback(
    (
      event: ReactDragEvent<HTMLElement>,
      draggingWorkspaceTabId?: string
    ) => {
      const host = event.currentTarget;
      const strip = host.querySelector<HTMLElement>(".lyra-browser-tab-strip");
      if (strip === null) {
        return {
          targetIndex: tabs.length,
          indicatorX: 0
        };
      }

      const stripRect = strip.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const tabElements = Array.from(
        strip.querySelectorAll<HTMLElement>(".lyra-browser-tab-item[data-lyra-tab-id]")
      );

      return resolveWorkspaceTabDropTarget({
        clientX: event.clientX,
        hostLeft: hostRect.left,
        hostWidth: hostRect.width,
        stripLeft: stripRect.left,
        tabIds: tabs.map((tab) => tab.id),
        tabRects: tabElements.map((tabElement, index) => {
          const rect = tabElement.getBoundingClientRect();
          return {
            id: tabElement.dataset.lyraTabId ?? tabs[index]?.id ?? "",
            left: rect.left,
            right: rect.right
          };
        }),
        splitGroupTabIds,
        reorderSnapPx: interactionPolicy.reorderSnapPx,
        ...(draggingWorkspaceTabId === undefined ? {} : { draggingWorkspaceTabId })
      });
    },
    [interactionPolicy.reorderSnapPx, splitGroupTabIds, tabs]
  );

  const resolveSplitHoverFromNode = useCallback((target: EventTarget | null): SplitHoverTarget => {
    const host = navRef.current;
    if (host === null || target instanceof Node === false) {
      return {
        tabId: null,
        isInsideStrip: false
      };
    }

    if (host.contains(target) === false) {
      return {
        tabId: null,
        isInsideStrip: false
      };
    }

    const strip = host.querySelector<HTMLElement>(".lyra-browser-tab-strip");
    const isInsideStrip = strip?.contains(target) ?? false;
    const tabElement = target instanceof Element
      ? target.closest<HTMLElement>(".lyra-browser-tab-item[data-lyra-tab-id]")
      : null;

    return {
      tabId: tabElement?.dataset.lyraTabId ?? null,
      isInsideStrip
    };
  }, []);

  const resolveSplitHoverFromPoint = useCallback((clientX: number, clientY: number): SplitHoverTarget => {
    const node = document.elementFromPoint(clientX, clientY);
    return resolveSplitHoverFromNode(node);
  }, [resolveSplitHoverFromNode]);

  const setSplitGroupDragImage = useCallback((
    dataTransfer: DataTransfer,
    draggingTabId: string,
    clientX: number,
    clientY: number
  ): boolean => {
    const splitSet = new Set(splitGroupTabIds);
    if (splitSet.size < 2 || splitSet.has(draggingTabId) === false) {
      return false;
    }

    const host = navRef.current;
    if (host === null) {
      return false;
    }
    const strip = host.querySelector<HTMLElement>(".lyra-browser-tab-strip");
    if (strip === null) {
      return false;
    }

    const tabElements = Array.from(
      strip.querySelectorAll<HTMLElement>(".lyra-browser-tab-item[data-lyra-tab-id]")
    );
    const groupElements = tabElements.filter((element) => {
      const tabId = element.dataset.lyraTabId;
      return tabId !== undefined && splitSet.has(tabId);
    });
    if (groupElements.length < 2) {
      return false;
    }

    const firstRect = groupElements[0]!.getBoundingClientRect();
    const lastRect = groupElements[groupElements.length - 1]!.getBoundingClientRect();
    const groupLeft = firstRect.left;
    const groupTop = firstRect.top;
    const groupWidth = Math.max(1, lastRect.right - groupLeft);
    const groupHeight = Math.max(1, firstRect.height);
    const offsetX = Math.max(1, Math.min(groupWidth - 1, clientX - groupLeft));
    const offsetY = Math.max(1, Math.min(groupHeight - 1, clientY - groupTop));

    const ghost = document.createElement("div");
    ghost.style.position = "fixed";
    ghost.style.left = "-99999px";
    ghost.style.top = "-99999px";
    ghost.style.display = "inline-flex";
    ghost.style.alignItems = "stretch";
    ghost.style.pointerEvents = "none";
    ghost.style.opacity = "0.98";
    ghost.style.zIndex = "2147483647";
    ghost.setAttribute("aria-hidden", "true");

    for (const element of groupElements) {
      const rect = element.getBoundingClientRect();
      const clone = element.cloneNode(true);
      if (clone instanceof HTMLElement === false) {
        continue;
      }
      clone.style.width = `${Math.round(rect.width)}px`;
      clone.style.minWidth = `${Math.round(rect.width)}px`;
      clone.style.maxWidth = `${Math.round(rect.width)}px`;
      clone.style.height = `${Math.round(rect.height)}px`;
      clone.style.margin = "0";
      clone.style.pointerEvents = "none";
      clone.classList.add("lyra-browser-tab-item-split-group-dragging");
      ghost.append(clone);
    }

    if (ghost.childElementCount < 2) {
      return false;
    }

    document.body.append(ghost);
    dataTransfer.setDragImage(ghost, offsetX, offsetY);
    window.setTimeout(() => {
      ghost.remove();
    }, 0);
    return true;
  }, [splitGroupTabIds]);

  const beginWorkspaceTabSort = useCallback((
    tabId: string,
    startClientX: number
  ): void => {
    const host = navRef.current;
    const strip = host?.querySelector<HTMLElement>(".lyra-browser-tab-strip") ?? null;
    if (strip === null) {
      workspaceSortRef.current = null;
      return;
    }

    const stripRect = strip.getBoundingClientRect();
    const tabElements = Array.from(
      strip.querySelectorAll<HTMLElement>(".lyra-browser-tab-item[data-lyra-tab-id]")
    );
    const sourceIndex = tabElements.findIndex(
      (element) => element.dataset.lyraTabId === tabId
    );
    if (sourceIndex === -1) {
      workspaceSortRef.current = null;
      return;
    }

    const positions = tabElements.map((element) =>
      element.getBoundingClientRect().left - stripRect.left
    );
    workspaceSortRef.current = {
      tabId,
      startClientX,
      startX: positions[sourceIndex] ?? 0,
      positions,
      lastTargetIndex: sourceIndex
    };
  }, []);

  const resolveLiveWorkspaceReorderTarget = useCallback((
    tabId: string,
    clientX: number
  ): number | null => {
    const sort = workspaceSortRef.current;
    if (sort === null || sort.tabId !== tabId || sort.positions.length === 0) {
      return null;
    }
    const targetIndex = closestPositionIndex(
      sort.startX + clientX - sort.startClientX,
      sort.positions
    );
    return targetIndex === -1 ? null : targetIndex;
  }, []);

  const onWorkspaceTabDragStart = useCallback(
    (event: ReactDragEvent<HTMLElement>, tab: WorkspaceTab): void => {
      const splitIntent = hasClassicCtrlLeftSplitIntent(
        splitTriggerMode,
        event.ctrlKey,
        onSplitTabs !== undefined,
        interactionPolicy
      );
      writeWorkspaceTabDragPayload(event.dataTransfer, tab.id, splitIntent ? "split" : "reorder");
      setWorkspaceDragTabId(splitIntent ? null : tab.id);
      if (!splitIntent) {
        beginWorkspaceTabSort(tab.id, event.clientX);
      } else {
        clearWorkspaceSortState();
      }
      if (tab.pageKind === "terminal" && tab.terminalTabId !== undefined) {
        writeTerminalTabDragPayload(event.dataTransfer, {
          source: "workspace",
          tabId: tab.terminalTabId
        });
      }
      const handledBySplitGroup = splitIntent
        ? false
        : setSplitGroupDragImage(event.dataTransfer, tab.id, event.clientX, event.clientY);
      if (handledBySplitGroup === false) {
        setTerminalTabDragImage(
          event.dataTransfer,
          event.currentTarget,
          event.clientX,
          event.clientY
        );
      }
    },
    [
      beginWorkspaceTabSort,
      clearWorkspaceSortState,
      interactionPolicy,
      onSplitTabs,
      setSplitGroupDragImage,
      splitTriggerMode
    ]
  );

  const onTabBarDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const workspacePayloadAvailable = hasWorkspaceTabDragPayload(event.dataTransfer);
      const workspacePayload = workspacePayloadAvailable
        ? readWorkspaceTabDragPayload(event.dataTransfer)
        : null;

      if (
        workspacePayload !== null &&
        workspacePayload.intent === "split" &&
        onSplitTabs !== undefined
      ) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const hoverTarget = resolveSplitHoverFromNode(event.target);
        setSplitDropTargetTabId(
          hoverTarget.tabId === workspacePayload.tabId ? null : hoverTarget.tabId
        );
        setIsSplitDropActive(true);
        setDropIndicatorX(null);
        setIsTerminalDropActive(false);
        return;
      }

      if (
        workspacePayload !== null &&
        workspacePayload.intent === "reorder" &&
        onReorderTabs !== undefined
      ) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const liveTargetIndex = resolveLiveWorkspaceReorderTarget(
          workspacePayload.tabId,
          event.clientX
        );
        if (liveTargetIndex !== null) {
          const sort = workspaceSortRef.current;
          const currentIndex = tabs.findIndex((tab) => tab.id === workspacePayload.tabId);
          if (
            sort !== null &&
            liveTargetIndex !== sort.lastTargetIndex &&
            currentIndex !== -1 &&
            currentIndex !== liveTargetIndex
          ) {
            workspaceSortRef.current = {
              ...sort,
              lastTargetIndex: liveTargetIndex
            };
            onReorderTabs(workspacePayload.tabId, liveTargetIndex);
          }
          setDropIndicatorX(null);
          setIsTerminalDropActive(false);
          setIsSplitDropActive(false);
          setSplitDropTargetTabId(null);
          return;
        }
        const target = resolveWorkspaceDropTarget(event, workspacePayload.tabId);
        setDropIndicatorX(target.indicatorX);
        setIsTerminalDropActive(false);
        setIsSplitDropActive(false);
        setSplitDropTargetTabId(null);
        return;
      }

      const terminalTabId = resolveDockDraggedTerminalTabId(event);
      if (terminalTabId !== null && onDropTerminalDockTab !== undefined) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const target = resolveWorkspaceDropTarget(event);
        setDropIndicatorX(target.indicatorX);
        if (isTerminalDropActive === false) {
          setIsTerminalDropActive(true);
        }
        setIsSplitDropActive(false);
        setSplitDropTargetTabId(null);
        return;
      }

      clearDragUiState();
    },
    [
      clearDragUiState,
      isTerminalDropActive,
      onDropTerminalDockTab,
      onReorderTabs,
      onSplitTabs,
      resolveLiveWorkspaceReorderTarget,
      resolveDockDraggedTerminalTabId,
      resolveSplitHoverFromNode,
      resolveWorkspaceDropTarget
    ]
  );

  const onTabBarDragLeave = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return;
      }
      clearDragUiState();
    },
    [clearDragUiState]
  );

  const onTabBarDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      const workspacePayload = readWorkspaceTabDragPayload(event.dataTransfer);
      if (workspacePayload !== null && workspacePayload.intent === "split") {
        if (onSplitTabs !== undefined) {
          event.preventDefault();
          const hoverTarget = resolveSplitHoverFromNode(event.target);
          if (
            hoverTarget.tabId !== null &&
            hoverTarget.tabId !== workspacePayload.tabId
          ) {
            onSplitTabs(workspacePayload.tabId, hoverTarget.tabId);
          } else if (hoverTarget.isInsideStrip) {
            onDetachTabFromSplit?.(workspacePayload.tabId);
          }
        }
        clearAllDragPayloads();
        clearDragUiState();
        return;
      }

      if (workspacePayload !== null && onReorderTabs !== undefined) {
        const sort = workspaceSortRef.current;
        if (sort !== null && sort.tabId === workspacePayload.tabId) {
          event.preventDefault();
          clearWorkspaceSortState();
          clearAllDragPayloads();
          clearDragUiState();
          return;
        }
        const target = resolveWorkspaceDropTarget(event, workspacePayload.tabId);
        event.preventDefault();
        onReorderTabs(workspacePayload.tabId, target.targetIndex);
        clearAllDragPayloads();
        clearDragUiState();
        return;
      }

      const terminalTabId = resolveDockDraggedTerminalTabId(event);
      if (terminalTabId !== null && onDropTerminalDockTab !== undefined) {
        const target = resolveWorkspaceDropTarget(event);
        event.preventDefault();
        onDropTerminalDockTab({
          terminalTabId,
          targetIndex: target.targetIndex
        });
      }

      clearAllDragPayloads();
      clearDragUiState();
    },
    [
      clearAllDragPayloads,
      clearDragUiState,
      clearWorkspaceSortState,
      onDetachTabFromSplit,
      onDropTerminalDockTab,
      onReorderTabs,
      onSplitTabs,
      resolveDockDraggedTerminalTabId,
      resolveSplitHoverFromNode,
      resolveWorkspaceDropTarget
    ]
  );

  useEffect(() => {
    const splitTabs = onSplitTabs;
    if (
      splitTabs === undefined ||
      isClassicRightDragSplitEnabled(
        splitTriggerMode,
        true,
        interactionPolicy
      ) === false
    ) {
      return;
    }

    const onMouseMove = (event: MouseEvent): void => {
      const dragging = rightDragRef.current;
      if (dragging === null) {
        return;
      }

      const moved = dragging.moved || hasMovedPastRightDragThreshold(
        dragging.startX,
        dragging.startY,
        event.clientX,
        event.clientY,
        interactionPolicy.rightDragThresholdPx
      );
      rightDragRef.current = {
        ...dragging,
        moved
      };

      if (moved === false) {
        return;
      }

      event.preventDefault();
      setWorkspaceDragTabId(dragging.tabId);
      setRightDragPreview({
        tabId: dragging.tabId,
        x: event.clientX,
        y: event.clientY,
        tabClassName: dragging.tabClassName,
        tabMainClassName: dragging.tabMainClassName,
        isCollapsed: dragging.isCollapsed,
        width: dragging.width
      });
      const hoverTarget = resolveSplitHoverFromPoint(event.clientX, event.clientY);
      setIsSplitDropActive(true);
      setSplitDropTargetTabId(
        hoverTarget.tabId === dragging.tabId ? null : hoverTarget.tabId
      );
      setDropIndicatorX(null);
      setIsTerminalDropActive(false);
    };

    const onMouseUp = (event: MouseEvent): void => {
      const dragging = rightDragRef.current;
      if (dragging === null) {
        return;
      }

      rightDragRef.current = null;
      const wasDrag = dragging.moved || hasMovedPastRightDragThreshold(
        dragging.startX,
        dragging.startY,
        event.clientX,
        event.clientY,
        interactionPolicy.rightDragThresholdPx
      );
      if (wasDrag) {
        let applied = false;
        const hoverTarget = resolveSplitHoverFromPoint(event.clientX, event.clientY);
        if (hoverTarget.tabId !== null && hoverTarget.tabId !== dragging.tabId) {
          splitTabs(dragging.tabId, hoverTarget.tabId);
          applied = true;
        } else if (hoverTarget.isInsideStrip) {
          onDetachTabFromSplit?.(dragging.tabId);
          applied = true;
        }

        if (applied) {
          suppressContextMenuRef.current = true;
          window.setTimeout(() => {
            suppressContextMenuRef.current = false;
          }, 0);
        }
      }

      setIsSplitDropActive(false);
      setSplitDropTargetTabId(null);
      setWorkspaceDragTabId(null);
      setRightDragPreview(null);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [
    interactionPolicy,
    onDetachTabFromSplit,
    onSplitTabs,
    resolveSplitHoverFromPoint,
    splitTriggerMode
  ]);

  const onTabStripWheel = useCallback((_event: ReactWheelEvent<HTMLDivElement>): void => {}, []);

  const onTabItemMouseDown = useCallback((event: ReactMouseEvent<HTMLElement>, tabId: string): void => {
    if (
      isClassicRightDragSplitEnabled(
        splitTriggerMode,
        onSplitTabs !== undefined,
        interactionPolicy
      ) === false ||
      event.button !== 2
    ) {
      return;
    }

    const sourceElement = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".lyra-browser-tab-item[data-lyra-tab-id]")
      : null;
    const mainElement = sourceElement?.querySelector<HTMLElement>(".lyra-browser-tab-main") ?? null;
    const sourceRect = sourceElement?.getBoundingClientRect();

    rightDragRef.current = {
      tabId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      tabClassName: sourceElement?.className ?? "lyra-browser-tab-item",
      tabMainClassName: mainElement?.className ?? "lyra-browser-tab-main",
      isCollapsed: sourceElement?.classList.contains("lyra-browser-tab-item-collapsed") ?? false,
      width: sourceRect?.width ?? 156
    };
    setIsSplitDropActive(false);
    setSplitDropTargetTabId(null);
  }, [interactionPolicy, onSplitTabs, splitTriggerMode]);

  const onTabItemMouseUp = useCallback((event: ReactMouseEvent<HTMLElement>, tab: WorkspaceTab): void => {
    if (event.button !== 2 || onTabContextMenu === undefined) {
      return;
    }
    if (suppressContextMenuRef.current) {
      return;
    }

    if (isClassicRightDragSplitEnabled(splitTriggerMode, onSplitTabs !== undefined, interactionPolicy)) {
      const rightDragging = rightDragRef.current;
      if (rightDragging !== null) {
        const wasDrag = rightDragging.moved || hasMovedPastRightDragThreshold(
          rightDragging.startX,
          rightDragging.startY,
          event.clientX,
          event.clientY,
          interactionPolicy.rightDragThresholdPx
        );
        if (wasDrag || rightDragging.tabId !== tab.id) {
          return;
        }
      }
    }

    event.preventDefault();
    onTabContextMenu(tab, event.clientX, event.clientY);
  }, [interactionPolicy, onSplitTabs, onTabContextMenu, splitTriggerMode]);

  const onTabItemContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>): void => {
    const rightDragging = rightDragRef.current;
    if (
      isClassicRightDragSplitEnabled(
        splitTriggerMode,
        onSplitTabs !== undefined,
        interactionPolicy
      ) &&
      rightDragging !== null
    ) {
      const wasDrag = rightDragging.moved || hasMovedPastRightDragThreshold(
        rightDragging.startX,
        rightDragging.startY,
        event.clientX,
        event.clientY,
        interactionPolicy.rightDragThresholdPx
      );
      if (wasDrag) {
        event.preventDefault();
        return;
      }
    }
    if (suppressContextMenuRef.current) {
      event.preventDefault();
      return;
    }
    if (onTabContextMenu !== undefined) {
      event.preventDefault();
    }
  }, [interactionPolicy, onSplitTabs, onTabContextMenu, splitTriggerMode]);

  const onTabDragEnd = useCallback((): void => {
    clearWorkspaceSortState();
    clearAllDragPayloads();
    clearDragUiState();
  }, [clearAllDragPayloads, clearDragUiState, clearWorkspaceSortState]);

  return {
    navRef,
    state: {
      isTerminalDropActive,
      dropIndicatorX,
      isSplitDropActive,
      splitDropTargetTabId,
      workspaceDragTabId,
      rightDragPreview
    },
    onTabBarDragOver,
    onTabBarDragLeave,
    onTabBarDrop,
    onTabStripWheel,
    onTabItemMouseDown,
    onTabItemMouseUp,
    onWorkspaceTabDragStart,
    onTabItemContextMenu,
    onTabDragEnd
  };
};
