import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../utils";

export type AppListProps = HTMLAttributes<HTMLDivElement>;

/**
 * Vertical list container for `AppObjectRow` items. Provides the shared
 * `.lyra-app-row-list` spacing/state context so surfaces stop hand-rolling the
 * wrapper div. Layout-only; row visuals come from `AppObjectRow`.
 */
export const AppList = forwardRef<HTMLDivElement, AppListProps>(({
  className,
  ...props
}, ref) => (
  <div ref={ref} className={cn("lyra-app-row-list", className)} {...props} />
));

AppList.displayName = "AppList";
