import type { MutableRefObject } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  WorkspaceSearchMode,
  WorkspaceTabsModel
} from "../workspace-tabs/types";
import type {
  BrowserSearchPayload,
  DeepSearchViewState,
  LocalSearchScopePreset,
  SearchEngineDefinition
} from "./types";

export type BrowserSearchSettings = {
  readonly searchEngines: readonly SearchEngineDefinition[];
  readonly resultsPerEngine: number;
  readonly localScopePreset: LocalSearchScopePreset;
  readonly localCustomRoots: readonly string[];
  readonly localIncludeHidden: boolean;
  readonly localEnableFuzzy: boolean;
  readonly localEnableContent: boolean;
  readonly localEnableExtensionMatch: boolean;
  readonly localProjectRoot?: string;
  readonly localLimit?: number;
  readonly deepBudgetPreset: "low" | "medium" | "high";
  readonly deepSiteExpansionEnabled: boolean;
  readonly deepProactiveDomainGuessingEnabled: boolean;
  readonly deepCrawlPolicy: "accessibility_only";
};

export type BrowserSearchModel = {
  readonly standardSearchState: BrowserSearchPayload;
  readonly deepSearchState: DeepSearchViewState;
  readonly activeSearchMode: WorkspaceSearchMode;
  readonly currentResultMode: WorkspaceSearchMode;
  readonly isSearching: boolean;
  readonly searchError: string | null;
  readonly sharedTransitionRect: DOMRect | null;
  readonly searchPillRef: MutableRefObject<HTMLDivElement | null>;
  readonly onSearchSurfaceSubmit: () => void;
  readonly onSharedAnimationDone: () => void;
  readonly onSetActiveSearchMode: (mode: WorkspaceSearchMode) => void;
  readonly onToggleDeepSearch: () => void;
  readonly onCancelDeepSearch: () => void;
  readonly onExpandDeepNode: (nodeId: string) => void;
};

export type UseBrowserSearchModelArgs = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly tabsModel: WorkspaceTabsModel;
  readonly searchSettings: BrowserSearchSettings;
};

export type StandardSearchTask = {
  readonly cacheKey: string;
  readonly tabId: string;
  state: BrowserSearchPayload;
  error: string | null;
  isSearching: boolean;
  cancel: () => void;
};

export type DeepSearchTask = {
  readonly cacheKey: string;
  readonly tabId: string;
  state: DeepSearchViewState;
  error: string | null;
  isSearching: boolean;
  streamId: string | null;
  cancel: () => void;
  resume: () => void;
};
