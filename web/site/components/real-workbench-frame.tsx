"use client";

import { useEffect, useRef, type ReactNode } from "react";

type RealWorkbenchFrameProps = {
  readonly siteSurface: ReactNode;
};

type WorkbenchStateMessage = {
  readonly type: "lyra:workbench-state";
  readonly bounds: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
  readonly activeTabId: string | null;
  readonly siteActive: boolean;
};

const isWorkbenchStateMessage = (
  value: unknown
): value is WorkbenchStateMessage => {
  if (value === null || typeof value !== "object") return false;
  const message = value as Partial<WorkbenchStateMessage>;
  const bounds = message.bounds;
  return message.type === "lyra:workbench-state"
    && bounds !== undefined
    && Number.isFinite(bounds.left)
    && Number.isFinite(bounds.top)
    && Number.isFinite(bounds.right)
    && Number.isFinite(bounds.bottom)
    && (typeof message.activeTabId === "string" || message.activeTabId === null)
    && typeof message.siteActive === "boolean";
};

/**
 * The desktop shell is not redrawn here. The iframe is a browser build of the
 * real WorkbenchShell used by apps/desktop and Lyra UI Studio. The website
 * surface remains a single DOM node above the real workspace viewport so the
 * opening camera can pull back without swapping screenshots or duplicate copy.
 */
export function RealWorkbenchFrame({ siteSurface }: RealWorkbenchFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const receiveGeometry = (event: MessageEvent<unknown>) => {
      const iframe = iframeRef.current;
      const frame = frameRef.current;
      if (
        iframe === null
        || frame === null
        || event.origin !== window.location.origin
        || event.source !== iframe.contentWindow
        || !isWorkbenchStateMessage(event.data)
      ) {
        return;
      }

      const { bounds, siteActive } = event.data;
      const wasMeasured = frame.dataset.workspaceMeasured === "true";
      const wasSiteActive = frame.dataset.siteActive !== "false";
      frame.style.setProperty("--workbench-site-left", `${bounds.left}px`);
      frame.style.setProperty("--workbench-site-top", `${bounds.top}px`);
      frame.style.setProperty("--workbench-site-right", `${bounds.right}px`);
      frame.style.setProperty("--workbench-site-bottom", `${bounds.bottom}px`);
      frame.dataset.workspaceMeasured = "true";
      frame.dataset.siteActive = siteActive ? "true" : "false";
      if (!wasMeasured) {
        window.dispatchEvent(new Event("lyra:workbench-geometry"));
      }
      if (siteActive !== wasSiteActive) {
        window.dispatchEvent(new CustomEvent("lyra:workbench-site-active", {
          detail: { active: siteActive }
        }));
      }
    };

    window.addEventListener("message", receiveGeometry);
    return () => window.removeEventListener("message", receiveGeometry);
  }, []);

  return (
    <div ref={frameRef} className="real-workbench-frame" data-site-active="true">
      <iframe
        ref={iframeRef}
        className="real-workbench-renderer"
        src="/workbench-preview/index.html"
        title="Lyra desktop workbench"
        loading="eager"
      />
      <div className="real-workbench-site-viewport">
        {siteSurface}
      </div>
    </div>
  );
}
