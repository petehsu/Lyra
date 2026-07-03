import {
  forwardRef,
  type ForwardedRef,
  type HTMLAttributes,
  type ReactNode
} from "react";

import { LyraLogo } from "../app";
import { cn } from "../utils";

export type AppStateDensity = "compact" | "default" | "spacious";
export type AppStateAlign = "start" | "center";
export type AppStateTone = "neutral" | "info" | "success" | "warning" | "error";

type AppStateProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  readonly actions?: ReactNode;
  readonly align?: AppStateAlign;
  readonly density?: AppStateDensity;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly tone?: AppStateTone;
};

const LYRA_STATE_LOGO = <LyraLogo className="lyra-app-state-logo" alt="" />;

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
) => {
  const iconNode = icon === false ? null : icon;

  return (
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
      {iconNode === undefined || iconNode === null ? null : (
        <span className="lyra-app-state-icon" aria-hidden="true">
          {iconNode}
        </span>
      )}
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
};

export const AppEmptyState = forwardRef<HTMLDivElement, AppEmptyStateProps>((props, ref) =>
  renderState("empty", LYRA_STATE_LOGO, props, ref)
);

AppEmptyState.displayName = "AppEmptyState";

export const AppLoadingState = forwardRef<HTMLDivElement, AppLoadingStateProps>(({
  tone = "info",
  ...props
}, ref) =>
  renderState(
    "loading",
    LYRA_STATE_LOGO,
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
  renderState("error", LYRA_STATE_LOGO, { tone, ...props }, ref)
);

AppErrorState.displayName = "AppErrorState";
