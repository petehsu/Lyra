import { useCallback, useState } from "react";

import type {
  ContextMenuModel,
  ContextMenuOpenRequest,
  ContextMenuState
} from "./types";

const CLOSED_STATE: ContextMenuState = {
  isOpen: false,
  anchorX: 0,
  anchorY: 0,
  items: []
};

const clampAnchor = (value: number): number => {
  if (Number.isFinite(value) === false) {
    return 0;
  }
  return Math.max(0, value);
};

export const useContextMenuModel = (): ContextMenuModel => {
  const [state, setState] = useState<ContextMenuState>(CLOSED_STATE);

  const openMenu = useCallback((request: ContextMenuOpenRequest): void => {
    setState({
      isOpen: true,
      anchorX: clampAnchor(request.anchorX),
      anchorY: clampAnchor(request.anchorY),
      items: request.items
    });
  }, []);

  const closeMenu = useCallback((): void => {
    setState(CLOSED_STATE);
  }, []);

  const selectItem = useCallback((itemId: string): void => {
    const target = state.items.find((item) => item.id === itemId);
    if (target === undefined || target.disabled) {
      closeMenu();
      return;
    }

    target.onSelect?.();
    closeMenu();
  }, [closeMenu, state.items]);

  return {
    state,
    openMenu,
    closeMenu,
    selectItem
  };
};
