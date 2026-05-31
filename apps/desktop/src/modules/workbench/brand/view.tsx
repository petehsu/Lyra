import { useMemo, type CSSProperties } from "react";

import type {
  LyraBrandLogoMotion,
  LyraBrandLogoProps,
  LyraBrandLogoSpinIntensity
} from "./types";

const DEFAULT_SPIN_DURATION_MS: Record<
  LyraBrandLogoMotion,
  Record<LyraBrandLogoSpinIntensity, number>
> = {
  none: {
    subtle: 0,
    steady: 0,
    expressive: 0
  },
  ambient: {
    subtle: 18000,
    steady: 14000,
    expressive: 10000
  },
  active: {
    subtle: 9000,
    steady: 6400,
    expressive: 4200
  }
};

const normalizeSpinDuration = (
  motion: LyraBrandLogoMotion,
  intensity: LyraBrandLogoSpinIntensity,
  durationMs: number | undefined
): number => {
  if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0) {
    return durationMs;
  }
  return DEFAULT_SPIN_DURATION_MS[motion][intensity];
};

export const LyraBrandLogo = ({
  logoUrl,
  className,
  motion = "none",
  spinDirection = "clockwise",
  spinIntensity = "steady",
  spinDurationMs
}: LyraBrandLogoProps) => {
  const isRotating = motion !== "none";
  const normalizedDurationMs = normalizeSpinDuration(motion, spinIntensity, spinDurationMs);
  const style = useMemo(
    () =>
      ({
        "--lyra-brand-logo-url": `url("${logoUrl}")`,
        "--lyra-brand-logo-spin-duration": `${normalizedDurationMs}ms`,
        "--lyra-brand-logo-spin-turn": spinDirection === "clockwise" ? "1turn" : "-1turn"
      }) as CSSProperties,
    [logoUrl, normalizedDurationMs, spinDirection]
  );

  return (
    <span
      aria-hidden="true"
      className={[
        "lyra-brand-logo",
        isRotating ? "lyra-brand-logo-spin" : "",
        isRotating ? `lyra-brand-logo-spin-${motion}` : "",
        isRotating ? `lyra-brand-logo-spin-${spinIntensity}` : "",
        className
      ]
        .filter((value) => value !== undefined && value.length > 0)
        .join(" ")}
      data-motion={motion}
      data-spin-direction={spinDirection}
      data-spin-intensity={spinIntensity}
      style={style}
    />
  );
};
