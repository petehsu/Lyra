import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject
} from "react";

import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";
import {
  applyPanelLayoutCssVars,
  buildPanelLayoutCssVars,
  type PanelLayoutCssVars
} from "./panel-layout-shell-vars";
import { notifyLayoutDragFrame, notifyLayoutResizeEnd } from "./layout-resize-end";
import { createRafCoalescer } from "./raf-coalesce";
import {
  clamp,
  resolveCoupledPanelSizes,
  type PanelSizeState,
  resolvePanelSizeBounds
} from "./service";

export { subscribeLayoutDragFrame, subscribeLayoutResizeEnd } from "./layout-resize-end";
export type { LayoutDragSize } from "./layout-resize-end";

export type AiPanelSide = "left" | "right";
export type TerminalPanelSide = "top" | "bottom";

export type PanelLayoutState = {
  readonly leftWidth: number;
  readonly bottomHeight: number;
  readonly appSidebarWidth: number;
  readonly isLeftPanelVisible: boolean;
  readonly isBottomPanelVisible: boolean;
  readonly aiPanelSide: AiPanelSide;
  readonly terminalPanelSide: TerminalPanelSide;
};

export type PanelLayoutActions = {
  readonly onLeftResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  readonly onBottomResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  readonly toggleLeftPanel: () => void;
  readonly toggleBottomPanel: () => void;
  readonly toggleAiPanelSide: () => void;
  readonly toggleTerminalPanelSide: () => void;
};

export type PanelLayoutModel = PanelLayoutState &
  PanelLayoutActions & {
    readonly cssVars: PanelLayoutCssVars;
  };

const WORKBENCH_LAYOUT_STATE_KEY = "layout" as const;
const POINTER_EVENTS_DISABLED_CLASS = "lyra-pointer-events-disabled";
// Grid-template transitions restart on every size write during a splitter
// drag and lag the cursor behind their animation; drags must reflow directly.
const PANEL_RESIZING_CLASS = "lyra-panel-resizing";
const APP_SIDEBAR_RESIZE_SELECTOR = [
  ".lyra-app-sidebar-nav",
  ".lyra-settings-nav",
  ".lyra-agent-project-tree-sidebar",
  ".lyra-agent-git-sidebar",
  ".lyra-login-manager-sidebar"
].join(",");
const APP_SIDEBAR_RESIZE_HIT_SLOP = 10;
const WORKBENCH_RESIZER_SELECTOR = ".lyra-resizer";
const APP_SIDEBAR_MIN_WIDTH = 176;
const APP_SIDEBAR_MAX_WIDTH = 360;
const APP_SIDEBAR_DEFAULT_WIDTH = 220;

const readPersistedLayoutState = (): Record<string, unknown> => {
  const raw = readWorkbenchStateSync(WORKBENCH_LAYOUT_STATE_KEY);
  if (raw === null) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
};

const readInitialAiPanelSide = (): AiPanelSide => {
  const parsed = readPersistedLayoutState();
  return parsed.aiPanelSide === "right" ? "right" : "left";
};

const readInitialTerminalPanelSide = (): TerminalPanelSide => {
  const parsed = readPersistedLayoutState();
  return parsed.terminalPanelSide === "bottom" ? "bottom" : "top";
};

const persistLayoutState = (nextState: Record<string, unknown>): void => {
  const current = readPersistedLayoutState();
  writeWorkbenchStateSync(
    WORKBENCH_LAYOUT_STATE_KEY,
    JSON.stringify({
      ...current,
      version: 1,
      ...nextState
    })
  );
};

const readPersistedPanelSize = (
  value: unknown,
  fallback: number
): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;

const resolveAppSidebarWidth = (value: number): number =>
  clamp(value, APP_SIDEBAR_MIN_WIDTH, APP_SIDEBAR_MAX_WIDTH);

