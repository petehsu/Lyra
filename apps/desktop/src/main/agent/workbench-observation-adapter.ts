import type { BrowserWindow } from "electron";

import type {
  WorkbenchBrowserClearSiteDataRequest,
  WorkbenchBrowserStorageStateRequest
} from "../../shared/desktop-bridge";
import type {
  WorkbenchObservedTabDescriptor,
  WorkbenchTabExtractTextRequest,
  WorkbenchTabReadRequest,
  WorkbenchVisualCaptureResult,
  WorkbenchWorkspaceReadRequest
} from "../../shared/workbench-observation";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import { WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID } from "../workbench-browser/types";
import type { WorkbenchObservationService } from "../workbench-observation/types";
import type { AgentHostCapabilityHandlers } from "./host-payload";
import {
  normalizePayload,
  readClampedOptionalNumber,
  runHostCapabilityWithTimeout,
  isRecord
} from "./host-payload";

export const readTabId = (payload: unknown): string | null => {
  const value = normalizePayload(payload).tabId;
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const resolveWorkbenchTabId = (
  requestedTabId: string,
  tabs: readonly WorkbenchObservedTabDescriptor[]
): string | null => {
  const exact = tabs.find((tab) => tab.tabId === requestedTabId);
  if (exact !== undefined) {
    return exact.tabId;
  }

  const suffix = `-${requestedTabId}`;
  const suffixMatches = tabs.filter((tab) => tab.tabId.endsWith(suffix));
  if (suffixMatches.length === 1) {
    return suffixMatches[0]?.tabId ?? null;
  }

  const browserTabId = `browser-tab-${requestedTabId}`;
  const browserMatch = tabs.find((tab) => tab.tabId === browserTabId);
  return browserMatch?.tabId ?? null;
};

export const describeWorkbenchTabKind = (tab: WorkbenchObservedTabDescriptor): string =>
  tab.observationKind ?? tab.appId ?? tab.pageKind;

const isBrowserPageTab = (tab: WorkbenchObservedTabDescriptor): boolean =>
  tab.pageKind === "page" || tab.observationKind === "page";

const findActiveWorkbenchTab = (
  tabs: readonly WorkbenchObservedTabDescriptor[],
  activeTabId: string | null
): WorkbenchObservedTabDescriptor | null =>
  tabs.find((tab) => tab.tabId === activeTabId)
  ?? tabs.find((tab) => tab.active)
  ?? null;

const findDefaultWorkbenchReadTab = (
  tabs: readonly WorkbenchObservedTabDescriptor[],
  activeTabId: string | null
): WorkbenchObservedTabDescriptor | null =>
  tabs.find((tab) => tab.focusedPane)
  ?? findActiveWorkbenchTab(tabs, activeTabId)
  ?? tabs.find((tab) => tab.visible)
  ?? tabs[0]
  ?? null;

const createTabSummaryObservation = (
  tab: WorkbenchObservedTabDescriptor,
  reason: string
) => ({
  tab,
  observation: {
    kind: "tab-summary",
    title: tab.title,
    pageKind: tab.pageKind,
    ...(tab.appId === undefined ? {} : { appId: tab.appId }),
    active: tab.active,
    visible: tab.visible,
    focusedPane: tab.focusedPane,
    observable: tab.observable,
    reason
  }
});

export class NonBrowserWorkbenchTabError extends Error {
  readonly tab: WorkbenchObservedTabDescriptor;

  constructor(tab: WorkbenchObservedTabDescriptor) {
    super(
      `Browser action requires a browser page tab. Use workbench.read_tab for ${describeWorkbenchTabKind(tab)} tabs.`
    );
    this.name = "NonBrowserWorkbenchTabError";
    this.tab = tab;
  }
}

export type WorkbenchBrowserTabResolver = {
  readonly resolveBrowserAgentTabId: (
    payload: unknown,
    targetMode: "isolated" | "live"
  ) => Promise<string>;
  readonly readWorkbenchTabWithSummaryFallback: (payload: unknown) => Promise<unknown>;
  readonly describeWorkbenchTabKind: (tab: WorkbenchObservedTabDescriptor) => string;
};

export const createWorkbenchObservationAdapter = ({
  getWorkbenchObservationService,
  getBrowserBridge,
  getWindow
}: {
  readonly getWorkbenchObservationService: () => WorkbenchObservationService | null;
  readonly getBrowserBridge: () => WorkbenchBrowserIpcBridge | null;
  readonly getWindow: () => BrowserWindow | null;
}): WorkbenchBrowserTabResolver & { readonly handlers: AgentHostCapabilityHandlers } => {
  const normalizeWorkbenchTabPayload = async (
    payload: unknown,
    service: WorkbenchObservationService
  ): Promise<Record<string, unknown>> => {
    const request = normalizePayload(payload);
    const requestedTabId = readTabId(request);
    if (requestedTabId === null) {
      return request;
    }
    const listed = await service.listTabs({ scope: "all", includeUnsupported: true });
    const resolvedTabId = resolveWorkbenchTabId(requestedTabId, listed.tabs);
    return {
      ...request,
      tabId: resolvedTabId ?? requestedTabId
    };
  };

  const normalizeWorkbenchReadPayload = async (
    payload: unknown,
    service: WorkbenchObservationService
  ): Promise<Record<string, unknown>> => {
    const request = await normalizeWorkbenchTabPayload(payload, service);
    if (readTabId(request) !== null) {
      return request;
    }
    const listed = await service.listTabs({ scope: "all", includeUnsupported: true });
    const tab = findDefaultWorkbenchReadTab(listed.tabs, listed.activeTabId);
    if (tab === null) {
      throw new Error("No active Workbench tab is available");
    }
    return {
      ...request,
      tabId: tab.tabId
    };
  };

  const readWorkbenchTabWithSummaryFallback = async (
    payload: unknown
  ): Promise<unknown> => {
    const service = getWorkbenchObservationService();
    if (service === null) {
      throw new Error("Workbench observation capability is not available");
    }
    const request = await normalizeWorkbenchReadPayload(payload, service) as WorkbenchTabReadRequest;
    try {
      return await service.readTab(request);
    } catch (error) {
      const code =
        isRecord(error) && typeof error.code === "string" ? error.code : undefined;
      if (code !== "unsupported_tab_kind") {
        throw error;
      }
      const tabId = readTabId(request);
      if (tabId === null) {
        throw error;
      }
      const listed = await service.listTabs({ scope: "all", includeUnsupported: true });
      const tab = listed.tabs.find((entry) => entry.tabId === tabId);
      if (tab === undefined) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      return createTabSummaryObservation(tab, message);
    }
  };

  const resolveBrowserPageTabId = async (payload: unknown): Promise<string> => {
    const browser = getBrowserBridge();
    if (!browser) throw new Error("Browser capability is not available");

    const explicitTabId = readTabId(payload);
    const observationService = getWorkbenchObservationService();
    if (observationService !== null) {
      const listed = await observationService.listTabs({
        scope: "all",
        includeUnsupported: true
      });
      const activeWorkspaceTab = findActiveWorkbenchTab(listed.tabs, listed.activeTabId);
      const resolvedExplicitTabId =
        explicitTabId === null ? null : resolveWorkbenchTabId(explicitTabId, listed.tabs);
      const targetTab =
        explicitTabId === null
          ? activeWorkspaceTab
          : listed.tabs.find((tab) => tab.tabId === resolvedExplicitTabId) ?? null;
      if (targetTab !== null && !isBrowserPageTab(targetTab)) {
        throw new NonBrowserWorkbenchTabError(targetTab);
      }
      if (explicitTabId !== null && targetTab === null) {
        throw new Error(`Unknown Workbench tab: ${explicitTabId}`);
      }
      if (targetTab !== null) {
        return targetTab.tabId;
      }
    }

    return explicitTabId ?? browser.readActiveTabId() ?? "";
  };

  const resolveBrowserAgentTabId = async (
    payload: unknown,
    targetMode: "isolated" | "live"
  ): Promise<string> => {
    if (targetMode === "live" || readTabId(payload) !== null) {
      return await resolveBrowserPageTabId(payload);
    }
    try {
      const tabId = await resolveBrowserPageTabId(payload);
      return tabId.length > 0 ? tabId : WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID;
    } catch (error) {
      if (error instanceof NonBrowserWorkbenchTabError) {
        return WORKBENCH_BROWSER_AGENT_STANDALONE_TAB_ID;
      }
      throw error;
    }
  };

  const workbenchHandlers: AgentHostCapabilityHandlers = {
    "workbench.listTabs": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      const request = normalizePayload(payload);
      return await service.listTabs({
        scope:
          request.scope === "visible" || request.scope === "active" || request.scope === "all"
            ? request.scope
            : "all",
        includeUnsupported: request.includeUnsupported !== false
      });
    },
    "workbench.readTab": readWorkbenchTabWithSummaryFallback,
    "workbench.activateTab": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      const request = await normalizeWorkbenchTabPayload(payload, service);
      const tabId = readTabId(request);
      if (tabId === null) {
        throw new Error("tabId must be a non-empty string");
      }
      return await service.activateTab({ tabId });
    },
    "workbench.closeTab": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      const request = await normalizeWorkbenchTabPayload(payload, service);
      const tabId = readTabId(request);
      if (tabId === null) {
        throw new Error("tabId must be a non-empty string");
      }
      return await service.closeTab({ tabId });
    },
    "workbench.reorderTab": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      const request = await normalizeWorkbenchTabPayload(payload, service);
      const tabId = readTabId(request);
      if (tabId === null) {
        throw new Error("tabId must be a non-empty string");
      }
      const targetIndex = readClampedOptionalNumber(request, "targetIndex", 0, 0, 10_000);
      return await service.reorderTab({ tabId, targetIndex });
    },
    "workbench.splitTabs": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      const request = normalizePayload(payload);
      const sourceTabId = readTabId({ tabId: request.sourceTabId });
      const targetTabId = readTabId({ tabId: request.targetTabId });
      if (sourceTabId === null || targetTabId === null) {
        throw new Error("sourceTabId and targetTabId must be non-empty strings");
      }
      const listed = await service.listTabs({ scope: "all", includeUnsupported: true });
      const resolvedSource = resolveWorkbenchTabId(sourceTabId, listed.tabs) ?? sourceTabId;
      const resolvedTarget = resolveWorkbenchTabId(targetTabId, listed.tabs) ?? targetTabId;
      return await service.splitTabs({
        sourceTabId: resolvedSource,
        targetTabId: resolvedTarget
      });
    },
    "workbench.detachSplit": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      const request = await normalizeWorkbenchTabPayload(payload, service);
      const tabId = readTabId(request);
      if (tabId === null) {
        throw new Error("tabId must be a non-empty string");
      }
      return await service.detachSplit({ tabId });
    },
    "workbench.listTerminals": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      return await service.listTerminalPanes({});
    },
    "workbench.openTerminal": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      return await service.openTerminalPane(normalizePayload(payload));
    },
    "workbench.focusTerminal": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      return await service.focusTerminalPane(normalizePayload(payload));
    },
    "workbench.closeTerminal": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      return await service.closeTerminalPane(normalizePayload(payload));
    },
    "workbench.moveTerminal": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      const request = normalizePayload(payload);
      const terminalTabId =
        typeof request.terminalTabId === "string" && request.terminalTabId.trim().length > 0
          ? request.terminalTabId.trim()
          : null;
      if (terminalTabId === null) {
        throw new Error("terminalTabId must be a non-empty string");
      }
      const placement = request.placement === "workspace" ? "workspace" : "dock";
      const targetIndex =
        typeof request.targetIndex === "number" && Number.isFinite(request.targetIndex)
          ? Math.max(0, Math.trunc(request.targetIndex))
          : undefined;
      return await service.moveTerminalTab({
        terminalTabId,
        placement,
        ...(targetIndex === undefined ? {} : { targetIndex })
      });
    },
    "workbench.readWorkspace": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      return await service.readWorkspace(
        normalizePayload(payload) as WorkbenchWorkspaceReadRequest
      );
    },
    "workbench.captureVisualEvidence": async (payload) => {
      const request = normalizePayload(payload);
      const scope = request.scope === "active_tab" ? "active_tab" : "workspace_window";
      let capture: WorkbenchVisualCaptureResult;
      if (scope === "active_tab") {
        const service = getWorkbenchObservationService();
        if (service === null) {
          throw new Error("Workbench observation capability is not available");
        }
        const tabId = readTabId(request);
        if (tabId === null) {
          throw new Error("tabId must be a non-empty string for active_tab capture");
        }
        capture = await service.captureVisual({ tabId });
      } else {
        const window = getWindow();
        if (window === null || window.isDestroyed()) {
          throw new Error("renderer_bridge_unavailable");
        }
        const image = await window.webContents.capturePage();
        const size = image.getSize();
        capture = {
          tabId: "lyra-workspace-window",
          mimeType: "image/png",
          imageBase64: image.toPNG().toString("base64"),
          width: size.width,
          height: size.height,
          visibleOnly: true
        };
      }
      return {
        ok: true,
        kind: "workbenchVisualEvidence",
        scope,
        capture,
        mimeType: capture.mimeType,
        width: capture.width,
        height: capture.height,
        visibleOnly: capture.visibleOnly,
        message: `Captured ${scope === "active_tab" ? "active workbench tab" : "visible workspace window"} visual evidence.`
      };
    },
    "workbench.extractTabText": async (payload) => {
      const service = getWorkbenchObservationService();
      if (service === null) {
        throw new Error("Workbench observation capability is not available");
      }
      return await service.extractTabText(
        await normalizeWorkbenchReadPayload(payload, service) as WorkbenchTabExtractTextRequest
      );
    },
    "workbench.browser.readSessionSnapshot": () => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser session recovery capability is not available");
      return browser.readSessionSnapshot();
    },
    "workbench.browser.readRenderedSnapshot": async (payload: unknown): Promise<unknown> => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser capability is not available");
      const request = normalizePayload(payload);
      const requestedTimeoutMs = readClampedOptionalNumber(request, "timeoutMs", 20_000, 250, 120_000);
      return await runHostCapabilityWithTimeout(
        "workbench.browser.readRenderedSnapshot",
        Math.min(124_000, requestedTimeoutMs + 4_000),
        () => browser.readRenderedSnapshot(request)
      );
    },
    "workbench.browser.readStorageState": async (payload: unknown) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser storage state capability is not available");
      return await browser.readStorageState(
        normalizePayload(payload) as WorkbenchBrowserStorageStateRequest
      );
    },
    "workbench.browser.clearSiteData": async (payload: unknown) => {
      const browser = getBrowserBridge();
      if (!browser) throw new Error("Browser storage clear capability is not available");
      return await browser.clearSiteData(
        normalizePayload(payload) as WorkbenchBrowserClearSiteDataRequest
      );
    }
  };

  return {
    handlers: workbenchHandlers,
    resolveBrowserAgentTabId,
    readWorkbenchTabWithSummaryFallback,
    describeWorkbenchTabKind
  };
};
