import type { ReactNode } from "react";

export type ContextMenuItem = {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly separatorBefore?: boolean;
  readonly onSelect?: () => void;
};

export type ContextMenuOpenRequest = {
  readonly anchorX: number;
  readonly anchorY: number;
  readonly items: readonly ContextMenuItem[];
};

export type ContextMenuState = {
  readonly isOpen: boolean;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly items: readonly ContextMenuItem[];
};

export type ContextMenuModel = {
  readonly state: ContextMenuState;
  readonly openMenu: (request: ContextMenuOpenRequest) => void;
  readonly closeMenu: () => void;
  readonly selectItem: (itemId: string) => void;
};
