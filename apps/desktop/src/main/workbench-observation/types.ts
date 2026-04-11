import type { BrowserWindow } from "electron";

import type {
  WorkbenchTabExtractTextRequest,
  WorkbenchTabExtractTextResult,
  WorkbenchTabObservationResult,
  WorkbenchTabReadRequest,
  WorkbenchTabsListRequest,
  WorkbenchTabsListResult,
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
};

export type WorkbenchObservationRendererClient = {
  readonly dispose: () => void;
  readonly listLocalTabs: (request?: WorkbenchTabsListRequest) => Promise<WorkbenchTabsListResult>;
  readonly readLocalTab: (
    request: WorkbenchTabReadRequest
  ) => Promise<WorkbenchTabObservationResult>;
  readonly readLocalWorkspace: (
    request?: WorkbenchWorkspaceReadRequest
  ) => Promise<WorkbenchWorkspaceSnapshot>;
};

export type WorkbenchObservationWindowGetter = () => BrowserWindow | null;
