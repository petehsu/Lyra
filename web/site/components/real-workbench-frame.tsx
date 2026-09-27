"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { SiteLocale } from "@/lib/i18n";
import type { SiteTheme } from "@/lib/site-preferences";
import { createPreferenceAuthority } from "@/lib/preference-sync";
import { createWorkbenchModalBridge } from "@/lib/workbench-modal";

type RealWorkbenchFrameProps = {
  readonly locale: SiteLocale;
  readonly theme: SiteTheme | null;
  readonly siteSurface: ReactNode;
  readonly onThemeChange: (theme: SiteTheme) => void;
  readonly onLocaleChange: (locale: SiteLocale) => void;
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
  readonly aiPanelSide: "left" | "right";
  readonly themeTone: SiteTheme;
  readonly locale: string;
  readonly siteActive: boolean;
  readonly resizing?: boolean;
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
    && (message.aiPanelSide === "left" || message.aiPanelSide === "right")
    && (message.themeTone === "light" || message.themeTone === "dark")
    && typeof message.locale === "string"
    && (message.resizing === undefined || typeof message.resizing === "boolean")
    && typeof message.siteActive === "boolean";
};

// Target the browser page itself, including its pane in a split workspace.
// Settings and other tabs still supply a container while the site is hidden.
const workspaceSelector = ".lyra-workspace-surface-single, .lyra-workspace-surface-split";
const readWorkspaceTarget = (document: Document) => {
  const page = document.querySelector<HTMLElement>('.lyra-page-host[data-tab-id="lyra-site-tab"]');
  return page && !page.closest('[data-lyra-surface-hidden="true"]')
    ? page
    : document.querySelector<HTMLElement>(workspaceSelector);
};

/**
 * The desktop shell is not redrawn here. The iframe is a browser build of the
 * real WorkbenchShell used by apps/desktop and Lyra UI Studio. The website
 * surface remains a single DOM node above the real workspace viewport so the
 * opening camera can pull back without swapping screenshots or duplicate copy.
 */
