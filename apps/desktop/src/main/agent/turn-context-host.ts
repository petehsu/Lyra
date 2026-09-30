import type { BrowserWindow } from "electron";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import type { WorkbenchObservationService } from "../workbench-observation/types";
import type { WorkbenchStateIpcBridge } from "../workbench-state/service";
import { readConsent } from "../persona/consent-service";
import { readHostPersonaContextPayload } from "./host-persona-context";
import type { createSoftwareCapabilityHost } from "./software-capability-host";

/** Capture turn metadata once. Catalog changes are pushed by the renderer;
 * only the current workspace observation requires a renderer request. */
export const createTurnContextHost = ({
  getWindow, getWorkbenchObservationService, getBrowserBridge, workbenchState, software
}: {
  readonly getWindow: () => BrowserWindow | null;
  readonly getWorkbenchObservationService: () => WorkbenchObservationService | null;
  readonly getBrowserBridge: () => WorkbenchBrowserIpcBridge | null;
  readonly workbenchState: WorkbenchStateIpcBridge;
  readonly software: ReturnType<typeof createSoftwareCapabilityHost>;
}) => async () => {
  const service = getWorkbenchObservationService();
  const workbench = await service?.listTabs({ scope: "all", includeUnsupported: true })
    .catch(() => undefined);
  const window = getWindow();
  const bounds = window && !window.isDestroyed() ? window.getContentBounds() : undefined;
  const active = workbench?.tabs.find((tab) => tab.tabId === workbench.activeTabId);
  const browserRelevant = workbench?.tabs.some((tab) =>
    tab.observationKind === "page" || tab.pageKind === "page");
  return {
    software: software.snapshot(),
    workbench: workbench ?? { hostCapabilityAvailable: false, tabs: [] },
    browserRecovery: browserRelevant ? getBrowserBridge()?.readSessionSnapshot() ?? null : null,
    workspace: {
      ...(bounds ? { windowWidth: bounds.width, windowHeight: bounds.height } : {}),
      layoutMode: workbench?.layout?.layoutMode,
      paneCount: workbench?.visibleTabIds.length,
      visibleTabCount: workbench?.tabs.length,
      activeTabTitle: active?.title,
      activeTabAddress: active?.displayAddress,
      activeTabKind: active?.observationKind ?? active?.pageKind
    },
    persona: readHostPersonaContextPayload(workbenchState),
    personaSignalsAllowed: readConsent().osintEnabled
  };
};
