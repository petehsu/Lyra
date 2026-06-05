import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cx } from "./classnames";

export type ChromeIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  readonly active?: boolean;
  readonly activeClassName?: string;
  readonly children: ReactNode;
  readonly type?: "button" | "submit" | "reset";
};

export const ChromeIconButton = forwardRef<HTMLButtonElement, ChromeIconButtonProps>(function ChromeIconButton({
  active = false,
  activeClassName,
  children,
  className,
  type = "button",
  ...buttonProps
}, ref) {
  return (
  <button
    {...buttonProps}
    ref={ref}
    type={type}
    className={cx(className, active && activeClassName)}
  >
    {children}
  </button>
  );
});
