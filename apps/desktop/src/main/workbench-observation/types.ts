import type { BrowserWindow } from "electron";

import type {
  WorkbenchTabExtractTextRequest,
  WorkbenchTabExtractTextResult,
  WorkbenchTabActivateRequest,
  WorkbenchTabActivateResult,
  WorkbenchTabObservationResult,
  WorkbenchTabReadRequest,
  WorkbenchTabsListRequest,
  WorkbenchTabsListResult,
  WorkbenchTerminalCloseRequest,
  WorkbenchTerminalCloseResult,
  WorkbenchTerminalFocusRequest,
  WorkbenchTerminalFocusResult,
  WorkbenchTerminalListRequest,
  WorkbenchTerminalListResult,
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
};

export type WorkbenchObservationWindowGetter = () => BrowserWindow | null;
