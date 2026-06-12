import { type CSSProperties, type HTMLAttributes } from "react";

import lyraMark from "../../assets/brand/lyra-mark.svg";

export type LyraLogoProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  readonly alt?: string;
};

const LOGO_STYLE = {
  "--lyra-app-logo-url": `url("${lyraMark}")`
} as CSSProperties;

export const LyraLogo = ({
  alt = "Lyra",
  className,
  role,
  style,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
  ...props
}: LyraLogoProps) => {
  const decorative = alt.length === 0;

  return (
    <span
      {...props}
      aria-hidden={decorative ? true : ariaHidden}
      aria-label={decorative ? undefined : ariaLabel ?? alt}
      className={["lyra-app-logo-mark", className].filter(Boolean).join(" ")}
      role={decorative ? undefined : role ?? "img"}
      style={{ ...LOGO_STYLE, ...style }}
    />
  );
};
