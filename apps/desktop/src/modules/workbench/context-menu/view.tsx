import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AppButton } from "@renderer/ui/components";
import {
  clampContextMenuPosition,
  readBrowserPageHostRects,
  readContextMenuPaneBoundary,
  type AnchorPosition
} from "./context-menu-position";
import type { ContextMenuState } from "./types";

type ContextMenuHostProps = {
  readonly state: ContextMenuState;
  readonly onClose: () => void;
  readonly onSelectItem: (itemId: string) => void;
};

export const ContextMenuHost = ({
  state,
  onClose,
  onSelectItem
}: ContextMenuHostProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<AnchorPosition>({
    left: state.anchorX,
    top: state.anchorY
  });

  const updatePosition = (): void => {
    const menu = menuRef.current;
    if (menu === null) {
      return;
    }
    const rect = menu.getBoundingClientRect();
    const paneBoundary = readContextMenuPaneBoundary(state.anchorX, state.anchorY);
    setPosition(
      clampContextMenuPosition({
        anchorX: state.anchorX,
        anchorY: state.anchorY,
        menuWidth: rect.width,
        menuHeight: rect.height,
        paneBoundary,
        browserHostRects: readBrowserPageHostRects()
      })
    );
  };

  useEffect(() => {
    if (state.isOpen === false) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, state.isOpen]);

  useLayoutEffect(() => {
    if (state.isOpen === false) {
      return;
    }
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [state.anchorX, state.anchorY, state.isOpen, state.items]);

  useEffect(() => {
    if (state.isOpen === false) {
      return;
    }

    const onResize = (): void => {
      updatePosition();
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [state.anchorX, state.anchorY, state.isOpen]);

  if (state.isOpen === false || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="lyra-context-menu-layer"
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className="lyra-context-menu"
        style={{ left: position.left, top: position.top }}
        role="menu"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
        }}
      >
        {state.items.map((item) => (
          <AppButton
            key={item.id}
            variant="ghost"
            size="sm"
            className={[
              "lyra-context-menu-item",
              item.separatorBefore ? "lyra-context-menu-item-separator" : "",
              item.danger ? "lyra-context-menu-item-danger" : ""
            ]
              .filter((value) => value.length > 0)
              .join(" ")}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onSelectItem(item.id);
            }}
          >
            <span className="lyra-context-menu-item-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="lyra-context-menu-item-label">{item.label}</span>
          </AppButton>
        ))}
      </div>
    </div>,
    document.body
  );
};