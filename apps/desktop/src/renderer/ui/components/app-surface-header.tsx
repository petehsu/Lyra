import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { cn } from "../utils";

export type AppSurfaceHeaderProps = HTMLAttributes<HTMLElement> & {
  readonly actions?: ReactNode;
  readonly description?: ReactNode;
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
};

export const AppSurfaceHeader = forwardRef<HTMLElement, AppSurfaceHeaderProps>(({
  actions,
  className,
  description,
  eyebrow,
  title,
  ...props
}, ref) => (
  <header ref={ref} className={cn("lyra-app-surface-header", className)} {...props}>
    <div className="lyra-app-surface-header-copy">
      {eyebrow === undefined ? null : <span className="lyra-app-surface-header-eyebrow">{eyebrow}</span>}
      <h2 className="lyra-app-surface-header-title">{title}</h2>
      {description === undefined ? null : <p className="lyra-app-surface-header-description">{description}</p>}
    </div>
    {actions === undefined ? null : <div className="lyra-app-surface-header-actions">{actions}</div>}
  </header>
));

AppSurfaceHeader.displayName = "AppSurfaceHeader";
