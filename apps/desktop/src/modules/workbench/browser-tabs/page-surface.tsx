import { useEffect, useRef } from "react";

import type { WorkspaceTabPageMeta } from "../workspace-tabs/types";

export type BrowserPageNavigationState = {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
};

export type BrowserPageNavigator = {
  readonly goBack: () => void;
  readonly goForward: () => void;
};

export type BrowserPageSurfaceProps = {
  readonly tabId: string;
  readonly address: string;
  readonly onPageMetaChange?: (tabId: string, meta: WorkspaceTabPageMeta) => void;
  readonly onNavigationStateChange?: (tabId: string, state: BrowserPageNavigationState) => void;
  readonly onNavigatorReady?: (tabId: string, navigator: BrowserPageNavigator | null) => void;
};

type PageTitleUpdatedEvent = Event & {
  readonly title?: string;
};

type PageFaviconUpdatedEvent = Event & {
  readonly favicons?: readonly string[];
};

export const BrowserPageSurface = ({
  tabId,
  address,
  onPageMetaChange,
  onNavigationStateChange,
  onNavigatorReady
}: BrowserPageSurfaceProps) => {
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const domReadyRef = useRef(false);
  const onPageMetaChangeRef = useRef(onPageMetaChange);
  const onNavigationStateChangeRef = useRef(onNavigationStateChange);
  const onNavigatorReadyRef = useRef(onNavigatorReady);

  useEffect(() => {
    onPageMetaChangeRef.current = onPageMetaChange;
  }, [onPageMetaChange]);

  useEffect(() => {
    onNavigationStateChangeRef.current = onNavigationStateChange;
  }, [onNavigationStateChange]);

  useEffect(() => {
    onNavigatorReadyRef.current = onNavigatorReady;
  }, [onNavigatorReady]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (webview === null) {
      return;
    }
    domReadyRef.current = false;

    webview.setAttribute("allowpopups", "true");

    const readNavigationState = (): BrowserPageNavigationState => {
      if (domReadyRef.current === false) {
        return {
          canGoBack: false,
          canGoForward: false
        };
      }

      try {
        return {
          canGoBack: webview.canGoBack(),
          canGoForward: webview.canGoForward()
        };
      } catch (_error) {
        return {
          canGoBack: false,
          canGoForward: false
        };
      }
    };

    const publishNavigationState = (): void => {
      onNavigationStateChangeRef.current?.(tabId, readNavigationState());
    };

    onNavigatorReadyRef.current?.(tabId, {
      goBack: () => {
        if (domReadyRef.current === false) {
          return;
        }
        try {
          if (webview.canGoBack()) {
            webview.goBack();
          }
        } catch (_error) {
          // webview might be detaching; keep navigator safe.
        }
      },
      goForward: () => {
        if (domReadyRef.current === false) {
          return;
        }
        try {
          if (webview.canGoForward()) {
            webview.goForward();
          }
        } catch (_error) {
          // webview might be detaching; keep navigator safe.
        }
      }
    });

    const handlePageTitleUpdated = (event: Event): void => {
      const title = (event as PageTitleUpdatedEvent).title?.trim();
      if (title === undefined || title.length === 0) {
        return;
      }
      onPageMetaChangeRef.current?.(tabId, { title });
    };

    const handlePageFaviconUpdated = (event: Event): void => {
      const nextIcon = (event as PageFaviconUpdatedEvent).favicons?.find(
        (item): item is string => typeof item === "string" && item.trim().length > 0
      );
      if (nextIcon === undefined) {
        return;
      }
      onPageMetaChangeRef.current?.(tabId, { faviconUrl: nextIcon });
    };

    const handleNavigationUpdated = (): void => {
      if (domReadyRef.current === false) {
        return;
      }
      publishNavigationState();
    };

    const handleDomReady = (): void => {
      domReadyRef.current = true;
      publishNavigationState();
    };

    webview.addEventListener(
      "page-title-updated",
      handlePageTitleUpdated as EventListener
    );
    webview.addEventListener(
      "page-favicon-updated",
      handlePageFaviconUpdated as EventListener
    );
    webview.addEventListener(
      "did-navigate",
      handleNavigationUpdated as EventListener
    );
    webview.addEventListener(
      "did-navigate-in-page",
      handleNavigationUpdated as EventListener
    );
    webview.addEventListener(
      "did-stop-loading",
      handleNavigationUpdated as EventListener
    );
    webview.addEventListener(
      "dom-ready",
      handleDomReady as EventListener
    );

    publishNavigationState();

    return () => {
      domReadyRef.current = false;
      webview.removeEventListener(
        "page-title-updated",
        handlePageTitleUpdated as EventListener
      );
      webview.removeEventListener(
        "page-favicon-updated",
        handlePageFaviconUpdated as EventListener
      );
      webview.removeEventListener(
        "did-navigate",
        handleNavigationUpdated as EventListener
      );
      webview.removeEventListener(
        "did-navigate-in-page",
        handleNavigationUpdated as EventListener
      );
      webview.removeEventListener(
        "did-stop-loading",
        handleNavigationUpdated as EventListener
      );
      webview.removeEventListener(
        "dom-ready",
        handleDomReady as EventListener
      );
      onNavigatorReadyRef.current?.(tabId, null);
    };
  }, [tabId, address]);

  return (
    <section className="lyra-page-shell" aria-label="page-surface">
      <webview
        ref={(node) => {
          webviewRef.current = node as Electron.WebviewTag | null;
        }}
        className="lyra-page-webview"
        src={address}
      />
    </section>
  );
};
