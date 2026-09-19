import type { ReactNode } from "react";

export type LyraAppStateKind = "empty" | "loading" | "error";

const KIND_TONE: Record<LyraAppStateKind, "neutral" | "info" | "error"> = {
  empty: "neutral",
  loading: "info",
  error: "error"
};

export type LyraAppStateProps = {
  readonly kind: LyraAppStateKind;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly className?: string;
};

const ACTION_CLASS = "lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm";

/** Markup for empty/loading/error. Visual source is `.lyra-app-state` in desktop app-ui. */
export const LyraAppState = ({
  kind,
  title,
  description,
  actions,
  actionLabel,
  onAction,
  className
}: LyraAppStateProps): ReactNode => {
  const resolvedActions = actions ?? (
    actionLabel !== undefined && onAction !== undefined
      ? (
        <button type="button" className={ACTION_CLASS} onClick={onAction}>
          {actionLabel}
        </button>
      )
      : undefined
  );
  const classNames = [
    "lyra-app-state",
    `lyra-app-state-${kind}`,
    "lyra-app-state-density-default",
    "lyra-app-state-align-center",
    `lyra-app-state-tone-${KIND_TONE[kind]}`,
    className
  ].filter((value): value is string => value !== undefined && value.length > 0);

  return (
    <div
      className={classNames.join(" ")}
      role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}
      aria-busy={kind === "loading" ? true : undefined}
    >
      <span className="lyra-app-state-icon" aria-hidden="true">
        <span className="lyra-app-logo-mark lyra-app-state-logo" />
      </span>
      <span className="lyra-app-state-copy">
        <strong className="lyra-app-state-title">{title}</strong>
        {description === undefined ? null : (
          <span className="lyra-app-state-description">{description}</span>
        )}
      </span>
      {resolvedActions === undefined ? null : (
        <span className="lyra-app-state-actions">{resolvedActions}</span>
      )}
    </div>
  );
};
