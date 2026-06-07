import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type {
  FileEditorObservation,
  FileManagerObservation,
  SearchHomeObservation,
  SearchResultsObservation,
  TerminalObservation,
  ImageViewerObservation,
  WorkbenchObservedTabDescriptor,
  WorkbenchObservationError,
  WorkbenchTabReadRequest,
  WorkbenchTabsListRequest,
  WorkbenchTabsListResult,
  WorkbenchWorkspaceReadRequest,
  WorkbenchWorkspaceSnapshot
} from "../../../shared/workbench-observation";
import type { FileEditorModel } from "../file-editor";
import type { FileManagerModel } from "../file-manager";
import type { ImageViewerModel } from "../image-viewer";
import type { TerminalDockModel } from "../terminal-dock/types";
import type { WorkspaceTabsModel } from "../workspace-tabs/types";

export type RendererTabObservation =
  | FileEditorObservation
  | FileManagerObservation
  | SearchHomeObservation
  | SearchResultsObservation
  | ImageViewerObservation
  | TerminalObservation;

export type RendererTabObservationResult = {
  readonly tab: WorkbenchObservedTabDescriptor;
  readonly observation: RendererTabObservation;
};

export type WorkbenchObservationDependencies = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly tabsModel: WorkspaceTabsModel;
  readonly fileEditorModel: FileEditorModel;
  readonly fileManagerModel: FileManagerModel;
  readonly imageViewerModel: ImageViewerModel;
  readonly terminalModel: TerminalDockModel;
};

export type WorkbenchObservationRequestHandlers = {
  readonly listTabs: (request: WorkbenchTabsListRequest) => WorkbenchTabsListResult;
  readonly readTab: (
    request: WorkbenchTabReadRequest
  ) => RendererTabObservationResult | WorkbenchObservationError;
  readonly readWorkspace: (request: WorkbenchWorkspaceReadRequest) => WorkbenchWorkspaceSnapshot;
};
