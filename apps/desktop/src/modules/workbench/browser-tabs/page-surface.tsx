import { useCallback } from "react";

export type BrowserPageSurfaceProps = {
  readonly tabId: string;
  readonly onHostChange?: (tabId: string, element: HTMLElement | null) => void;
};

export const BrowserPageSurface = ({
  tabId,
  onHostChange
}: BrowserPageSurfaceProps) => {
  const handleHostRef = useCallback(
    (element: HTMLElement | null) => {
      onHostChange?.(tabId, element);
    },
    [onHostChange, tabId]
  );

  return (
    <section
      ref={handleHostRef}
      className="lyra-page-host"
      aria-label="page-surface"
      data-browser-page-host="true"
      data-tab-id={tabId}
    />
  );
};
