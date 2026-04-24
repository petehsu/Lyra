import { useEffect, useMemo, useState, type ReactNode } from "react";

const SPINNER_VARIANTS = {
  dots: {
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const,
    frameDurationMs: 100,
  },
  sand: {
    frames: [
      "⠁", "⠂", "⠄", "⡀", "⡈", "⡐", "⡠", "⣀", "⣁", "⣂", "⣄", "⣌", "⣔", "⣤",
      "⣥", "⣦", "⣮", "⣶", "⣷", "⣿", "⡿", "⠿", "⢟", "⠟", "⡛", "⠛", "⠫", "⢋",
      "⠋", "⠍", "⡉", "⠉", "⠑", "⠡", "⢁",
    ] as const,
    frameDurationMs: 60,
  },
} as const;

type SpinnerVariant = keyof typeof SPINNER_VARIANTS;
type SpinnerTone = "muted" | "info" | "warning" | "success" | "danger";
type SpinnerSize = "sm" | "md";

export type SpinnerLabelProps = {
  readonly ariaLabel?: string;
  readonly label?: string;
  readonly variant?: SpinnerVariant;
  readonly tone?: SpinnerTone;
  readonly size?: SpinnerSize;
  readonly className?: string;
  readonly glyphClassName?: string;
  readonly labelClassName?: string;
};

const joinClassNames = (...values: Array<string | false | null | undefined>): string =>
  values.filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");

export const SpinnerLabel = ({
  ariaLabel,
  label,
  variant = "dots",
  tone = "muted",
  size = "md",
  className,
  glyphClassName,
  labelClassName,
}: SpinnerLabelProps) => {
  const spec = SPINNER_VARIANTS[variant];
  const frames = useMemo(() => [...spec.frames], [spec.frames]);
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const handle = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % frames.length);
    }, spec.frameDurationMs);
    return () => {
      window.clearInterval(handle);
    };
  }, [frames.length, spec.frameDurationMs]);

  return (
    <span
      className={joinClassNames(
        "lyra-ai-spinner-label",
        `lyra-ai-spinner-label-${size}`,
        `lyra-ai-spinner-label-tone-${tone}`,
        className
      )}
      role="status"
      aria-live="polite"
      {...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel })}
    >
      <span className={joinClassNames("lyra-ai-stream-spinner", glyphClassName)}>
        {frames[frameIndex]}
      </span>
      {label === undefined || label.length === 0 ? null : (
        <span className={joinClassNames("lyra-ai-spinner-label-text", labelClassName)}>
          {label}
        </span>
      )}
    </span>
  );
};

type StreamSpinnerProps = {
  readonly ariaLabel?: string;
};

export const StreamSpinner = ({ ariaLabel }: StreamSpinnerProps): ReactNode => (
  <SpinnerLabel
    variant="dots"
    size="md"
    tone="muted"
    {...(ariaLabel === undefined ? {} : { ariaLabel })}
  />
);
