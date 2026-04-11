import type {
  BrowserSearchPayload,
  DeepSearchViewState
} from "../browser-search/types";
import {
  getDeepSearchSnapshot,
  getStandardSearchSnapshot
} from "../browser-search/store";
import type { FileManagerEntry } from "../../../shared/file-manager";
import type {
  WorkbenchObservedTabDescriptor,
  WorkbenchObservationError,
  WorkbenchTabReadRequest,
  WorkbenchTabsListRequest,
  WorkbenchTabsListResult
} from "../../../shared/workbench-observation";
import type { WorkbenchObservationDependencies, RendererTabObservationResult } from "./types";

const toError = (
  code: WorkbenchObservationError["code"],
  message: string
): WorkbenchObservationError => ({
  code,
  message
});

const toDescriptorIndex = (
  descriptors: readonly WorkbenchObservedTabDescriptor[]
): ReadonlyMap<string, WorkbenchObservedTabDescriptor> =>
  new Map(descriptors.map((descriptor) => [descriptor.tabId, descriptor]));

const sliceText = (
  value: string,
  maxChars: number
): { readonly content: string; readonly truncated: boolean } =>
  value.length > maxChars
    ? {
        content: value.slice(0, maxChars),
        truncated: true
      }
    : {
        content: value,
        truncated: false
      };

const summarizeStandardResults = (
  payload: BrowserSearchPayload | null,
  query: string,
  maxEntries: number
) => {
  const state = payload;
  const blended = state?.web.payload.blendedResults ?? [];
  const local = state?.local.payload.results ?? [];
  return {
    kind: "search-results" as const,
    query,
    searchMode: "standard" as const,
    webStatus: state?.web.status ?? "idle",
    localStatus: state?.local.status ?? "idle",
    blendedResults: blended.slice(0, maxEntries).map((entry) => ({
      title: entry.title,
      url: entry.url,
      snippet: entry.snippet
    })),
    localResults: local.slice(0, maxEntries).map((entry) => ({
      path: entry.path,
      ...(entry.snippet === undefined ? {} : { snippet: entry.snippet }),
      ...(entry.line === undefined ? {} : { line: entry.line })
    })),
    truncated: blended.length > maxEntries || local.length > maxEntries
  };
};

const summarizeDeepResults = (
  state: DeepSearchViewState | null,
  query: string,
  maxEntries: number
) => ({
  kind: "deep-search-results" as const,
  query,
  budgetPreset: state?.budgetPreset ?? "medium",
  status: state?.status ?? "idle",
  done: state?.done ?? false,
  nodeCount: state?.snapshot.nodes.length ?? 0,
  edgeCount: state?.snapshot.edges.length ?? 0,
  nodes: (state?.snapshot.nodes ?? []).slice(0, maxEntries).map((node) => ({
    id: node.id,
    kind: node.kind,
    title: node.title
  })),
  edges: (state?.snapshot.edges ?? []).slice(0, maxEntries).map((edge) => ({
    id: edge.id,
    kind: edge.kind,
    from: edge.sourceId,
    to: edge.targetId
  })),
  truncated:
    (state?.snapshot.nodes.length ?? 0) > maxEntries
    || (state?.snapshot.edges.length ?? 0) > maxEntries
});

const summarizeEntries = (
  entries: readonly FileManagerEntry[],
  maxEntries: number
) => entries.slice(0, maxEntries).map((entry) => ({
  id: entry.id,
  name: entry.name,
  path: entry.path,
  ...(entry.kind === undefined ? {} : { kind: entry.kind }),
  ...(entry.sizeBytes === undefined ? {} : { sizeBytes: entry.sizeBytes }),
  ...(entry.modifiedAt === undefined ? {} : { modifiedAt: entry.modifiedAt })
}));

export const listObservedTabs = (
  request: WorkbenchTabsListRequest,
  dependencies: WorkbenchObservationDependencies
): WorkbenchTabsListResult => {
  const { tabsModel } = dependencies;
  const layout = tabsModel.getVisibleWorkspaceLayout();
  const visibleIds = new Set(layout.visibleTabIds);
  const includeUnsupported = request.includeUnsupported !== false;
  const filteredTabs = tabsModel.tabs.filter((tab) => {
    if (request.scope === "active") {
      return tab.id === tabsModel.activeTabId;
    }
    if (request.scope === "visible") {
      return visibleIds.has(tab.id);
    }
    return true;
  });

  const tabs = filteredTabs.flatMap<WorkbenchObservedTabDescriptor>((tab) => {
    const isVisible = visibleIds.has(tab.id);
    const isFocusedPane =
      layout.mode === "split"
        ? layout.focusedSplitTabId === tab.id
        : tabsModel.activeTabId === tab.id;

    const observationKind =
      tab.pageKind === "page"
        ? "page"
        : tab.pageKind === "search"
          ? "search-home"
          : tab.pageKind === "results"
            ? ((tab.resultMode ?? tab.searchMode ?? "standard") === "deep"
                ? "deep-search-results"
                : "search-results")
            : tab.pageKind === "terminal"
              ? "terminal"
              : tab.pageKind === "app" && tab.appId === "file-editor"
                ? "file-editor"
                : tab.pageKind === "app" && tab.appId === "file-manager"
                  ? "file-manager"
                  : undefined;
    const observable = observationKind !== undefined;
    if (!observable && !includeUnsupported) {
      return [];
    }
    return [{
      tabId: tab.id,
      title: tab.title,
      pageKind: tab.pageKind,
      ...(tab.appId === undefined ? {} : { appId: tab.appId }),
      ...(tab.appInstanceId === undefined ? {} : { appInstanceId: tab.appInstanceId }),
      active: tab.id === tabsModel.activeTabId,
      visible: isVisible,
      focusedPane: isFocusedPane,
      ...(tab.displayAddress.trim().length === 0 ? {} : { displayAddress: tab.displayAddress }),
      observable,
      ...(observationKind === undefined ? {} : { observationKind })
    }];
  });

  return {
    activeTabId: tabsModel.activeTabId ?? null,
    visibleTabIds: layout.visibleTabIds,
    tabs
  };
};

