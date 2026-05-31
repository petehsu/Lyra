export type LyraBrandLogoMotion = "none" | "ambient" | "active";
export type LyraBrandLogoSpinDirection = "clockwise" | "counterclockwise";
export type LyraBrandLogoSpinIntensity = "subtle" | "steady" | "expressive";

export type LyraBrandLogoProps = {
  readonly logoUrl: string;
  readonly className?: string;
  readonly motion?: LyraBrandLogoMotion;
  readonly spinDirection?: LyraBrandLogoSpinDirection;
  readonly spinIntensity?: LyraBrandLogoSpinIntensity;
  readonly spinDurationMs?: number;
};
