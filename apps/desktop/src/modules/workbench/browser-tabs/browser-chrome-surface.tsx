import type { ReactNode } from "react";

type BrowserChromeSurfaceProps = {
  readonly toolbar: ReactNode;
  readonly tabStrip: ReactNode;
};

export const BrowserChromeSurface = ({
  toolbar,
  tabStrip
}: BrowserChromeSurfaceProps) => (
  <div className="lyra-browser-chrome-surface">
    {toolbar}
    {tabStrip}
  </div>
);
