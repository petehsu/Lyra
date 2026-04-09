import {
  ChevronLeft,
  ChevronRight,
  Globe,
  House,
  Layers3,
  Plus,
  Search,
  Settings2,
  SquareTerminal,
  X
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent
} from "react";

import type { WorkbenchSplitTriggerMode } from "../preferences";
import {
  clearTerminalTabDragPayload,
  readTerminalTabDragPayload,
  setTerminalTabDragImage,
  writeTerminalTabDragPayload
} from "../terminal-dock/drag-transfer";
import { renderWorkspaceAppIcon } from "../workspace-apps";
import type { WorkspaceTab } from "../workspace-tabs/types";
import {
  clearWorkspaceTabDragPayload,
  hasWorkspaceTabDragPayload,
  readWorkspaceTabDragPayload,
  writeWorkspaceTabDragPayload
} from "./workspace-drag-transfer";

const renderTabIcon = (tab: WorkspaceTab) => {
  if (tab.pageKind === "settings") {
    return <Settings2 size={13} className="lyra-browser-tab-icon-svg" />;
  }

  if (tab.pageKind === "results") {
    return <Search size={13} className="lyra-browser-tab-icon-svg" />;
  }

  if (tab.pageKind === "search") {
    return <House size={13} className="lyra-browser-tab-icon-svg" />;
  }

  if (tab.pageKind === "terminal") {
    return <SquareTerminal size={13} className="lyra-browser-tab-icon-svg" />;
  }

  if (tab.pageKind === "app" && tab.appId !== undefined && tab.appIconKey !== undefined) {
    return renderWorkspaceAppIcon(tab.appId, tab.appIconKey);
  }

  if (tab.faviconUrl !== undefined && tab.faviconUrl.length > 0) {
    return (
      <img
        src={tab.faviconUrl}
        alt=""
        className="lyra-browser-tab-favicon"
        loading="eager"
        decoding="async"
      />
    );
  }

  return <Globe size={13} className="lyra-browser-tab-icon-svg" />;
};

export type BrowserTabDropRequest = {
  readonly terminalTabId: string;
  readonly targetIndex: number;
};

type WorkspaceDropTarget = {
  readonly targetIndex: number;
  readonly indicatorX: number;
};

type SplitHoverTarget = {
  readonly tabId: string | null;
  readonly isInsideStrip: boolean;
};

type RightDragState = {
  readonly tabId: string;
  readonly startX: number;
  readonly startY: number;
  readonly moved: boolean;
  readonly tabClassName: string;
  readonly tabMainClassName: string;
  readonly isCollapsed: boolean;
  readonly width: number;
};

type RightDragPreview = {
  readonly tabId: string;
  readonly x: number;
  readonly y: number;
  readonly tabClassName: string;
  readonly tabMainClassName: string;
  readonly isCollapsed: boolean;
  readonly width: number;
};

const WORKSPACE_REORDER_SNAP_PX = 16;
const RIGHT_DRAG_THRESHOLD_PX = 10;

export type BrowserTabStripProps = {
  readonly tabs: readonly WorkspaceTab[];
  readonly splitGroupTabIds?: readonly string[];
  readonly activeTabId: string;
  readonly goBackLabel: string;
  readonly goForwardLabel: string;
  readonly toggleTabStackLabel: string;
  readonly stackedMode: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly openNewTabLabel: string;
  readonly closeTabLabel: string;
  readonly splitTriggerMode: WorkbenchSplitTriggerMode;
  readonly isTabInSplit?: (tabId: string) => boolean;
  readonly onGoBack: () => void;
  readonly onGoForward: () => void;
  readonly onToggleStackedMode: () => void;
  readonly onTabContextMenu?: (
    tab: WorkspaceTab,
    anchorX: number,
    anchorY: number
  ) => void;
  readonly onDropTerminalDockTab?: (request: BrowserTabDropRequest) => void;
  readonly onReorderTabs?: (tabId: string, targetIndex: number) => void;
  readonly onSplitTabs?: (sourceTabId: string, targetTabId: string) => void;
  readonly onDetachTabFromSplit?: (tabId: string) => void;
  readonly onActivateTab: (tabId: string) => void;
  readonly onCloseTab: (tabId: string) => void;
  readonly onOpenNewTab: () => void;
};

