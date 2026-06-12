import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../utils";

export type AppPanelProps = HTMLAttributes<HTMLElement> & {
  readonly placement?: "left" | "right" | "bottom" | "center";
};

export const AppPanel = forwardRef<HTMLElement, AppPanelProps>(({
  className,
  placement = "center",
  ...props
}, ref) => (
  <section
    ref={ref}
    data-placement={placement}
    className={cn("lyra-app-panel", className)}
    {...props}
  />
));

AppPanel.displayName = "AppPanel";
