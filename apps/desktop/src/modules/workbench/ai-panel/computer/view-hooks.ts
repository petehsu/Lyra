import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction
} from "react";

import type { AiComputerWindowFrame } from "../../../../shared/desktop-bridge";
import type { AiComputerAppInstance } from "../../../../shared/desktop-bridge";
import type { AiComputerResizeEdge } from "./window-frame";

type WindowInteractionState = {
  readonly kind: "move" | "resize";
  readonly appId: string;
  readonly edge: AiComputerResizeEdge | null;
  readonly originX: number;
  readonly originY: number;
  readonly startFrame: AiComputerWindowFrame;
  readonly stageWidth: number;
  readonly stageHeight: number;
};

type DockContextMenuState = {
  readonly kind: "file-manager" | "browser" | "terminal" | "file-editor";
  readonly x: number;
  readonly y: number;
};

type LauncherListItem = {
  readonly kind: "file-manager" | "browser" | "terminal" | "file-editor";
  readonly label: string;
  readonly targetApp: AiComputerAppInstance | null;
};

type EditableTargetChecker = (target: EventTarget | null) => boolean;

const isEditableTarget: EditableTargetChecker = (target) => {
  if ((target instanceof HTMLElement) === false) {
    return false;
  }
  const tagName = target.tagName;
  return (
    target.isContentEditable
    || tagName === "INPUT"
    || tagName === "TEXTAREA"
    || tagName === "SELECT"
  );
};

export const useLauncherAutoFocusEffect = ({
  isLauncherOpen,
  launcherPanelRef,
  launcherInputRef,
  computerRootRef
}: {
  readonly isLauncherOpen: boolean;
  readonly launcherPanelRef: RefObject<HTMLElement | null>;
  readonly launcherInputRef: RefObject<HTMLInputElement | null>;
  readonly computerRootRef: RefObject<HTMLElement | null>;
}): void => {
  useEffect(() => {
    if (isLauncherOpen === false) {
      return;
    }

    const rafId = window.requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (activeElement instanceof Element) {
        if (
          activeElement !== document.body
          && launcherPanelRef.current?.contains(activeElement) !== true
          && computerRootRef.current?.contains(activeElement) !== true
        ) {
          return;
        }
        if (
          isEditableTarget(activeElement)
          && launcherPanelRef.current?.contains(activeElement) !== true
        ) {
          return;
        }
      }
      launcherInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [computerRootRef, isLauncherOpen, launcherInputRef, launcherPanelRef]);
};

export const useLauncherKeyboardCaptureEffect = ({
  isLauncherOpen,
  launcherItems,
  activateLauncherItem,
  launcherPanelRef,
  launcherButtonRef,
  launcherInputRef,
  computerRootRef,
  setIsLauncherOpen,
  setLauncherQuery
}: {
  readonly isLauncherOpen: boolean;
  readonly launcherItems: readonly LauncherListItem[];
  readonly activateLauncherItem: (item: LauncherListItem) => void;
  readonly launcherPanelRef: RefObject<HTMLElement | null>;
  readonly launcherButtonRef: RefObject<HTMLButtonElement | null>;
  readonly launcherInputRef: RefObject<HTMLInputElement | null>;
  readonly computerRootRef: RefObject<HTMLElement | null>;
  readonly setIsLauncherOpen: Dispatch<SetStateAction<boolean>>;
  readonly setLauncherQuery: Dispatch<SetStateAction<string>>;
}): void => {
  useEffect(() => {
    if (isLauncherOpen === false) {
      return;
    }

    const isWithinComputer = (target: EventTarget | null): boolean =>
      target instanceof Node
      && computerRootRef.current?.contains(target) === true;

    const isLauncherInputFocused = (): boolean =>
      launcherInputRef.current !== null && document.activeElement === launcherInputRef.current;

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (
        launcherPanelRef.current?.contains(target)
        || launcherButtonRef.current?.contains(target)
      ) {
        return;
      }
      setIsLauncherOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (isWithinComputer(target) === false) {
        return;
      }
      if (isEditableTarget(target) && target !== launcherInputRef.current) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setIsLauncherOpen(false);
        return;
      }

      if (event.key === "Enter" && isLauncherInputFocused() === false) {
        const firstLauncherItem = launcherItems[0];
        if (firstLauncherItem !== undefined) {
          event.preventDefault();
          activateLauncherItem(firstLauncherItem);
        }
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
        return;
      }

      if (event.key === "Backspace" && isLauncherInputFocused() === false) {
        event.preventDefault();
        setLauncherQuery((current) => current.slice(0, -1));
        launcherInputRef.current?.focus();
        return;
      }

      if (event.key === "Delete" && isLauncherInputFocused() === false) {
        event.preventDefault();
        setLauncherQuery("");
        launcherInputRef.current?.focus();
        return;
      }

      if (event.key.length !== 1 || isLauncherInputFocused()) {
        return;
      }

      event.preventDefault();
      setLauncherQuery((current) => `${current}${event.key}`);
      launcherInputRef.current?.focus();
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    activateLauncherItem,
    computerRootRef,
    isLauncherOpen,
    launcherButtonRef,
    launcherInputRef,
    launcherItems,
    launcherPanelRef,
    setIsLauncherOpen,
    setLauncherQuery
  ]);
};

export const useLauncherCloseOnPowerStateEffect = ({
  isPoweredOff,
  isBooting,
  setIsLauncherOpen
}: {
  readonly isPoweredOff: boolean;
  readonly isBooting: boolean;
  readonly setIsLauncherOpen: Dispatch<SetStateAction<boolean>>;
}): void => {
  useEffect(() => {
    if (isPoweredOff === false && isBooting === false) {
      return;
    }
    setIsLauncherOpen(false);
  }, [isBooting, isPoweredOff, setIsLauncherOpen]);
};

