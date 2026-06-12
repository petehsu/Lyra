import { forwardRef } from "react";

import { Button, type ButtonProps } from "../primitives";
import { cn } from "../utils";

export type AppIconButtonProps = Omit<ButtonProps, "size"> & {
  readonly active?: boolean;
  readonly tone?: "default" | "danger" | "muted";
};

export const AppIconButton = forwardRef<HTMLButtonElement, AppIconButtonProps>(({
  active = false,
  className,
  tone = "default",
  variant = "ghost",
  ...props
}, ref) => (
  <Button
    ref={ref}
    size="icon"
    variant={variant}
    data-active={active ? "true" : undefined}
    data-tone={tone}
    className={cn("lyra-app-icon-button", className)}
    {...props}
  />
));

AppIconButton.displayName = "AppIconButton";
