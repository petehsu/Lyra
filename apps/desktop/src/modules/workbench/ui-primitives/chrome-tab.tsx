import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode
} from "react";

import { cx } from "./classnames";

export type ChromeTabFrameProps = HTMLAttributes<HTMLDivElement> & {
  readonly allowWebDrag?: boolean;
  readonly children: ReactNode;
};

export const ChromeTabFrame = ({
  allowWebDrag = false,
  children,
  className,
  ...frameProps
}: ChromeTabFrameProps) => (
  <div
    {...frameProps}
    className={cx(className)}
    data-lyra-allow-web-drag={allowWebDrag ? "true" : undefined}
  >
    {children}
  </div>
);

export type ChromeTabButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  readonly allowWebDrag?: boolean;
  readonly children: ReactNode;
  readonly type?: "button" | "submit" | "reset";
};

export const ChromeTabButton = ({
  allowWebDrag = false,
  children,
  className,
  type = "button",
  ...buttonProps
}: ChromeTabButtonProps) => (
  <button
    {...buttonProps}
    type={type}
    className={cx(className)}
    data-lyra-allow-web-drag={allowWebDrag ? "true" : undefined}
  >
    {children}
  </button>
);

export type ChromeTabShapeProps = HTMLAttributes<HTMLDivElement>;

export const ChromeTabShape = ({
  className,
  ...shapeProps
}: ChromeTabShapeProps) => (
  <div
    {...shapeProps}
    className={cx("lyra-chrome-tab-shape", className)}
    aria-hidden="true"
  >
    <div className="lyra-chrome-tab-dividers" />
    <div className="lyra-chrome-tab-background">
      <svg
        className="lyra-chrome-tab-background-svg"
        viewBox="0 0 428 36"
        preserveAspectRatio="none"
        focusable="false"
      >
        <path
          className="lyra-chrome-tab-geometry"
          d="M17 0h394c4.5 0 8 3.5 8 8v18c0 4.5 4.5 8 9 8v2H0v-2c4.5 0 9-3.5 9-8V8c0-4.5 3.5-8 8-8z"
        />
      </svg>
    </div>
  </div>
);