export const useDockContextMenuDismissEffect = ({
  dockContextMenu,
  dockContextMenuRef,
  setDockContextMenu
}: {
  readonly dockContextMenu: DockContextMenuState | null;
  readonly dockContextMenuRef: RefObject<HTMLElement | null>;
  readonly setDockContextMenu: Dispatch<SetStateAction<DockContextMenuState | null>>;
}): void => {
  useEffect(() => {
    if (dockContextMenu === null) {
      return;
    }

    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (
        target instanceof Node
        && dockContextMenuRef.current?.contains(target)
      ) {
        return;
      }
      setDockContextMenu(null);
    };

    const onContextMenu = (event: MouseEvent): void => {
      const target = event.target;
      if (
        target instanceof Node
        && dockContextMenuRef.current?.contains(target)
      ) {
        return;
      }
      setDockContextMenu(null);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setDockContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [dockContextMenu, dockContextMenuRef, setDockContextMenu]);
};

export const useDesktopTypingLauncherEffect = ({
  isComputerFocused,
  isLauncherOpen,
  isPoweredOff,
  isBooting,
  visibleAppCount,
  computerRootRef,
  setLauncherQuery,
  setIsLauncherOpen
}: {
  readonly isComputerFocused: boolean;
  readonly isLauncherOpen: boolean;
  readonly isPoweredOff: boolean;
  readonly isBooting: boolean;
  readonly visibleAppCount: number;
  readonly computerRootRef: RefObject<HTMLElement | null>;
  readonly setLauncherQuery: Dispatch<SetStateAction<string>>;
  readonly setIsLauncherOpen: Dispatch<SetStateAction<boolean>>;
}): void => {
  useEffect(() => {
    if (
      isComputerFocused === false
      || isLauncherOpen
      || isPoweredOff
      || isBooting
      || visibleAppCount > 0
    ) {
      return;
    }

    const isWithinComputer = (target: EventTarget | null): boolean =>
      target instanceof Node
      && computerRootRef.current?.contains(target) === true;

    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (isWithinComputer(target) === false) {
        return;
      }
      if (isEditableTarget(target)) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) {
        return;
      }

      if (event.key === "Escape") {
        return;
      }

      if (event.key.length !== 1) {
        return;
      }

      event.preventDefault();
      setLauncherQuery(event.key);
      setIsLauncherOpen(true);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    computerRootRef,
    isBooting,
    isComputerFocused,
    isLauncherOpen,
    isPoweredOff,
    setIsLauncherOpen,
    setLauncherQuery,
    visibleAppCount
  ]);
};

export const useWindowPointerEffects = ({
  interactionRef,
  transientFramesRef,
  setTransientFrames,
  onMoveAppWindow,
  onResizeAppWindow,
  clampFrame,
  applyResizeDelta
}: {
  readonly interactionRef: MutableRefObject<WindowInteractionState | null>;
  readonly transientFramesRef: MutableRefObject<Readonly<Record<string, AiComputerWindowFrame>>>;
  readonly setTransientFrames: Dispatch<SetStateAction<Readonly<Record<string, AiComputerWindowFrame>>>>;
  readonly onMoveAppWindow: (appInstanceId: string, frame: AiComputerWindowFrame) => void;
  readonly onResizeAppWindow: (appInstanceId: string, frame: AiComputerWindowFrame) => void;
  readonly clampFrame: (
    frame: AiComputerWindowFrame,
    stageWidth: number,
    stageHeight: number
  ) => AiComputerWindowFrame;
  readonly applyResizeDelta: (
    frame: AiComputerWindowFrame,
    edge: AiComputerResizeEdge,
    dx: number,
    dy: number,
    stageWidth: number,
    stageHeight: number
  ) => AiComputerWindowFrame;
}): void => {
  useEffect(() => {
    const onPointerMove = (event: PointerEvent): void => {
      const interaction = interactionRef.current;
      if (interaction === null) {
        return;
      }
      const dx = event.clientX - interaction.originX;
      const dy = event.clientY - interaction.originY;
      const nextFrame = interaction.kind === "move"
        ? clampFrame(
            {
              x: interaction.startFrame.x + dx,
              y: interaction.startFrame.y + dy,
              width: interaction.startFrame.width,
              height: interaction.startFrame.height
            },
            interaction.stageWidth,
            interaction.stageHeight
          )
        : applyResizeDelta(
            interaction.startFrame,
            interaction.edge ?? "se",
            dx,
            dy,
            interaction.stageWidth,
            interaction.stageHeight
          );

      setTransientFrames((current) => ({
        ...current,
        [interaction.appId]: nextFrame
      }));
    };

    const onPointerUp = (): void => {
      const interaction = interactionRef.current;
      if (interaction === null) {
        return;
      }
      const committedFrame = transientFramesRef.current[interaction.appId] ?? interaction.startFrame;
      if (interaction.kind === "move") {
        onMoveAppWindow(interaction.appId, committedFrame);
      } else {
        onResizeAppWindow(interaction.appId, committedFrame);
      }
      interactionRef.current = null;
      setTransientFrames((current) => {
        if (current[interaction.appId] === committedFrame) {
          return current;
        }
        return {
          ...current,
          [interaction.appId]: committedFrame
        };
      });
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [
    applyResizeDelta,
    clampFrame,
    interactionRef,
    onMoveAppWindow,
    onResizeAppWindow,
    setTransientFrames,
    transientFramesRef
  ]);
};
