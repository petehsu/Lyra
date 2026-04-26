import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";

import { readWorkbenchStateSync, writeWorkbenchStateSync } from "../state-storage";
import {
  resolveCoupledPanelSizes,
  type PanelSizeState,
  resolvePanelSizeBounds
} from "./service";

export type AiPanelSide = "left" | "right";
export type TerminalPanelSide = "top" | "bottom";

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
      readonly "--left-panel-mobile-height": string;
      readonly "--bottom-height": string;
    };
  };

const WORKBENCH_LAYOUT_STATE_KEY = "layout" as const;

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

const createInitialPanelSizes = (): PanelSizeState => {
  const bounds = resolvePanelSizeBounds();
  return resolveCoupledPanelSizes(
    {
      leftWidth: bounds.leftDefaultWidth,
      bottomHeight: bounds.bottomDefaultHeight
    },
    bounds
  );
};

export const usePanelLayoutModel = (): PanelLayoutModel => {
  const [panelSizes, setPanelSizes] = useState<PanelSizeState>(createInitialPanelSizes);
  const [isLeftPanelVisible, setIsLeftPanelVisible] = useState(true);
  const [isBottomPanelVisible, setIsBottomPanelVisible] = useState(true);
  const [aiPanelSide, setAiPanelSide] = useState<AiPanelSide>(readInitialAiPanelSide);
  const [terminalPanelSide, setTerminalPanelSide] =
    useState<TerminalPanelSide>(readInitialTerminalPanelSide);

  const leftWidth = panelSizes.leftWidth;
  const bottomHeight = panelSizes.bottomHeight;

  const beginDrag = useCallback((cursor: string, onMove: (event: MouseEvent) => void): void => {
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";

    const handleMouseMove = (event: MouseEvent): void => {
      onMove(event);
    };

    const handleMouseUp = (): void => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, []);

  const onLeftResizeMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startLeft = leftWidth;
    beginDrag("col-resize", (moveEvent) => {
      const deltaX = aiPanelSide === "left"
        ? moveEvent.clientX - startX
        : startX - moveEvent.clientX;
      const bounds = resolvePanelSizeBounds();
      setPanelSizes((current) =>
        resolveCoupledPanelSizes(
          {
            leftWidth: startLeft + deltaX,
            bottomHeight: current.bottomHeight
          },
          bounds
        )
      );
    });
  }, [aiPanelSide, beginDrag, leftWidth]);

  const onBottomResizeMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startY = event.clientY;
    const startBottom = bottomHeight;
    beginDrag("row-resize", (moveEvent) => {
      const deltaY = terminalPanelSide === "top"
        ? moveEvent.clientY - startY
        : startY - moveEvent.clientY;
      const bounds = resolvePanelSizeBounds();
      setPanelSizes((current) =>
        resolveCoupledPanelSizes(
          {
            leftWidth: current.leftWidth,
            bottomHeight: startBottom + deltaY
          },
          bounds
        )
      );
    });
  }, [beginDrag, bottomHeight, terminalPanelSide]);

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
    () => ({
      "--left-width": isLeftPanelVisible ? `${leftWidth}px` : "0px",
      "--left-panel-mobile-height": isLeftPanelVisible ? "var(--lyra-unit-180)" : "0px",
      "--bottom-height": isBottomPanelVisible ? `${bottomHeight}px` : "0px"
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