export const readObservedLocalTab = (
  request: WorkbenchTabReadRequest,
  dependencies: WorkbenchObservationDependencies
): RendererTabObservationResult | WorkbenchObservationError => {
  const descriptors = listObservedTabs({ includeUnsupported: true }, dependencies).tabs;
  const descriptor = toDescriptorIndex(descriptors).get(request.tabId);
  if (descriptor === undefined) {
    return toError("tab_not_found", `Unknown tab: ${request.tabId}`);
  }
  if (descriptor.observable === false || descriptor.observationKind === "page") {
    return toError(
      "unsupported_tab_kind",
      `Local renderer observation is unsupported for ${descriptor.pageKind}.`
    );
  }

  const maxChars = Math.max(1, request.maxChars ?? 12_000);
  const maxEntries = Math.max(1, request.maxEntries ?? 100);
  const tab = dependencies.tabsModel.tabs.find((entry) => entry.id === request.tabId);
  if (tab === undefined) {
    return toError("tab_not_found", `Unknown tab: ${request.tabId}`);
  }

  if (descriptor.observationKind === "file-editor" && tab.appInstanceId !== undefined) {
    const state = dependencies.fileEditorModel.getState(tab.appInstanceId);
    if (state === null) {
      return toError("tab_not_found", `File editor state unavailable: ${request.tabId}`);
    }
    const sliced = sliceText(state.content, maxChars);
    return {
      tab: descriptor,
      observation: {
        kind: "file-editor",
        filePath: state.filePath,
        title: state.title,
        languageId: state.languageId,
        status: state.status,
        isDirty: state.isDirty,
        isReadOnly: state.isReadOnly,
        ...(state.revision === undefined ? {} : { revision: state.revision }),
        diagnostics: state.diagnostics.slice(0, 100).map((diagnostic) => ({
          ...(diagnostic.severity === undefined ? {} : { severity: diagnostic.severity }),
          message: diagnostic.message,
          line: diagnostic.startLine,
          column: diagnostic.startCharacter
        })),
        content: sliced.content,
        truncated: sliced.truncated
      }
    };
  }

  if (descriptor.observationKind === "file-manager" && tab.appInstanceId !== undefined) {
    const state = dependencies.fileManagerModel.getState(tab.appInstanceId);
    if (state === null) {
      return toError("tab_not_found", `File manager state unavailable: ${request.tabId}`);
    }
    return {
      tab: descriptor,
      observation: {
        kind: "file-manager",
        viewKind: state.viewKind,
        presentationMode: state.presentationMode,
        currentLocation:
          state.currentLocation === null
            ? null
            : {
                kind: state.currentLocation.kind,
                ...(state.currentLocation.path === undefined ? {} : { path: state.currentLocation.path }),
                ...(state.currentLocation.title === undefined ? {} : { title: state.currentLocation.title })
              },
        ...(state.selectedEntryId === undefined ? {} : { selectedEntryId: state.selectedEntryId }),
        entries: summarizeEntries(state.entries, maxEntries),
        truncated: state.entries.length > maxEntries
      }
    };
  }

  if (descriptor.observationKind === "terminal") {
    const terminalTabId = tab.terminalTabId ?? tab.id;
    const terminalTab = dependencies.terminalModel.findTab(terminalTabId);
    if (terminalTab === null) {
      return toError("tab_not_found", `Terminal state unavailable: ${request.tabId}`);
    }
    const panes = dependencies.terminalModel.getTabPanes(terminalTab.id);
    return {
      tab: descriptor,
      observation: {
        kind: "terminal",
        activePaneId: terminalTab.activePaneId,
        panes: panes.map((pane) => ({
          paneId: pane.id,
          sessionId: pane.sessionId,
          title: pane.title,
          ...(pane.cwd === undefined ? {} : { cwd: pane.cwd }),
          ...(pane.shell === undefined ? {} : { shell: pane.shell }),
          isActive: pane.id === terminalTab.activePaneId
        })),
        activeOutput: "",
        running: false,
        exitCode: null,
        truncated: false
      }
    };
  }

  if (descriptor.observationKind === "search-home") {
    return {
      tab: descriptor,
      observation: {
        kind: "search-home",
        inputValue: tab.inputValue,
        searchMode: tab.searchMode ?? "standard",
        hasResults: false
      }
    };
  }

  if (descriptor.observationKind === "search-results") {
    return {
      tab: descriptor,
      observation: summarizeStandardResults(
        getStandardSearchSnapshot(tab.id),
        tab.query ?? tab.inputValue,
        maxEntries
      )
    };
  }

  if (descriptor.observationKind === "deep-search-results") {
    return {
      tab: descriptor,
      observation: summarizeDeepResults(
        getDeepSearchSnapshot(tab.id),
        tab.query ?? tab.inputValue,
        maxEntries
      )
    };
  }

  return toError(
    "unsupported_tab_kind",
    `Observation kind is unsupported for ${descriptor.tabId}.`
  );
};
