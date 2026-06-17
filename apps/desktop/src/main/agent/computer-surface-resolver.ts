import type {
  WorkbenchObservedTabDescriptor,
  WorkbenchTabsListResult
} from "../../shared/workbench-observation";
import {
  LYRA_BROWSER_SURFACE,
  LYRA_FILE_MANAGER_SURFACE,
  LYRA_TERMINAL_SURFACE,
  type ComputerSurfaceRoute
} from "./computer-internal-surface";
import { readOptionalStringField } from "./host-payload";
import type { WorkbenchBrowserTabResolver } from "./workbench-observation-adapter";

export type ResolvedInternalSurface =
  | { readonly kind: typeof LYRA_BROWSER_SURFACE; readonly tabId: string }
  | { readonly kind: typeof LYRA_TERMINAL_SURFACE; readonly tabId: string }
  | { readonly kind: typeof LYRA_FILE_MANAGER_SURFACE; readonly tabId: string };

const isBrowserTab = (tab: WorkbenchObservedTabDescriptor): boolean =>
  tab.pageKind === "page" || tab.observationKind === "page";

const isTerminalTab = (tab: WorkbenchObservedTabDescriptor): boolean =>
  tab.pageKind === "terminal" || tab.observationKind === "terminal";

const isFileManagerTab = (tab: WorkbenchObservedTabDescriptor): boolean =>
  tab.observationKind === "file-manager";

const activeTab = (
  tabs: readonly WorkbenchObservedTabDescriptor[],
  activeTabId: string | null
): WorkbenchObservedTabDescriptor | null =>
  tabs.find((tab) => tab.tabId === activeTabId)
  ?? tabs.find((tab) => tab.active)
  ?? null;

const surfaceForTab = (
  tab: WorkbenchObservedTabDescriptor
): ResolvedInternalSurface["kind"] | null => {
  if (isBrowserTab(tab)) {
    return LYRA_BROWSER_SURFACE;
  }
  if (isTerminalTab(tab)) {
    return LYRA_TERMINAL_SURFACE;
  }
  if (isFileManagerTab(tab)) {
    return LYRA_FILE_MANAGER_SURFACE;
  }
  return null;
};

export const readComputerSurfaceRoute = (
  payload: Record<string, unknown>
): ComputerSurfaceRoute => {
  const surface = readOptionalStringField(payload, "surface");
  if (surface === LYRA_BROWSER_SURFACE || surface === "browser") {
    return "lyra-browser";
  }
  if (surface === LYRA_TERMINAL_SURFACE || surface === "terminal") {
    return "lyra-terminal";
  }
  if (surface === LYRA_FILE_MANAGER_SURFACE || surface === "files" || surface === "file-manager") {
    return "lyra-files";
  }
  if (surface === "native" || surface === "desktop" || surface === "os") {
    return "native";
  }
  return "auto";
};

export const resolveInternalSurface = async ({
  payload,
  route,
  tabResolver,
  listTabs
}: {
  readonly payload: Record<string, unknown>;
  readonly route: ComputerSurfaceRoute;
  readonly tabResolver: WorkbenchBrowserTabResolver;
  readonly listTabs: () => Promise<WorkbenchTabsListResult>;
}): Promise<ResolvedInternalSurface | null> => {
  if (route === "native") {
    return null;
  }

  const listed = await listTabs();
  const explicitTabId = readOptionalStringField(payload, "tabId");
  const targetTab = explicitTabId === undefined
    ? activeTab(listed.tabs, listed.activeTabId)
    : listed.tabs.find((tab) => tab.tabId === explicitTabId) ?? null;

  if (route === "lyra-browser") {
    const targetMode = readOptionalStringField(payload, "targetMode") === "isolated" ? "isolated" : "live";
    const tabId = await tabResolver.resolveBrowserAgentTabId(payload, targetMode);
    return { kind: LYRA_BROWSER_SURFACE, tabId };
  }

  if (route === "lyra-terminal") {
    if (targetTab === null || !isTerminalTab(targetTab)) {
      throw new Error(`surface "${LYRA_TERMINAL_SURFACE}" requires an active Lyra terminal tab.`);
    }
    return { kind: LYRA_TERMINAL_SURFACE, tabId: targetTab.tabId };
  }

  if (route === "lyra-files") {
    if (targetTab === null || !isFileManagerTab(targetTab)) {
      throw new Error(`surface "${LYRA_FILE_MANAGER_SURFACE}" requires an active Lyra file manager tab.`);
    }
    return { kind: LYRA_FILE_MANAGER_SURFACE, tabId: targetTab.tabId };
  }

  // auto: prefer the active workbench tab when it maps to a Level-1 surface.
  if (targetTab === null) {
    return null;
  }
  const kind = surfaceForTab(targetTab);
  if (kind === null) {
    return null;
  }
  if (kind === LYRA_BROWSER_SURFACE) {
    try {
      const targetMode = readOptionalStringField(payload, "targetMode") === "isolated" ? "isolated" : "live";
      const tabId = await tabResolver.resolveBrowserAgentTabId(payload, targetMode);
      return { kind: LYRA_BROWSER_SURFACE, tabId };
    } catch {
      return null;
    }
  }
  return { kind, tabId: targetTab.tabId };
};