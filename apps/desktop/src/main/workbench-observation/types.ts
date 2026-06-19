import type { BrowserWindow } from "electron";

import type {
  WorkbenchTabCloseRequest,
  WorkbenchTabCloseResult,
  WorkbenchTabDetachSplitRequest,
  WorkbenchTabDetachSplitResult,
  WorkbenchTabExtractTextRequest,
  WorkbenchTabExtractTextResult,
  WorkbenchTabActivateRequest,
  WorkbenchTabActivateResult,
  WorkbenchTabObservationResult,
  WorkbenchTabReadRequest,
  WorkbenchTabReorderRequest,
  WorkbenchTabReorderResult,
  WorkbenchTabSplitRequest,
  WorkbenchTabSplitResult,
  WorkbenchTabsListRequest,
  WorkbenchTabsListResult,
  WorkbenchTerminalCloseRequest,
  WorkbenchTerminalCloseResult,
  WorkbenchTerminalFocusRequest,
  WorkbenchTerminalFocusResult,
  WorkbenchTerminalListRequest,
  WorkbenchTerminalListResult,
  WorkbenchTerminalMoveRequest,
  WorkbenchTerminalMoveResult,
  WorkbenchTerminalOpenRequest,
  WorkbenchTerminalOpenResult,
  WorkbenchVisualCaptureRequest,
  WorkbenchVisualCaptureResult,
  WorkbenchWorkspaceReadRequest,
  WorkbenchWorkspaceSnapshot
} from "../../shared/workbench-observation";

export type WorkbenchObservationBrowserDomSummary = {
  readonly domTitle?: string;
  readonly documentLanguage?: string;
  readonly selectionText?: string;
  readonly headings: readonly string[];
  readonly mainTextExcerpt: string;
  readonly links: readonly {
    readonly text: string;
    readonly href: string;
  }[];
  readonly forms: readonly {
    readonly action?: string;
    readonly method?: string;
    readonly fields: readonly string[];
  }[];
  readonly truncated: boolean;
};

export type WorkbenchObservationService = {
  readonly dispose: () => void;
  readonly listTabs: (request?: WorkbenchTabsListRequest) => Promise<WorkbenchTabsListResult>;
  readonly activateTab: (
    request: WorkbenchTabActivateRequest
  ) => Promise<WorkbenchTabActivateResult>;
  readonly readWorkspace: (
    request?: WorkbenchWorkspaceReadRequest
  ) => Promise<WorkbenchWorkspaceSnapshot>;
  readonly extractTabText: (
    request: WorkbenchTabExtractTextRequest
  ) => Promise<WorkbenchTabExtractTextResult>;
  readonly readTab: (
    request: WorkbenchTabReadRequest
  ) => Promise<WorkbenchTabObservationResult>;
  readonly captureVisual: (
    request: WorkbenchVisualCaptureRequest
  ) => Promise<WorkbenchVisualCaptureResult>;
  readonly listTerminalPanes: (
    request?: WorkbenchTerminalListRequest
  ) => Promise<WorkbenchTerminalListResult>;
  readonly openTerminalPane: (
    request?: WorkbenchTerminalOpenRequest
  ) => Promise<WorkbenchTerminalOpenResult>;
  readonly focusTerminalPane: (
    request: WorkbenchTerminalFocusRequest
  ) => Promise<WorkbenchTerminalFocusResult>;
  readonly closeTerminalPane: (
    request: WorkbenchTerminalCloseRequest
  ) => Promise<WorkbenchTerminalCloseResult>;
  readonly closeTab: (request: WorkbenchTabCloseRequest) => Promise<WorkbenchTabCloseResult>;
  readonly reorderTab: (
    request: WorkbenchTabReorderRequest
  ) => Promise<WorkbenchTabReorderResult>;
  readonly splitTabs: (request: WorkbenchTabSplitRequest) => Promise<WorkbenchTabSplitResult>;
  readonly detachSplit: (
    request: WorkbenchTabDetachSplitRequest
  ) => Promise<WorkbenchTabDetachSplitResult>;
  readonly moveTerminalTab: (
    request: WorkbenchTerminalMoveRequest
  ) => Promise<WorkbenchTerminalMoveResult>;
};

export type WorkbenchObservationRendererClient = {
  readonly dispose: () => void;
  readonly listLocalTabs: (request?: WorkbenchTabsListRequest) => Promise<WorkbenchTabsListResult>;
  readonly readLocalTab: (
    request: WorkbenchTabReadRequest
  ) => Promise<WorkbenchTabObservationResult>;
  readonly activateLocalTab: (
    request: WorkbenchTabActivateRequest
  ) => Promise<WorkbenchTabActivateResult>;
  readonly readLocalWorkspace: (
    request?: WorkbenchWorkspaceReadRequest
  ) => Promise<WorkbenchWorkspaceSnapshot>;
  readonly listLocalTerminalPanes: (
    request?: WorkbenchTerminalListRequest
  ) => Promise<WorkbenchTerminalListResult>;
  readonly openLocalTerminalPane: (
    request?: WorkbenchTerminalOpenRequest
  ) => Promise<WorkbenchTerminalOpenResult>;
  readonly focusLocalTerminalPane: (
    request: WorkbenchTerminalFocusRequest
  ) => Promise<WorkbenchTerminalFocusResult>;
  readonly closeLocalTerminalPane: (
    request: WorkbenchTerminalCloseRequest
  ) => Promise<WorkbenchTerminalCloseResult>;
  readonly closeLocalTab: (request: WorkbenchTabCloseRequest) => Promise<WorkbenchTabCloseResult>;
  readonly reorderLocalTab: (
    request: WorkbenchTabReorderRequest
  ) => Promise<WorkbenchTabReorderResult>;
  readonly splitLocalTabs: (
    request: WorkbenchTabSplitRequest
  ) => Promise<WorkbenchTabSplitResult>;
  readonly detachLocalSplit: (
    request: WorkbenchTabDetachSplitRequest
  ) => Promise<WorkbenchTabDetachSplitResult>;
  readonly moveLocalTerminalTab: (
    request: WorkbenchTerminalMoveRequest
  ) => Promise<WorkbenchTerminalMoveResult>;
};

export type WorkbenchObservationWindowGetter = () => BrowserWindow | null;