export function RealWorkbenchFrame({
  locale: routeLocale,
  theme,
  siteSurface,
  onThemeChange,
  onLocaleChange
}: RealWorkbenchFrameProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const authority = useRef<ReturnType<typeof createPreferenceAuthority> | null>(null);
  const initial = useRef<{ theme: SiteTheme; locale: SiteLocale } | null>(null);
  if (theme !== null && initial.current === null) initial.current = { theme, locale: routeLocale };
  const preferences = useRef({ theme: theme ?? "light", locale: routeLocale });
  preferences.current = { theme: theme ?? "light", locale: routeLocale };

  useEffect(() => {
    if (theme === null) return;
    authority.current ??= createPreferenceAuthority({ theme, locale: routeLocale });
    const state = authority.current.update({ theme, locale: routeLocale });
    iframeRef.current?.contentWindow?.postMessage(state, location.origin);
  }, [theme, routeLocale]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type !== "lyra:preferences-ready" && event.data?.type !== "lyra:preferences-change") return;
      authority.current ??= createPreferenceAuthority(preferences.current);
      const current = authority.current;
      if (event.data.type === "lyra:preferences-change") {
        const next = current.receive(event.data.baseRevision, event.data.patch);
        if (next) {
          if (next.preferences.theme !== preferences.current.theme) onThemeChange(next.preferences.theme);
          if (next.preferences.locale !== preferences.current.locale) onLocaleChange(next.preferences.locale);
          preferences.current = next.preferences;
        }
      }
      // A stale report also receives the current version, not permission to
      // overwrite it. Sending this back is an acknowledgement, never a change.
      iframeRef.current?.contentWindow?.postMessage(current.snapshot(), location.origin);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [onThemeChange, onLocaleChange]);

  useEffect(() => {
    let stateRequestTimer: number | null = null;
    let directObserverCleanup: (() => void) | null = null;
    let directSync: (() => void) | null = null;

    const dispatchGeometryRefresh = () => {
      window.dispatchEvent(new Event("lyra:workbench-geometry"));
    };

    const applyWorkbenchState = (state: WorkbenchStateMessage) => {
      const frame = frameRef.current;
      if (frame === null) return;

      const { bounds, aiPanelSide, siteActive, themeTone } = state;
      const resizing = String(state.resizing ?? false);
      if (frame.dataset.layoutResizing !== resizing) frame.dataset.layoutResizing = resizing;
      const wasSiteActive = frame.dataset.siteActive !== "false";
      const geometrySignature = [
        bounds.left,
        bounds.top,
        bounds.right,
        bounds.bottom,
        aiPanelSide
      ].join(":");
      const geometryChanged = frame.dataset.workspaceGeometry !== geometrySignature;
      if (geometryChanged) {
        frame.style.setProperty("--workbench-site-left", `${bounds.left}px`);
        frame.style.setProperty("--workbench-site-top", `${bounds.top}px`);
        frame.style.setProperty("--workbench-site-right", `${bounds.right}px`);
        frame.style.setProperty("--workbench-site-bottom", `${bounds.bottom}px`);
        frame.dataset.workspaceMeasured = "true";
        frame.dataset.workspaceGeometry = geometrySignature;
        frame.dataset.aiPanelSide = aiPanelSide;
      }
      if (siteActive !== wasSiteActive) frame.dataset.siteActive = String(siteActive);
      if (frame.dataset.workbenchTheme !== themeTone) {
        frame.dataset.workbenchTheme = themeTone;
      }
      if (geometryChanged) {
        // Update the camera together with its content bounds. Delaying this
        // exposes workspace chrome when panels resize or the reveal reverses.
        // The consumer updates camera geometry without refreshing scroll ranges.
        dispatchGeometryRefresh();
      }
      if (siteActive !== wasSiteActive) {
        window.dispatchEvent(new CustomEvent("lyra:workbench-site-active", {
          detail: { active: siteActive }
        }));
      }
    };
    const receiveGeometry = (event: MessageEvent<unknown>) => {
      const iframe = iframeRef.current;
      if (
        iframe === null
        || event.origin !== window.location.origin
        || event.source !== iframe.contentWindow
        || !isWorkbenchStateMessage(event.data)
      ) {
        return;
      }
      // Once the same-origin renderer is observable, it is authoritative.
      // A queued postMessage must never overwrite newer drag/layout bounds.
      if (directSync) directSync();
      else if (!observeDirectWorkbenchState()) applyWorkbenchState(event.data);
    };
    const readDirectWorkbenchState = (): WorkbenchStateMessage | null => {
      const iframe = iframeRef.current;
      const document = iframe?.contentDocument;
      if (iframe === null || iframe === undefined || document === null || document === undefined) {
        return null;
      }
      const workspace = readWorkspaceTarget(document);
      if (workspace === null) return null;
      const bounds = workspace.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return null;
      const activeTabId = document
        .querySelector<HTMLElement>(".lyra-browser-tab-item-active[data-lyra-tab-id]")
        ?.dataset.lyraTabId ?? null;
      const aiPanelSide = document
        .querySelector<HTMLElement>(".lyra-main")
        ?.classList.contains("lyra-main-ai-panel-right")
        ? "right"
        : "left";
      const themeTone = document.documentElement.dataset.lyraThemeTone === "dark"
        ? "dark"
        : "light";
      return {
        type: "lyra:workbench-state",
        bounds: {
          left: bounds.left,
          top: bounds.top,
          right: Math.max(0, document.documentElement.clientWidth - bounds.right),
          bottom: Math.max(0, document.documentElement.clientHeight - bounds.bottom)
        },
        activeTabId,
        aiPanelSide,
        themeTone,
        locale: document.documentElement.lang || "en-US",
        resizing: document.body.classList.contains("lyra-layout-resizing"),
        siteActive: activeTabId === "lyra-site-tab"
      };
    };
    const observeDirectWorkbenchState = () => {
      const iframe = iframeRef.current;
      const document = iframe?.contentDocument;
      const state = readDirectWorkbenchState();
      if (
        iframe === null
        || iframe === undefined
        || document === null
        || document === undefined
        || state === null
      ) {
        return false;
      }
      directObserverCleanup?.();
      applyWorkbenchState(state);
      const frame = frameRef.current!;
      const surface = frame.querySelector<HTMLElement>(".real-workbench-site-viewport")!;
      const modalBridge = createWorkbenchModalBridge(document, frame, surface);
      let workspace: Element | null = null;
      const sync = () => {
        const nextWorkspace = readWorkspaceTarget(document);
        if (nextWorkspace !== workspace) {
          if (workspace) resizeObserver.unobserve(workspace);
          workspace = nextWorkspace;
          if (workspace) resizeObserver.observe(workspace);
        }
        const nextState = readDirectWorkbenchState();
        if (nextState !== null) applyWorkbenchState(nextState);
        modalBridge.sync(workspace, nextState?.siteActive ?? false);
      };
      const resizeObserver = new ResizeObserver(sync);
      resizeObserver.observe(document.documentElement);
      directSync = sync;
      sync();
      const mutationObserver = new MutationObserver(sync);
      mutationObserver.observe(document.documentElement, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["class", "style", "data-state", "hidden", "data-tab-id", "data-lyra-tab-id", "data-lyra-surface-hidden", "data-lyra-theme-tone", "lang"]
      });
      directObserverCleanup = () => {
        directSync = null;
        resizeObserver.disconnect();
        mutationObserver.disconnect();
        modalBridge.destroy();
      };
      return true;
    };
    const requestWorkbenchState = () => {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "lyra:workbench-state-request" },
        window.location.origin
      );
    };
    const beginStateHandshake = () => {
      directObserverCleanup?.();
      directObserverCleanup = null;
      if (stateRequestTimer !== null) window.clearInterval(stateRequestTimer);
      if (observeDirectWorkbenchState()) return;
      requestWorkbenchState();
      stateRequestTimer = window.setInterval(() => {
        if (observeDirectWorkbenchState()) {
          if (stateRequestTimer !== null) window.clearInterval(stateRequestTimer);
          stateRequestTimer = null;
          return;
        }
        requestWorkbenchState();
      }, 250);
    };

    window.addEventListener("message", receiveGeometry);
    iframeRef.current?.addEventListener("load", beginStateHandshake);
    beginStateHandshake();
    return () => {
      window.removeEventListener("message", receiveGeometry);
      iframeRef.current?.removeEventListener("load", beginStateHandshake);
      directObserverCleanup?.();
      if (stateRequestTimer !== null) window.clearInterval(stateRequestTimer);
    };
  }, [theme !== null]);

  return (
    <div
      ref={frameRef}
      className="real-workbench-frame"
      data-ai-panel-side="left"
      data-site-active="true"
    >
      {initial.current && <iframe
        ref={iframeRef}
        className="real-workbench-renderer"
        src={`/workbench-preview/index.html?locale=${initial.current.locale}&theme=${initial.current.theme}`}
        title="Lyra desktop workbench"
        loading="eager"
      />}
      <div className="real-workbench-site-viewport">
        {siteSurface}
      </div>
    </div>
  );
}
