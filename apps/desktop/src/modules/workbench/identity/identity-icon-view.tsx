import { useState, type ReactNode, type SyntheticEvent } from "react";

import { cn } from "@renderer/ui/utils";

export type IdentityIconViewProps = {
  readonly iconUrl?: string | null | undefined;
  readonly label?: string | undefined;
  readonly className?: string | undefined;
  readonly imageClassName?: string | undefined;
  readonly fallback: ReactNode;
};

export const IdentityIconView = ({
  iconUrl,
  label,
  className,
  imageClassName,
  fallback
}: IdentityIconViewProps) => {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const normalizedUrl = iconUrl?.trim() ?? "";
  const showImage = normalizedUrl.length > 0 && normalizedUrl !== failedUrl;

  return (
    <span className={cn("lyra-identity-icon", className)} title={label}>
      {showImage ? (
        <img
          src={normalizedUrl}
          alt=""
          className={cn("lyra-identity-icon-image", imageClassName)}
          loading="eager"
          decoding="async"
          onError={(event: SyntheticEvent<HTMLImageElement>) => {
            setFailedUrl(event.currentTarget.src);
          }}
        />
      ) : (
        <span className="lyra-identity-icon-fallback" aria-hidden="true">
          {fallback}
        </span>
      )}
    </span>
  );
};
