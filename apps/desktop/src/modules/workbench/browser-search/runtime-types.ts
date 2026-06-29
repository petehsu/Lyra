import type { MutableRefObject } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  WorkspaceTabsModel
} from "../workspace-tabs/types";
import type {
  BrowserSearchPayload,
  SearchEngineDefinition
} from "./types";

export type BrowserSearchSettings = {
  readonly searchEngines: readonly SearchEngineDefinition[];
  readonly resultsPerEngine: number;
};

export type BrowserSearchModel = {
  readonly standardSearchState: BrowserSearchPayload;
  readonly isSearching: boolean;
  readonly searchError: string | null;
  readonly sharedTransitionRect: DOMRect | null;
  readonly searchPillRef: MutableRefObject<HTMLDivElement | null>;
  readonly onSearchSurfaceSubmit: () => Promise<void>;
  readonly onSharedAnimationDone: () => void;
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
