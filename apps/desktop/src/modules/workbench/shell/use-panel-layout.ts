import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";

import {
  resolveCoupledPanelSizes,
  type PanelSizeState,
  resolvePanelSizeBounds
} from "./service";

export type PanelLayoutState = {
  readonly leftWidth: number;
  readonly bottomHeight: number;
  readonly isLeftPanelVisible: boolean;
  readonly isBottomPanelVisible: boolean;
};

export type PanelLayoutActions = {
  readonly onLeftResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  readonly onBottomResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
  readonly toggleLeftPanel: () => void;
  readonly toggleBottomPanel: () => void;
};

export type PanelLayoutModel = PanelLayoutState &
  PanelLayoutActions & {
    readonly cssVars: {
      readonly "--left-width": string;
      readonly "--bottom-height": string;
    };
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
      const deltaX = moveEvent.clientX - startX;
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
  }, [beginDrag, leftWidth]);

  const onBottomResizeMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startY = event.clientY;
    const startBottom = bottomHeight;
    beginDrag("row-resize", (moveEvent) => {
      const deltaY = startY - moveEvent.clientY;
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
  }, [beginDrag, bottomHeight]);

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
      "--bottom-height": isBottomPanelVisible ? `${bottomHeight}px` : "0px"
    }),
    [bottomHeight, isBottomPanelVisible, isLeftPanelVisible, leftWidth]
  );

  return {
    leftWidth,
    bottomHeight,
    isLeftPanelVisible,
    isBottomPanelVisible,
    onLeftResizeMouseDown,
    onBottomResizeMouseDown,
    toggleLeftPanel: () => {
      setIsLeftPanelVisible((current) => !current);
    },
    toggleBottomPanel: () => {
      setIsBottomPanelVisible((current) => !current);
    },
    cssVars
  };
};
