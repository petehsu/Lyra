import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "../utils";

export type AppSidebarProps = HTMLAttributes<HTMLElement>;

/**
 * Sidebar navigation container. Compose with `AppSidebarSection` + `AppObjectRow`
 * items (give each row `className="lyra-app-sidebar-nav-item"`). Visuals come from
 * the shared `.lyra-app-sidebar-nav*` styles, not per-surface CSS.
 */
export const AppSidebar = forwardRef<HTMLElement, AppSidebarProps>(({
  className,
  ...props
}, ref) => (
  <aside ref={ref} className={cn("lyra-app-sidebar-nav", className)} {...props} />
));

AppSidebar.displayName = "AppSidebar";

export type AppSidebarSectionProps = HTMLAttributes<HTMLDivElement> & {
  readonly label?: ReactNode;
};

export const AppSidebarSection = forwardRef<HTMLDivElement, AppSidebarSectionProps>(({
  children,
  className,
  label,
  ...props
}, ref) => (
  <div ref={ref} className={cn("lyra-app-sidebar-nav-list", className)} {...props}>
    {label === undefined ? null : (
      <span className="lyra-app-sidebar-nav-label">{label}</span>
    )}
    {children}
  </div>
));

AppSidebarSection.displayName = "AppSidebarSection";
