import type { CSSProperties } from "react";

type BlurPosition = "top" | "bottom" | "left" | "right";
type BlurCurve = "linear" | "bezier" | "ease-in" | "ease-out";

type GradualBlurProps = {
  readonly position?: BlurPosition;
  readonly strength?: number;
  readonly height?: string;
  readonly width?: string;
  readonly divCount?: number;
  readonly exponential?: boolean;
  readonly curve?: BlurCurve;
  readonly opacity?: number;
  readonly target?: "parent" | "page";
  readonly zIndex?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
};

const curves: Record<BlurCurve, (progress: number) => number> = {
  linear: (progress) => progress,
  bezier: (progress) => progress * progress * (3 - 2 * progress),
  "ease-in": (progress) => progress * progress,
  "ease-out": (progress) => 1 - (1 - progress) ** 2
};

const directions: Record<BlurPosition, string> = {
  top: "to top",
  bottom: "to bottom",
  left: "to left",
  right: "to right"
};

export function GradualBlur({
  position = "bottom",
  strength = 2,
  height = "6rem",
  width,
  divCount = 5,
  exponential = false,
  curve = "linear",
  opacity = 1,
  target = "parent",
  zIndex = 15,
  className = "",
  style
}: GradualBlurProps) {
  const count = Math.max(1, Math.floor(divCount));
  const increment = 100 / count;
  const curveFunction = curves[curve];
  const isVertical = position === "top" || position === "bottom";
  const edgeStyle = isVertical
    ? {
        [position]: 0,
        left: 0,
        right: 0,
        width: width ?? "100%",
        height
      }
    : {
        [position]: 0,
        top: 0,
        bottom: 0,
        width: width ?? height,
        height: "100%"
      };

  return (
    <div
      aria-hidden="true"
      className={`gradual-blur ${className}`.trim()}
      style={{
        position: target === "page" ? "fixed" : "absolute",
        zIndex,
        ...edgeStyle,
        ...style
      }}
    >
      <div className="gradual-blur-inner">
        {Array.from({ length: count }, (_, index) => {
          const layer = index + 1;
          const progress = curveFunction(layer / count);
          const blur = exponential
            ? 2 ** (progress * 4) * 0.0625 * strength
            : 0.0625 * (progress * count + 1) * strength;
          const start = Math.round((increment * layer - increment) * 10) / 10;
          const solidStart = Math.round(increment * layer * 10) / 10;
          const solidEnd =
            Math.round((increment * layer + increment) * 10) / 10;
          const end =
            Math.round((increment * layer + increment * 2) * 10) / 10;
          const stops = [
            `transparent ${start}%`,
            `black ${solidStart}%`,
            solidEnd <= 100 ? `black ${solidEnd}%` : "",
            end <= 100 ? `transparent ${end}%` : ""
          ].filter(Boolean);
          const mask = `linear-gradient(${directions[position]}, ${stops.join(", ")})`;

          return (
            <div
              key={layer}
              style={{
                position: "absolute",
                inset: 0,
                maskImage: mask,
                WebkitMaskImage: mask,
                backdropFilter: `blur(${blur.toFixed(3)}rem)`,
                WebkitBackdropFilter: `blur(${blur.toFixed(3)}rem)`,
                opacity
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
