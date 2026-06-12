import { CircleAlert, Loader2, Search } from "lucide-react";
import {
  forwardRef,
  type ForwardedRef,
  type HTMLAttributes,
  type ReactNode
} from "react";

import { cn } from "../utils";

export type AppStateDensity = "compact" | "default" | "spacious";
export type AppStateAlign = "start" | "center";
export type AppStateTone = "neutral" | "info" | "success" | "warning" | "error";

type AppStateProps = HTMLAttributes<HTMLDivElement> & {
  readonly actions?: ReactNode;
  readonly align?: AppStateAlign;
  readonly density?: AppStateDensity;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly tone?: AppStateTone;
};

export type AppEmptyStateProps = AppStateProps;
export type AppLoadingStateProps = Omit<AppStateProps, "tone"> & {
  readonly tone?: Extract<AppStateTone, "neutral" | "info">;
};
export type AppErrorStateProps = Omit<AppStateProps, "tone"> & {
  readonly tone?: Extract<AppStateTone, "error" | "warning">;
};

const renderState = (
  kind: "empty" | "loading" | "error",
  fallbackIcon: ReactNode,
  {
    actions,
    align = "center",
    className,
    density = "default",
    description,
    icon = fallbackIcon,
    title,
    tone = "neutral",
    ...props
  }: AppStateProps,
  ref: ForwardedRef<HTMLDivElement>
) => (
  <div
    ref={ref}
    className={cn(
      "lyra-app-state",
      `lyra-app-state-${kind}`,
      `lyra-app-state-density-${density}`,
      `lyra-app-state-align-${align}`,
      `lyra-app-state-tone-${tone}`,
      className
    )}
    {...props}
  >
    <span className="lyra-app-state-icon" aria-hidden="true">
      {icon}
    </span>
    <span className="lyra-app-state-copy">
      <strong className="lyra-app-state-title">{title}</strong>
      {description === undefined ? null : (
        <span className="lyra-app-state-description">{description}</span>
      )}
    </span>
    {actions === undefined ? null : (
      <span className="lyra-app-state-actions">{actions}</span>
    )}
  </div>
);

export const AppEmptyState = forwardRef<HTMLDivElement, AppEmptyStateProps>((props, ref) =>
  renderState("empty", <Search aria-hidden="true" />, props, ref)
);

AppEmptyState.displayName = "AppEmptyState";

export const AppLoadingState = forwardRef<HTMLDivElement, AppLoadingStateProps>(({
  tone = "info",
  ...props
}, ref) =>
  renderState(
    "loading",
    <Loader2 aria-hidden="true" />,
    {
      "aria-busy": true,
      tone,
      ...props
    },
    ref
  )
);

AppLoadingState.displayName = "AppLoadingState";

export const AppErrorState = forwardRef<HTMLDivElement, AppErrorStateProps>(({
  tone = "error",
  ...props
}, ref) =>
  renderState("error", <CircleAlert aria-hidden="true" />, { tone, ...props }, ref)
);

AppErrorState.displayName = "AppErrorState";