export const BrowserTabStrip = ({
  tabs,
  splitGroupTabIds = [],
  activeTabId,
  goBackLabel,
  goForwardLabel,
  toggleTabStackLabel,
  stackedMode,
  canGoBack,
  canGoForward,
  openNewTabLabel,
  closeTabLabel,
  splitTriggerMode,
  isTabInSplit,
  onGoBack,
  onGoForward,
  onToggleStackedMode,
  onTabContextMenu,
  onDropTerminalDockTab,
  onReorderTabs,
  onSplitTabs,
  onDetachTabFromSplit,
  onActivateTab,
  onCloseTab,
  onOpenNewTab
}: BrowserTabStripProps) => {
  const navRef = useRef<HTMLElement | null>(null);
  const rightDragRef = useRef<RightDragState | null>(null);
  const suppressContextMenuRef = useRef(false);
  const splitGroupLookup = new Set(splitGroupTabIds);
  const isSplitGroupActive = splitGroupLookup.has(activeTabId);

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
    ): WorkspaceDropTarget => {
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

      if (tabElements.length === 0) {
        const fallbackX = Math.max(0, Math.min(hostRect.width, stripRect.left - hostRect.left));
        return {
          targetIndex: 0,
          indicatorX: fallbackX
        };
      }

      const splitSet = new Set(splitGroupTabIds);
      const splitIndexes = tabs
        .map((tab, index) => (splitSet.has(tab.id) ? index : -1))
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
          return tabElements[0]!.getBoundingClientRect().left;
        }
        if (targetIndex >= tabElements.length) {
          return tabElements[tabElements.length - 1]!.getBoundingClientRect().right;
        }
        return tabElements[targetIndex]!.getBoundingClientRect().left;
      };

      if (draggingWorkspaceTabId !== undefined) {
        const draggedIndex = tabs.findIndex((tab) => tab.id === draggingWorkspaceTabId);
        if (draggedIndex >= 0) {
          const splitFirstIndex = splitIndexes[0] ?? -1;
          const splitLastIndex = splitIndexes[splitIndexes.length - 1] ?? -1;
          const isDraggingSplitGroup =
            splitIndexes.length >= 2 && splitSet.has(draggingWorkspaceTabId);
          const hoveredIndex = tabElements.findIndex((tabElement) => {
            const rect = tabElement.getBoundingClientRect();
            return (
              event.clientX >= rect.left - WORKSPACE_REORDER_SNAP_PX &&
              event.clientX <= rect.right + WORKSPACE_REORDER_SNAP_PX
            );
          });

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
            const indicatorScreenX = toIndicatorScreenX(targetIndex);
            return {
              targetIndex,
              indicatorX: Math.max(
                0,
                Math.min(hostRect.width, indicatorScreenX - hostRect.left)
              )
            };
          }
        }
      }

      let targetIndex = tabElements.length;
      let indicatorScreenX = tabElements[tabElements.length - 1]!.getBoundingClientRect().right;
      for (let index = 0; index < tabElements.length; index += 1) {
        const tabElement = tabElements[index];
        if (tabElement === undefined) {
          continue;
        }
        const rect = tabElement.getBoundingClientRect();
        if (event.clientX < rect.left + rect.width / 2) {
          targetIndex = index;
          indicatorScreenX = rect.left;
          break;
        }
      }
      targetIndex = normalizeTargetIndex(targetIndex);
      indicatorScreenX = toIndicatorScreenX(targetIndex);

      return {
        targetIndex,
        indicatorX: Math.max(0, Math.min(hostRect.width, indicatorScreenX - hostRect.left))
      };
    },
    [splitGroupTabIds, tabs]
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

  const onWorkspaceTabDragStart = useCallback(
    (event: ReactDragEvent<HTMLElement>, tab: WorkspaceTab): void => {
      const splitIntent =
        splitTriggerMode === "ctrl_left_drag" && event.ctrlKey && onSplitTabs !== undefined;
      writeWorkspaceTabDragPayload(event.dataTransfer, tab.id, splitIntent ? "split" : "reorder");
      setWorkspaceDragTabId(splitIntent ? null : tab.id);
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
    [onSplitTabs, setSplitGroupDragImage, splitTriggerMode]
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
    if (splitTriggerMode !== "right_drag" || onSplitTabs === undefined) {
      return;
    }

    const onMouseMove = (event: MouseEvent): void => {
      const dragging = rightDragRef.current;
      if (dragging === null) {
        return;
      }

      const movedDistance = Math.hypot(
        event.clientX - dragging.startX,
        event.clientY - dragging.startY
      );
      const moved = dragging.moved || movedDistance >= RIGHT_DRAG_THRESHOLD_PX;
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
      const movedDistance = Math.hypot(
        event.clientX - dragging.startX,
        event.clientY - dragging.startY
      );
      const wasDrag = dragging.moved || movedDistance >= RIGHT_DRAG_THRESHOLD_PX;
      if (wasDrag) {
        let applied = false;
        const hoverTarget = resolveSplitHoverFromPoint(event.clientX, event.clientY);
        if (hoverTarget.tabId !== null && hoverTarget.tabId !== dragging.tabId) {
          onSplitTabs(dragging.tabId, hoverTarget.tabId);
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
  }, [onDetachTabFromSplit, onSplitTabs, resolveSplitHoverFromPoint, splitTriggerMode]);

  const navClassName = [
    "lyra-browser-tabs",
    isTerminalDropActive ? "lyra-browser-tabs-terminal-drop-target" : "",
    dropIndicatorX !== null ? "lyra-browser-tabs-reorder-active" : "",
    isSplitDropActive ? "lyra-browser-tabs-split-drop-active" : ""
  ]
    .filter((value) => value.length > 0)
    .join(" ");

  const navStyle =
    dropIndicatorX === null
      ? undefined
      : ({ "--lyra-browser-drop-indicator-x": `${dropIndicatorX}px` } as CSSProperties);
  const rightDragPreviewTab = rightDragPreview === null
    ? null
    : tabs.find((tab) => tab.id === rightDragPreview.tabId) ?? null;

  const onTabStripWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>): void => {
    if (event.ctrlKey) {
      return;
    }
    const strip = event.currentTarget;
    if (strip.scrollWidth <= strip.clientWidth) {
      return;
    }
    const horizontalDelta = Math.abs(event.deltaX) > 0.01 ? event.deltaX : event.deltaY;
    if (Math.abs(horizontalDelta) <= 0.01) {
      return;
    }
    strip.scrollLeft += horizontalDelta;
  }, []);

  const onTabItemMouseDown = useCallback((event: ReactMouseEvent<HTMLElement>, tabId: string): void => {
    if (
      splitTriggerMode !== "right_drag" ||
      onSplitTabs === undefined ||
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
  }, [onSplitTabs, splitTriggerMode]);

  const onTabItemMouseUp = useCallback((event: ReactMouseEvent<HTMLElement>, tab: WorkspaceTab): void => {
    if (event.button !== 2 || onTabContextMenu === undefined) {
      return;
    }
    if (suppressContextMenuRef.current) {
      return;
    }

    if (splitTriggerMode === "right_drag" && onSplitTabs !== undefined) {
      const rightDragging = rightDragRef.current;
      if (rightDragging !== null) {
        const movedDistance = Math.hypot(
          event.clientX - rightDragging.startX,
          event.clientY - rightDragging.startY
        );
        const wasDrag = rightDragging.moved || movedDistance >= RIGHT_DRAG_THRESHOLD_PX;
        if (wasDrag || rightDragging.tabId !== tab.id) {
          return;
        }
      }
    }

    event.preventDefault();
    onTabContextMenu(tab, event.clientX, event.clientY);
  }, [onSplitTabs, onTabContextMenu, splitTriggerMode]);

  return (
    <nav
      ref={navRef}
      className={navClassName}
      style={navStyle}
      aria-label="browser-tabs"
      onDragOver={onTabBarDragOver}
      onDragEnter={onTabBarDragOver}
      onDragLeave={onTabBarDragLeave}
      onDrop={onTabBarDrop}
    >
      <button
        className="lyra-browser-nav-button"
        aria-label={goBackLabel}
        disabled={!canGoBack}
        onClick={onGoBack}
      >
        <ChevronLeft size={14} />
      </button>
      <button
        className="lyra-browser-nav-button"
        aria-label={goForwardLabel}
        disabled={!canGoForward}
        onClick={onGoForward}
      >
        <ChevronRight size={14} />
      </button>
      <button
        className={
          stackedMode
            ? "lyra-browser-nav-button lyra-browser-nav-button-active"
            : "lyra-browser-nav-button"
        }
        aria-label={toggleTabStackLabel}
        aria-pressed={stackedMode}
        onClick={onToggleStackedMode}
      >
        <Layers3 size={14} />
      </button>

      <div
        className={
          stackedMode
            ? "lyra-browser-tab-strip lyra-browser-tab-strip-stacked"
            : "lyra-browser-tab-strip"
        }
        onWheel={onTabStripWheel}
      >
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeTabId;
          const isCollapsedTab = stackedMode && !isActive;
          const nextTab = tabs[index + 1];
          const isCurrentTabInSplit =
            splitGroupLookup.has(tab.id) || isTabInSplit?.(tab.id) === true;
          const isNextTabInSplit =
            nextTab !== undefined &&
            (splitGroupLookup.has(nextTab.id) || isTabInSplit?.(nextTab.id) === true);
          const isFocusedTabInActiveSplitGroup =
            isSplitGroupActive && isCurrentTabInSplit && isActive;
          const isDraggingSplitGroup =
            workspaceDragTabId !== null && splitGroupLookup.has(workspaceDragTabId);
          const isTabInDraggingSplitGroup = isDraggingSplitGroup && isCurrentTabInSplit;
          const tabClassName = [
            "lyra-browser-tab-item",
            "lyra-browser-tab-item-drag-enabled",
            "lyra-allow-web-drag",
            isActive ? "lyra-browser-tab-item-active" : "",
            isCollapsedTab ? "lyra-browser-tab-item-collapsed" : "",
            splitDropTargetTabId === tab.id ? "lyra-browser-tab-item-split-target" : "",
            isCurrentTabInSplit && isSplitGroupActive
              ? "lyra-browser-tab-item-split-group-active"
              : "",
            isCurrentTabInSplit && isNextTabInSplit
              ? "lyra-browser-tab-item-split-joined-next"
              : "",
            isTabInDraggingSplitGroup ? "lyra-browser-tab-item-split-group-dragging" : ""
          ]
            .filter((value) => value.length > 0)
            .join(" ");
          const tabMainClassName = [
            isCollapsedTab
              ? "lyra-browser-tab-main lyra-browser-tab-main-collapsed"
              : "lyra-browser-tab-main",
            isFocusedTabInActiveSplitGroup ? "lyra-browser-tab-main-split-focused" : ""
          ]
            .filter((value) => value.length > 0)
            .join(" ");

          return (
            <div
              key={tab.id}
              className={tabClassName}
              data-lyra-tab-id={tab.id}
              data-lyra-allow-web-drag="true"
              draggable
              onMouseDown={(event) => {
                onTabItemMouseDown(event, tab.id);
              }}
              onMouseUp={(event) => {
                onTabItemMouseUp(event, tab);
              }}
              onDragStart={(event) => {
                onWorkspaceTabDragStart(event, tab);
              }}
              onDragEnd={() => {
                clearAllDragPayloads();
                clearDragUiState();
              }}
              onContextMenu={(event) => {
                const rightDragging = rightDragRef.current;
                if (splitTriggerMode === "right_drag" && rightDragging !== null) {
                  const movedDistance = Math.hypot(
                    event.clientX - rightDragging.startX,
                    event.clientY - rightDragging.startY
                  );
                  if (rightDragging.moved || movedDistance >= RIGHT_DRAG_THRESHOLD_PX) {
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
              }}
            >
              <button
                className={tabMainClassName}
                aria-label={tab.title}
                title={tab.title}
                data-lyra-allow-web-drag="true"
                draggable
                onMouseDown={(event) => {
                  onTabItemMouseDown(event, tab.id);
                }}
                onDragStart={(event) => {
                  onWorkspaceTabDragStart(event, tab);
                }}
                onDragEnd={() => {
                  clearAllDragPayloads();
                  clearDragUiState();
                }}
                onClick={() => {
                  onActivateTab(tab.id);
                }}
              >
                <span className="lyra-browser-tab-icon" aria-hidden="true">
                  {renderTabIcon(tab)}
                </span>
                {!isCollapsedTab ? (
                  <span className="lyra-browser-tab-title">{tab.title}</span>
                ) : null}
              </button>
              {!isCollapsedTab ? (
                <button
                  className="lyra-browser-tab-close"
                  aria-label={`${closeTabLabel}-${tab.title}`}
                  draggable={false}
                  onClick={() => {
                    onCloseTab(tab.id);
                  }}
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
          );
        })}
        <button
          className="lyra-browser-tab-add"
          aria-label={openNewTabLabel}
          onClick={onOpenNewTab}
        >
          <Plus size={14} />
        </button>
      </div>
      {rightDragPreview !== null && rightDragPreviewTab !== null ? (
        <div
          className="lyra-browser-tab-right-drag-preview-shell"
          style={{
            transform: `translate(${rightDragPreview.x + 14}px, ${rightDragPreview.y + 10}px)`
          }}
          aria-hidden="true"
        >
          <div
            className={`${rightDragPreview.tabClassName} lyra-browser-tab-right-drag-preview-tab`}
            style={{
              width: `${Math.round(rightDragPreview.width)}px`,
              minWidth: `${Math.round(rightDragPreview.width)}px`,
              maxWidth: `${Math.round(rightDragPreview.width)}px`
            }}
          >
            <span className={`${rightDragPreview.tabMainClassName} lyra-browser-tab-right-drag-preview-main`}>
              <span className="lyra-browser-tab-icon" aria-hidden="true">
                {renderTabIcon(rightDragPreviewTab)}
              </span>
              <span className="lyra-browser-tab-title">{rightDragPreviewTab.title}</span>
            </span>
            {rightDragPreview.isCollapsed ? null : (
              <button
                type="button"
                className="lyra-browser-tab-close lyra-browser-tab-right-drag-preview-close"
                tabIndex={-1}
                aria-hidden="true"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      ) : null}
    </nav>
  );
};
