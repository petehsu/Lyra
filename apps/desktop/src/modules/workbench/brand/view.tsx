import { useMemo, type CSSProperties } from "react";

import type { LyraBrandLogoProps } from "./types";

export const LyraBrandLogo = ({
  logoUrl,
  className,
  blinkEyes = false,
  blinkLogoUrl
}: LyraBrandLogoProps) => {
  const style = useMemo(
    () =>
      ({
        "--lyra-brand-logo-url": `url("${logoUrl}")`,
        "--lyra-brand-logo-blink-url": `url("${blinkLogoUrl ?? logoUrl}")`
      }) as CSSProperties,
    [blinkLogoUrl, logoUrl]
  );

  return (
    <span
      aria-hidden="true"
      className={[
        "lyra-brand-logo",
        blinkEyes ? "lyra-brand-logo-blink" : "",
        className
      ]
        .filter((value) => value !== undefined && value.length > 0)
        .join(" ")}
      style={style}
    />
  );
};
