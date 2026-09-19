import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { FileManagerEntry } from "../../../shared/file-manager";
import type { GlobalDialogModel } from "../global-dialog";
import type {
  FileEditorRevealLocation,
  FileEditorLabels,
  FileEditorModel
} from "../file-editor";
import type { ImageViewerLabels, ImageViewerModel } from "../image-viewer/types";
import type { AgentProjectTreeEditorTab } from "./open-editor-tab";

export type { AgentProjectTreeEditorTab };

export type AgentProjectTreeAppId = "agent-project-tree";
export type AgentProjectTreeAppIconKey = "agent-project-tree-default";

export type AgentProjectTreeLabels = {
  readonly title: string;
  readonly open: string;
  readonly openSourceControl: string;
  readonly openProblems?: string;
  readonly refresh: string;
  readonly loading: string;
  readonly emptyDirectory: string;
  readonly unavailable: string;
  readonly selectFileTitle: string;
  readonly selectFileDescription: string;
  readonly newFile: string;
  readonly newFolder: string;
  readonly revealInFolder: string;
  readonly openInImagePreview: string;
  readonly openInTerminal: string;
  readonly copyPath: string;
  readonly copyRelativePath: string;
  readonly moveToTrash: string;
  readonly createFileTitle: string;
  readonly createFolderTitle: string;
  readonly createFilePlaceholder: string;
  readonly createFolderPlaceholder: string;
  readonly createConfirm: string;
  readonly cancelAction: string;
  readonly deleteConfirmTitle: string;
  readonly deleteConfirmDescription: string;
  readonly deleteConfirmAction: string;
  readonly searchEmpty?: string;
  readonly searchSearching?: string;
};

export type AgentProjectTreeAppState = {
  readonly instanceId: string;
  readonly agentSessionId: string;
  readonly rootPath: string;
  readonly title: string;
  readonly selectedPath: string | null;
  readonly selectedFilePath: string | null;
  readonly editorInstanceId: string | null;
  readonly editorTabs: readonly AgentProjectTreeEditorTab[];
  readonly expandedPaths: readonly string[];
};

export type AgentProjectTreeModel = {
  readonly getState: (instanceId: string) => AgentProjectTreeAppState | null;
  readonly ensureInstance: (
    instanceId: string,
    options: {
      readonly agentSessionId: string;
      readonly rootPath: string;
      readonly title?: string | undefined;
    }
  ) => void;
  readonly syncTabInstances: (instanceIds: readonly string[]) => void;
  readonly revealPath: (instanceId: string, path: string) => void;
  readonly openFile: (
    instanceId: string,
    filePath: string,
    location?: FileEditorRevealLocation,
    options?: {
      readonly pinned?: boolean;
    }
  ) => Promise<void>;
  readonly activateEditorTab: (instanceId: string, editorInstanceId: string) => void;
  readonly closeEditorTab: (instanceId: string, editorInstanceId: string) => void;
  readonly pinEditorTab: (instanceId: string, editorInstanceId: string) => void;
  readonly toggleDirectory: (instanceId: string, path: string) => void;
  readonly updateRoot: (
    instanceId: string,
    options: {
      readonly agentSessionId: string;
      readonly rootPath: string;
      readonly title?: string | undefined;
    }
  ) => void;
};

export type AgentProjectTreeSurfaceProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: AgentProjectTreeLabels;
  readonly state: AgentProjectTreeAppState;
  readonly model: AgentProjectTreeModel;
  readonly fileEditorModel: FileEditorModel;
  readonly fileEditorLabels: FileEditorLabels;
  readonly imageViewerModel: ImageViewerModel;
  readonly imageViewerLabels: ImageViewerLabels;
  readonly themeSignature: string;
  readonly openDialog?: GlobalDialogModel["openDialog"];
  readonly onOpenFile?: (filePath: string) => void;
  readonly onOpenTerminal?: (cwd: string) => void;
  readonly onOpenGitPanel?: (request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }) => Promise<void> | void;
  readonly onOpenProblems?: (request: {
    readonly instanceId: string;
    readonly title: string;
    readonly rootPath: string;
  }) => void;
};

export type AgentProjectTreeDirectoryState =
  | {
      readonly status: "loading";
      readonly entries: readonly FileManagerEntry[];
      readonly errorMessage: null;
    }
  | {
      readonly status: "ready";
      readonly entries: readonly FileManagerEntry[];
      readonly errorMessage: null;
    }
  | {
      readonly status: "error";
      readonly entries: readonly FileManagerEntry[];
      readonly errorMessage: string;
    };
