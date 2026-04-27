import type { MouseEventHandler, ReactNode } from "react";

import { cx } from "./classnames";

type PanelHostProps = {
  readonly placement: "left" | "bottom";
  readonly visible?: boolean;
  readonly ariaLabel: string;
  readonly children: ReactNode;
};

export const PanelHost = ({
  placement,
  visible = true,
  ariaLabel,
  children
}: PanelHostProps) => {
  if (placement === "left") {
    return (
      <aside
        className={cx(
          "lyra-panel lyra-panel-left",
          visible === false && "lyra-panel-left-hidden"
        )}
        aria-label={ariaLabel}
        aria-hidden={visible ? undefined : true}
      >
        {children}
      </aside>
    );
  }

  return (
    <footer className="lyra-panel lyra-panel-bottom" aria-label={ariaLabel}>
      {children}
    </footer>
  );
};

type PanelResizerProps = {
  readonly orientation: "vertical" | "horizontal";
  readonly ariaLabel: string;
  readonly onMouseDown: MouseEventHandler<HTMLDivElement>;
};

export const PanelResizer = ({
  orientation,
  ariaLabel,
  onMouseDown
}: PanelResizerProps) => (
  <div
    className={cx(
      "lyra-resizer",
      orientation === "vertical"
        ? "lyra-resizer-vertical"
        : "lyra-resizer-horizontal"
    )}
    role="separator"
    aria-label={ariaLabel}
    aria-orientation={orientation}
    onMouseDown={onMouseDown}
  />
);
