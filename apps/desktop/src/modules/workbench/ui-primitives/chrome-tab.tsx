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
