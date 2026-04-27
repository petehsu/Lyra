import type { HTMLAttributes, ReactNode } from "react";

import { cx } from "./classnames";

export type ChromeToolbarProps = HTMLAttributes<HTMLDivElement> & {
  readonly children: ReactNode;
};

export const ChromeToolbar = ({
  children,
  className,
  ...toolbarProps
}: ChromeToolbarProps) => (
  <div {...toolbarProps} className={cx(className)}>
    {children}
  </div>
);
