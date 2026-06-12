import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "../utils";

export type AppShellProps = HTMLAttributes<HTMLElement>;

export const AppShell = forwardRef<HTMLElement, AppShellProps>(({ className, ...props }, ref) => (
  <main ref={ref} className={cn("lyra-ui-app-shell", className)} {...props} />
));

AppShell.displayName = "AppShell";

export const AppShellTitlebar = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(({ className, ...props }, ref) => (
  <header ref={ref} className={cn("lyra-ui-app-shell-titlebar", className)} {...props} />
));

AppShellTitlebar.displayName = "AppShellTitlebar";

export const AppShellMain = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(({ className, ...props }, ref) => (
  <section ref={ref} className={cn("lyra-ui-app-shell-main", className)} {...props} />
));

AppShellMain.displayName = "AppShellMain";

export const AppShellWorkspace = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(({ className, ...props }, ref) => (
  <section ref={ref} className={cn("lyra-ui-app-shell-workspace", className)} {...props} />
));

AppShellWorkspace.displayName = "AppShellWorkspace";