const readInitialAppSidebarWidth = (): number => {
  const parsed = readPersistedLayoutState();
  return resolveAppSidebarWidth(
    readPersistedPanelSize(parsed.appSidebarWidth, APP_SIDEBAR_DEFAULT_WIDTH)
  );
};

const createInitialPanelSizes = (): PanelSizeState => {
  const parsed = readPersistedLayoutState();
  const bounds = resolvePanelSizeBounds();
  return resolveCoupledPanelSizes(
    {
      leftWidth: readPersistedPanelSize(parsed.leftWidth, bounds.leftDefaultWidth),
      bottomHeight: readPersistedPanelSize(
        parsed.bottomHeight,
        bounds.bottomDefaultHeight
      )
    },
    bounds
  );
};

const resolveShellRoot = (
  shellRootRef: RefObject<HTMLElement | null> | undefined
): HTMLElement | null => shellRootRef?.current ?? document.querySelector(".lyra-root");

export const usePanelLayoutModel = (
  shellRootRef?: RefObject<HTMLElement | null>
): PanelLayoutModel => {
  const [panelSizes, setPanelSizes] = useState<PanelSizeState>(createInitialPanelSizes);
  const [appSidebarWidth, setAppSidebarWidth] = useState(readInitialAppSidebarWidth);
  const [isLeftPanelVisible, setIsLeftPanelVisible] = useState(true);
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true);
  const [aiPanelSide, setAiPanelSide] = useState<AiPanelSide>(readInitialAiPanelSide);
  const [terminalPanelSide, setTerminalPanelSide] =
    useState<TerminalPanelSide>(readInitialTerminalPanelSide);

  const dragDraftRef = useRef<PanelSizeState | null>(null);
  const panelSizesRef = useRef(panelSizes);
  const endDragRef = useRef<(() => void) | null>(null);
  const appSidebarWidthDraftRef = useRef<number | null>(null);
  const appSidebarWidthRef = useRef(appSidebarWidth);
  const visibilityRef = useRef({
    isLeftPanelVisible,
    isBottomPanelVisible
  });
  panelSizesRef.current = panelSizes;
  appSidebarWidthRef.current = appSidebarWidth;
  visibilityRef.current = {
    isLeftPanelVisible,
    isBottomPanelVisible
  };

  const leftWidth = panelSizes.leftWidth;
  const bottomHeight = panelSizes.bottomHeight;

  const applyLiveShellLayout = useCallback(
    (sizes: PanelSizeState): void => {
      applyPanelLayoutCssVars(
        resolveShellRoot(shellRootRef),
        buildPanelLayoutCssVars({
          leftWidth: sizes.leftWidth,
          bottomHeight: sizes.bottomHeight,
          appSidebarWidth: appSidebarWidthRef.current,
          isLeftPanelVisible: visibilityRef.current.isLeftPanelVisible,
          isBottomPanelVisible: visibilityRef.current.isBottomPanelVisible
        })
      );
    },
    [shellRootRef]
  );

  const beginDrag = useCallback((
    cursor: string,
    onMove: (event: MouseEvent) => void,
    onEnd?: () => void
  ): void => {
    endDragRef.current?.();
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
    document.body.classList.add(PANEL_RESIZING_CLASS);
    const sizes = dragDraftRef.current ?? panelSizesRef.current;
    notifyLayoutDragFrame({
      leftWidth: sizes.leftWidth,
      bottomHeight: sizes.bottomHeight,
      appSidebarWidth: appSidebarWidthRef.current
    });

    const pointerShieldTargets = Array.from(
      document.querySelectorAll("iframe, webview")
    ).filter((target) => !target.classList.contains(POINTER_EVENTS_DISABLED_CLASS));
    for (const target of pointerShieldTargets) {
      target.classList.add(POINTER_EVENTS_DISABLED_CLASS);
    }

    let latestMove: MouseEvent | null = null;
    const flushMove = (): void => {
      if (latestMove === null) return;
      const event = latestMove;
      latestMove = null;
      onMove(event);
    };
    const coalescer = createRafCoalescer(flushMove);
    const handleMouseMove = (event: MouseEvent): void => {
      latestMove = event;
      coalescer.schedule();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish();
    };

    const finish = (): void => {
      if (endDragRef.current !== finish) return;
      endDragRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finish);
      window.removeEventListener("blur", finish);
      window.removeEventListener("keydown", handleKeyDown);
      coalescer.cancel();
      // A quick move/release may happen before the queued animation frame.
      flushMove();

      const finalDraft = dragDraftRef.current;
      dragDraftRef.current = null;

      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      document.body.classList.remove(PANEL_RESIZING_CLASS);

      if (finalDraft !== null) {
        setPanelSizes(finalDraft);
        persistLayoutState({
          leftWidth: finalDraft.leftWidth,
          bottomHeight: finalDraft.bottomHeight
        });
      }
      onEnd?.();

      for (const target of pointerShieldTargets) {
        target.classList.remove(POINTER_EVENTS_DISABLED_CLASS);
      }
      notifyLayoutResizeEnd();
    };

    endDragRef.current = finish;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", finish);
    window.addEventListener("blur", finish);
    window.addEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => () => endDragRef.current?.(), []);

  const onLeftResizeMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.button > 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startLeft = leftWidth;
    const startBottom = bottomHeight;
    beginDrag("col-resize", (moveEvent) => {
      const deltaX = aiPanelSide === "left"
        ? moveEvent.clientX - startX
        : startX - moveEvent.clientX;
      const bounds = resolvePanelSizeBounds();
      const nextSizes = resolveCoupledPanelSizes(
        {
          leftWidth: startLeft + deltaX,
          bottomHeight: startBottom
        },
        bounds
      );
      dragDraftRef.current = nextSizes;
      applyLiveShellLayout(nextSizes);
      notifyLayoutDragFrame({
        leftWidth: nextSizes.leftWidth,
        bottomHeight: nextSizes.bottomHeight,
        appSidebarWidth: appSidebarWidthRef.current
      });
    });
  }, [aiPanelSide, applyLiveShellLayout, beginDrag, bottomHeight, leftWidth]);

  const onBottomResizeMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    if (event.button > 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startBottom = bottomHeight;
    const startLeft = leftWidth;
    beginDrag("row-resize", (moveEvent) => {
      const deltaY = terminalPanelSide === "top"
        ? moveEvent.clientY - startY
        : startY - moveEvent.clientY;
      const bounds = resolvePanelSizeBounds();
      const nextSizes = resolveCoupledPanelSizes(
        {
          leftWidth: startLeft,
          bottomHeight: startBottom + deltaY
        },
        bounds
      );
      dragDraftRef.current = nextSizes;
      applyLiveShellLayout(nextSizes);
      notifyLayoutDragFrame({
        leftWidth: nextSizes.leftWidth,
        bottomHeight: nextSizes.bottomHeight,
        appSidebarWidth: appSidebarWidthRef.current
      });
    });
  }, [applyLiveShellLayout, beginDrag, bottomHeight, leftWidth, terminalPanelSide]);

  useEffect(() => {
    const bounds = resolvePanelSizeBounds();
    setPanelSizes((current) =>
      resolveCoupledPanelSizes(
        {
          leftWidth: current.leftWidth,
          bottomHeight: current.bottomHeight
        },
        bounds
      )
    );
  }, []);

  useEffect(() => {
    const root = resolveShellRoot(shellRootRef);
    if (root === null) {
      return;
    }

    const onMouseDown = (event: MouseEvent): void => {
      if (event.button !== 0) {
        return;
      }
      if (
        event.target instanceof Element
        && event.target.closest(WORKBENCH_RESIZER_SELECTOR) !== null
      ) {
        return;
      }

      let sidebar: HTMLElement | null = null;
      for (const node of root.querySelectorAll(APP_SIDEBAR_RESIZE_SELECTOR)) {
        if (node instanceof HTMLElement === false) {
          continue;
        }
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          continue;
        }
        const sibling = node.nextElementSibling;
        if (sibling instanceof HTMLElement) {
          const siblingRect = sibling.getBoundingClientRect();
          if (siblingRect.top >= rect.bottom - 1) {
            continue;
          }
        }
        if (event.clientY < rect.top || event.clientY > rect.bottom) {
          continue;
        }
        if (Math.abs(event.clientX - rect.right) > APP_SIDEBAR_RESIZE_HIT_SLOP) {
          continue;
        }
        sidebar = node;
        break;
      }
      if (sidebar === null) {
        return;
      }

      event.preventDefault();
      const startX = event.clientX;
      const startWidth = appSidebarWidthRef.current;
      beginDrag(
        "col-resize",
        (moveEvent) => {
          const nextWidth = resolveAppSidebarWidth(startWidth + moveEvent.clientX - startX);
          appSidebarWidthDraftRef.current = nextWidth;
          root.style.setProperty("--lyra-app-sidebar-rail-w", `${nextWidth}px`);
          const sizes = dragDraftRef.current ?? panelSizesRef.current;
          notifyLayoutDragFrame({
            leftWidth: sizes.leftWidth,
            bottomHeight: sizes.bottomHeight,
            appSidebarWidth: nextWidth
          });
        },
        () => {
          const finalWidth = appSidebarWidthDraftRef.current;
          appSidebarWidthDraftRef.current = null;
          if (finalWidth === null) {
            return;
          }
          setAppSidebarWidth(finalWidth);
          persistLayoutState({ appSidebarWidth: finalWidth });
        }
      );
    };

    root.addEventListener("mousedown", onMouseDown);
    return () => {
      root.removeEventListener("mousedown", onMouseDown);
    };
  }, [beginDrag, shellRootRef]);

  useEffect(() => {
    const coalescer = createRafCoalescer(() => {
      const bounds = resolvePanelSizeBounds();
      setPanelSizes((current) => {
        const next = resolveCoupledPanelSizes(current, bounds);
        return next.leftWidth === current.leftWidth && next.bottomHeight === current.bottomHeight
          ? current : next;
      });
    });

    window.addEventListener("resize", coalescer.schedule);
    return () => {
      window.removeEventListener("resize", coalescer.schedule);
      coalescer.cancel();
    };
  }, []);

  const cssVars = useMemo(
    () =>
      buildPanelLayoutCssVars({
        leftWidth,
        bottomHeight,
        appSidebarWidth,
        isLeftPanelVisible,
        isBottomPanelVisible
      }),
    [appSidebarWidth, bottomHeight, isBottomPanelVisible, isLeftPanelVisible, leftWidth]
  );

  const toggleLeftPanel = useCallback(() => {
    setIsLeftPanelVisible((current) => !current);
  }, []);

  const toggleBottomPanel = useCallback(() => {
    setIsBottomPanelVisible((current) => !current);
  }, []);

  const toggleAiPanelSide = useCallback(() => {
    setAiPanelSide((current) => {
      const next = current === "left" ? "right" : "left";
      persistLayoutState({ aiPanelSide: next });
      return next;
    });
  }, []);

  const toggleTerminalPanelSide = useCallback(() => {
    setTerminalPanelSide((current) => {
      const next = current === "top" ? "bottom" : "top";
      persistLayoutState({ terminalPanelSide: next });
      return next;
    });
  }, []);

  return {
    leftWidth,
    bottomHeight,
    appSidebarWidth,
    isLeftPanelVisible,
    isBottomPanelVisible,
    aiPanelSide,
    terminalPanelSide,
    onLeftResizeMouseDown,
    onBottomResizeMouseDown,
    toggleLeftPanel,
    toggleBottomPanel,
    toggleAiPanelSide,
    toggleTerminalPanelSide,
    cssVars
  };
};
