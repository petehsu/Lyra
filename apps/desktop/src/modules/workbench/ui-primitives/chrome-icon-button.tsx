import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "./classnames";

export type ChromeIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  readonly active?: boolean;
  readonly activeClassName?: string;
  readonly children: ReactNode;
  readonly type?: "button" | "submit" | "reset";
};

export const ChromeIconButton = ({
  active = false,
  activeClassName,
  children,
  className,
  type = "button",
  ...buttonProps
}: ChromeIconButtonProps) => (
  <button
    {...buttonProps}
    type={type}
    className={cx(className, active && activeClassName)}
  >
    {children}
  </button>
);
