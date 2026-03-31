import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ContextMenuState } from "./types";

type ContextMenuHostProps = {
  readonly state: ContextMenuState;
  readonly onClose: () => void;
  readonly onSelectItem: (itemId: string) => void;
};

type AnchorPosition = {
  readonly left: number;
  readonly top: number;
};

const VIEWPORT_PADDING = 6;

const clampPosition = (
  anchorX: number,
  anchorY: number,
  width: number,
  height: number
): AnchorPosition => {
  const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - width - VIEWPORT_PADDING);
  const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - height - VIEWPORT_PADDING);

  return {
    left: Math.min(Math.max(VIEWPORT_PADDING, anchorX), maxLeft),
    top: Math.min(Math.max(VIEWPORT_PADDING, anchorY), maxTop)
  };
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

    const menu = menuRef.current;
    if (menu === null) {
      return;
    }

    const rect = menu.getBoundingClientRect();
    setPosition(clampPosition(state.anchorX, state.anchorY, rect.width, rect.height));
  }, [state.anchorX, state.anchorY, state.isOpen, state.items]);

  useEffect(() => {
    if (state.isOpen === false) {
      return;
    }

    const onResize = (): void => {
      const menu = menuRef.current;
      if (menu === null) {
        return;
      }
      const rect = menu.getBoundingClientRect();
      setPosition(clampPosition(state.anchorX, state.anchorY, rect.width, rect.height));
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
          <button
            key={item.id}
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
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
};
