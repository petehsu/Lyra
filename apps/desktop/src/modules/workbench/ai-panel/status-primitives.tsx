import type { ReactNode } from "react";

import { SpinnerLabel, type SpinnerLabelProps } from "./stream-spinner";

export { SpinnerLabel };
export type { SpinnerLabelProps };

export type StatusTone = "muted" | "info" | "success" | "warning" | "danger";
export type StatusIndicatorVariant = "dot" | "bar" | "icon";

export type StatusIndicatorProps = {
  readonly tone?: StatusTone;
  readonly variant?: StatusIndicatorVariant;
  readonly icon?: ReactNode;
  readonly ariaLabel?: string;
  readonly className?: string;
};

export type StatusBadgeProps = {
  readonly tone?: StatusTone;
  readonly label: string;
  readonly leading?: ReactNode;
  readonly className?: string;
};

export type LinearProgressProps = {
  readonly value: number;
  readonly maxValue: number;
  readonly tone?: StatusTone;
  readonly ariaLabel?: string;
  readonly className?: string;
};

export type StatusEmptyStateProps = {
  readonly title: string;
  readonly description?: string;
  readonly loading?: boolean;
  readonly spinnerLabel?: string;
  readonly spinnerVariant?: SpinnerLabelProps["variant"];
  readonly tone?: StatusTone;
  readonly className?: string;
};

const joinClassNames = (...values: Array<string | false | null | undefined>): string =>
  values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");

export const StatusIndicator = ({
  tone = "muted",
  variant = "dot",
  icon,
  ariaLabel,
  className,
}: StatusIndicatorProps) => {
  if (variant === "icon") {
    return (
      <span
        className={joinClassNames(
          "lyra-ai-status-indicator",
          "lyra-ai-status-indicator-icon",
          `lyra-ai-status-indicator-tone-${tone}`,
          className
        )}
        role="img"
        {...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel })}
      >
        {icon}
      </span>
    );
  }

  return (
    <span
      className={joinClassNames(
        "lyra-ai-status-indicator",
        `lyra-ai-status-indicator-${variant}`,
        `lyra-ai-status-indicator-tone-${tone}`,
        className
      )}
      aria-hidden={ariaLabel === undefined}
      {...(ariaLabel === undefined ? {} : { role: "img", "aria-label": ariaLabel })}
    />
  );
};

export const StatusBadge = ({
  tone = "muted",
  label,
  leading,
  className,
}: StatusBadgeProps) => (
  <span
    className={joinClassNames(
      "lyra-ai-status-badge",
      `lyra-ai-status-badge-tone-${tone}`,
      className
    )}
  >
    {leading === undefined ? null : (
      <span className="lyra-ai-status-badge-leading">{leading}</span>
    )}
    <span className="lyra-ai-status-badge-label">{label}</span>
  </span>
);

export const LinearProgress = ({
  value,
  maxValue,
  tone = "info",
  ariaLabel,
  className,
}: LinearProgressProps) => {
  const safeMax = Math.max(1, maxValue);
  const ratio = Math.max(0, Math.min(1, value / safeMax));
  return (
    <div
      className={joinClassNames("lyra-ai-linear-progress", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Math.round(ratio * safeMax)}
      {...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel })}
    >
      <span className="lyra-ai-linear-progress-track" />
      <span
        className={joinClassNames(
          "lyra-ai-linear-progress-fill",
          `lyra-ai-linear-progress-fill-tone-${tone}`
        )}
        style={{ transform: `scaleX(${String(ratio)})` }}
      />
    </div>
  );
};

export const StatusEmptyState = ({
  title,
  description,
  loading = false,
  spinnerLabel,
  spinnerVariant = "dots",
  tone = "muted",
  className,
}: StatusEmptyStateProps) => (
  <div className={joinClassNames("lyra-ai-status-empty-state", className)}>
    <div className="lyra-ai-status-empty-state-head">
      {loading ? (
        <SpinnerLabel
          variant={spinnerVariant}
          tone={tone}
          size="sm"
          ariaLabel={title}
          {...(spinnerLabel === undefined ? {} : { label: spinnerLabel })}
        />
      ) : (
        <StatusIndicator tone={tone} variant="dot" ariaLabel={title} />
      )}
      <strong>{title}</strong>
    </div>
    {description === undefined || description.length === 0 ? null : (
      <span>{description}</span>
    )}
  </div>
);
