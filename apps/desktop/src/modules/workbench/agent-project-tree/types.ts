import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { FileManagerEntry } from "../../../shared/file-manager";
import type {
  FileEditorRevealLocation,
  FileEditorLabels,
  FileEditorModel
} from "../file-editor";

export type AgentProjectTreeAppId = "agent-project-tree";
export type AgentProjectTreeAppIconKey = "agent-project-tree-default";

export type AgentProjectTreeLabels = {
  readonly title: string;
  readonly open: string;
  readonly openSourceControl: string;
  readonly refresh: string;
  readonly loading: string;
  readonly emptyDirectory: string;
  readonly unavailable: string;
  readonly selectFileTitle: string;
  readonly selectFileDescription: string;
};

export type AgentProjectTreeAppState = {
  readonly instanceId: string;
  readonly agentSessionId: string;
  readonly rootPath: string;
  readonly title: string;
  readonly selectedPath: string | null;
  readonly selectedFilePath: string | null;
  readonly editorInstanceId: string | null;
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
    location?: FileEditorRevealLocation
  ) => Promise<void>;
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
  readonly themeSignature: string;
  readonly onOpenGitPanel?: (request: {
    readonly sessionId: string;
    readonly workingDir: string;
  }) => Promise<void> | void;
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
