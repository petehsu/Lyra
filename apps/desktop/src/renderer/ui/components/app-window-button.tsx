import { forwardRef } from "react";

import { AppIconButton, type AppIconButtonProps } from "./app-icon-button";
import { cn } from "../utils";

export type AppWindowButtonAction = "minimize" | "maximize" | "close";

export type AppWindowButtonProps = Omit<AppIconButtonProps, "active" | "tone"> & {
  readonly action: AppWindowButtonAction;
  readonly active?: boolean;
};

export const AppWindowButton = forwardRef<HTMLButtonElement, AppWindowButtonProps>(({
  action,
  active = false,
  className,
  ...props
}, ref) => (
  <AppIconButton
    ref={ref}
    active={active}
    tone={action === "close" ? "danger" : "muted"}
    data-window-action={action}
    className={cn("lyra-app-window-button", className)}
    {...props}
  />
));

AppWindowButton.displayName = "AppWindowButton";
