import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../utils";

export type AppBadgeTone = "neutral" | "success" | "warning" | "error" | "info";

export type AppBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  readonly tone?: AppBadgeTone;
};

export const AppBadge = forwardRef<HTMLSpanElement, AppBadgeProps>(({
  className,
  tone = "neutral",
  ...props
}, ref) => (
  <span
    ref={ref}
    className={cn("lyra-app-badge", `lyra-app-badge-${tone}`, className)}
    {...props}
  />
));

AppBadge.displayName = "AppBadge";
