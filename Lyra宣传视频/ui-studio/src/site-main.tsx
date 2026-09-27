import { useEffect } from "react";
import { createRoot } from "react-dom/client";

import { WorkbenchI18nProvider } from "@workbench/i18n";
import { WorkbenchShell } from "@workbench/shell";
import { AppErrorBoundary, AppStatusProvider } from "@renderer/ui/components";

import "@fontsource/geist-sans/latin.css";
import "@fontsource/geist-mono/latin.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource/zen-dots/latin.css";
import "@renderer/styles/index.scss";
import "./studio.css";

const rootElement = document.getElementById("app");

if (rootElement === null) {
  throw new Error("UI Studio root #app is missing");
}

const WorkbenchGeometryReporter = () => {
  useEffect(() => {
    let lastState = "";
    let workspace: HTMLElement | null = null;
    let dragFrame: number | null = null;
    let syncFrame: number | null = null;

    const workspaceTarget = () => {
      const page = document.querySelector<HTMLElement>('.lyra-page-host[data-tab-id="lyra-site-tab"]');
      return page && !page.closest('[data-lyra-surface-hidden="true"]')
        ? page
        : document.querySelector<HTMLElement>(".lyra-workspace-surface-single, .lyra-workspace-surface-split");
    };

    const report = () => {
      workspace ??= workspaceTarget();
      if (workspace === null) return;

      const bounds = workspace.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;

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
      const locale = document.documentElement.lang || "en-US";
      const state = {
        bounds: {
          left: bounds.left,
          top: bounds.top,
          right: Math.max(0, document.documentElement.clientWidth - bounds.right),
          bottom: Math.max(0, document.documentElement.clientHeight - bounds.bottom)
        },
        activeTabId,
        aiPanelSide,
        themeTone,
        locale,
        resizing: document.body.classList.contains("lyra-layout-resizing"),
        siteActive: activeTabId === "lyra-site-tab"
      };
      const signature = JSON.stringify(state);
      if (signature === lastState) return;
      lastState = signature;
      window.parent.postMessage(
        { type: "lyra:workbench-state", ...state },
        window.location.origin
      );
    };

    const resizeObserver = new ResizeObserver(report);
    resizeObserver.observe(document.documentElement);

    const syncWorkspace = () => {
      const nextWorkspace = workspaceTarget();
      if (nextWorkspace !== workspace) {
        if (workspace !== null) resizeObserver.unobserve(workspace);
        workspace = nextWorkspace;
        if (workspace !== null) resizeObserver.observe(workspace);
      }
      report();
      if (workspace === null) {
        syncFrame = window.requestAnimationFrame(syncWorkspace);
      } else {
        syncFrame = null;
      }
    };
    // Panel side changes can move a page without changing its dimensions.
    // Rebind after tab/split replacement and include live CSS-variable drags.
    const preferenceObserver = new MutationObserver(syncWorkspace);
    preferenceObserver.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["class", "style", "data-tab-id", "data-lyra-tab-id", "data-lyra-surface-hidden", "data-lyra-theme-tone", "lang"]
    });
    const queueWorkspaceSync = () => {
      if (syncFrame !== null) window.cancelAnimationFrame(syncFrame);
      syncFrame = window.requestAnimationFrame(syncWorkspace);
    };

    const followResizeDrag = () => {
      report();
      if (document.body.classList.contains("lyra-layout-resizing")) {
        dragFrame = window.requestAnimationFrame(followResizeDrag);
      } else {
        dragFrame = null;
      }
    };
    const beginResizeDrag = (event: PointerEvent | MouseEvent) => {
      if (!(event.target instanceof Element) || event.target.closest(".lyra-resizer") === null) {
        return;
      }
      if (dragFrame !== null) window.cancelAnimationFrame(dragFrame);
      dragFrame = window.requestAnimationFrame(followResizeDrag);
    };
    const handleStateRequest = (event: MessageEvent<unknown>) => {
      if (
        event.origin !== window.location.origin
        || event.source !== window.parent
        || event.data === null
        || typeof event.data !== "object"
        || (event.data as { readonly type?: unknown }).type !== "lyra:workbench-state-request"
      ) {
        return;
      }
      lastState = "";
      syncWorkspace();
    };
    document.addEventListener("pointerdown", beginResizeDrag, true);
    document.addEventListener("mousedown", beginResizeDrag, true);
    document.addEventListener("click", queueWorkspaceSync, true);
    document.addEventListener("keydown", queueWorkspaceSync, true);
    window.addEventListener("message", handleStateRequest);

    syncWorkspace();

    return () => {
      resizeObserver.disconnect();
      preferenceObserver.disconnect();
      document.removeEventListener("pointerdown", beginResizeDrag, true);
      document.removeEventListener("mousedown", beginResizeDrag, true);
      document.removeEventListener("click", queueWorkspaceSync, true);
      document.removeEventListener("keydown", queueWorkspaceSync, true);
      window.removeEventListener("message", handleStateRequest);
      if (dragFrame !== null) window.cancelAnimationFrame(dragFrame);
      if (syncFrame !== null) window.cancelAnimationFrame(syncFrame);
    };
  }, []);

  return null;
};

const SiteWorkbench = () => (
  <>
    <WorkbenchI18nProvider>
      <AppStatusProvider>
        <AppErrorBoundary
          className="lyra-app-root-error"
          title="Lyra Workbench"
          description="The shared Lyra renderer could not be mounted."
        >
          <WorkbenchShell />
        </AppErrorBoundary>
      </AppStatusProvider>
    </WorkbenchI18nProvider>
    <WorkbenchGeometryReporter />
  </>
);

createRoot(rootElement).render(<SiteWorkbench />);
