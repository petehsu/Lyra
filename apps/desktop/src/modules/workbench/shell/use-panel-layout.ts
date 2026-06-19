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
  buildPanelLayoutCssVars
} from "./panel-layout-shell-vars";
import { notifyLayoutResizeEnd, notifyLayoutResizeStart } from "./layout-resize-end";
import {
  resolveCoupledPanelSizes,
  type PanelSizeState,
  resolvePanelSizeBounds
} from "./service";

export {
  subscribeLayoutResizeEnd,
  subscribeLayoutResizeStart
} from "./layout-resize-end";

export type AiPanelSide = "left" | "right";
export type TerminalPanelSide = "top" | "bottom";

// Cached mirror of the `lyra-layout-resizing` body class. Lets hot resize paths
// (e.g. the terminal pane ResizeObserver) check "is a splitter drag active?"
// without a per-tick `classList.contains` read, which forces a style reflush.
let layoutResizingActive = false;

/** True while a panel-splitter drag is in progress. No DOM read. */
export const getIsLayoutResizing = (): boolean => layoutResizingActive;

export type PanelLayoutState = {
  readonly leftWidth: number;
  readonly bottomHeight: number;
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
    readonly cssVars: {
      readonly "--left-width": string;
      readonly "--left-panel-content-width": string;
      readonly "--left-panel-mobile-height": string;
      readonly "--left-panel-content-mobile-height": string;
      readonly "--bottom-height": string;
      readonly "--bottom-panel-content-height": string;
    };
  };

const WORKBENCH_LAYOUT_STATE_KEY = "layout" as const;
const POINTER_EVENTS_DISABLED_CLASS = "lyra-pointer-events-disabled";

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
  const [isLeftPanelVisible, setIsLeftPanelVisible] = useState(true);
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true);
  const [aiPanelSide, setAiPanelSide] = useState<AiPanelSide>(readInitialAiPanelSide);
  const [terminalPanelSide, setTerminalPanelSide] =
    useState<TerminalPanelSide>(readInitialTerminalPanelSide);

  const dragDraftRef = useRef<PanelSizeState | null>(null);
  const visibilityRef = useRef({
    isLeftPanelVisible,
    isBottomPanelVisible
  });
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
          isLeftPanelVisible: visibilityRef.current.isLeftPanelVisible,
          isBottomPanelVisible: visibilityRef.current.isBottomPanelVisible
        })
      );
    },
    [shellRootRef]
  );

  const beginDrag = useCallback((cursor: string, onMove: (event: MouseEvent) => void): void => {
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";
    document.body.classList.add("lyra-layout-resizing");
    layoutResizingActive = true;
    notifyLayoutResizeStart();

    const pointerShieldTargets = Array.from(
      document.querySelectorAll("iframe, webview")
    );
    for (const target of pointerShieldTargets) {
      target.classList.add(POINTER_EVENTS_DISABLED_CLASS);
    }

    const handleMouseMove = (event: MouseEvent): void => {
      onMove(event);
    };

    const handleMouseUp = (): void => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);

      const finalDraft = dragDraftRef.current;
      dragDraftRef.current = null;

      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      document.body.classList.remove("lyra-layout-resizing");
      layoutResizingActive = false;

      if (finalDraft !== null) {
        setPanelSizes(finalDraft);
        persistLayoutState({
          leftWidth: finalDraft.leftWidth,
          bottomHeight: finalDraft.bottomHeight
        });
      }

      notifyLayoutResizeEnd();

      for (const target of pointerShieldTargets) {
        target.classList.remove(POINTER_EVENTS_DISABLED_CLASS);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, []);

  const onLeftResizeMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
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
    });
  }, [aiPanelSide, applyLiveShellLayout, beginDrag, bottomHeight, leftWidth]);

  const onBottomResizeMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
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
    const onResize = (): void => {
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
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const cssVars = useMemo(
    () =>
      buildPanelLayoutCssVars({
        leftWidth,
        bottomHeight,
        isLeftPanelVisible,
        isBottomPanelVisible
      }),
    [bottomHeight, isBottomPanelVisible, isLeftPanelVisible, leftWidth]
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