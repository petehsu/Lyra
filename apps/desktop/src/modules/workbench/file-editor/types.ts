import type {
  LspCompletionResult,
  LspDiagnostic,
  LspLanguageId,
  LyraDesktopApi
} from "../../../shared/desktop-bridge";
import type {
  FileReadResult,
  FileStatResult,
  FileTextEncoding,
  FileWriteResult
} from "../../../shared/file-manager";

export type FileEditorAppId = "file-editor";

export type FileEditorAppIconKey =
  | "file-editor-code"
  | "file-editor-readonly"
  | "file-editor-unsupported";

export type FileEditorStatus =
  | "idle"
  | "loading"
  | "ready"
  | "saving"
  | "unsupported"
  | "conflict"
  | "error";

export type FileEditorSaveSource = "manual" | "idle" | "blur";

export type FileEditorSessionId = string;

export type FileEditorAppState = {
  readonly instanceId: string;
  readonly sessionId: FileEditorSessionId;
  readonly filePath: string;
  readonly title: string;
  readonly iconKey: FileEditorAppIconKey;
  readonly status: FileEditorStatus;
  readonly languageId: string;
  readonly encoding: FileTextEncoding;
  readonly content: string;
  readonly lastSavedContent: string;
  readonly isDirty: boolean;
  readonly isReadOnly: boolean;
  readonly isHydrated: boolean;
  readonly revision: string | undefined;
  readonly sizeBytes: number;
  readonly unsupportedReason: string | undefined;
  readonly message: string | undefined;
  readonly lastSavedAt: string | undefined;
  readonly lspVersion: number;
  readonly diagnostics: readonly LspDiagnostic[];
};

export type FileEditorSuggestion = LspCompletionResult["items"][number];

export type FileEditorChangeReviewStatus = "running" | "completed" | "error";
export type FileEditorChangeReviewDecision = "accepted" | "rejected";

export type FileEditorChangeReviewItem = {
  readonly id: string;
  readonly status: FileEditorChangeReviewStatus;
  readonly filePath: string;
  readonly addedLines: number;
  readonly removedLines: number;
  readonly createdAt: number;
  readonly decision?: FileEditorChangeReviewDecision;
};

export type FileEditorLabels = {
  readonly loading: string;
  readonly unsupported: string;
  readonly unavailable: string;
  readonly readOnly: string;
  readonly conflict: string;
  readonly retry: string;
  readonly save: string;
  readonly openDiff: string;
  readonly closeDiff: string;
};

export type FileEditorSurfaceVariant = "full" | "ai-workspace" | "ai-miniature";
export type FileEditorControlMode = "ai_only" | "human_takeover";

export type FileEditorModel = {
  readonly createInstance: (filePath: string) => {
    readonly appId: FileEditorAppId;
    readonly appInstanceId: string;
    readonly title: string;
    readonly iconKey: FileEditorAppIconKey;
    readonly filePath: string;
    readonly fileSessionId: string;
    readonly isDirty: boolean;
  };
  readonly findInstanceByPath: (filePath: string) => string | null;
  readonly getState: (instanceId: string) => FileEditorAppState | null;
  readonly ensureInstance: (
    instanceId: string,
    options: {
      readonly filePath: string;
      readonly fileSessionId?: string;
    }
  ) => void;
  readonly syncExternalInstances: (instanceIds: readonly string[]) => void;
  readonly syncTabInstances: (instanceIds: readonly string[]) => void;
  readonly openFile: (instanceId: string, filePath: string) => Promise<void>;
  readonly hydrateIfNeeded: (instanceId: string) => Promise<void>;
  readonly touchInstance: (instanceId: string) => void;
  readonly setContent: (instanceId: string, content: string) => void;
  readonly save: (instanceId: string, source: FileEditorSaveSource) => Promise<void>;
  readonly statFile: (instanceId: string) => Promise<FileStatResult | null>;
  readonly requestCompletion: (
    instanceId: string,
    line: number,
    column: number
  ) => Promise<readonly FileEditorSuggestion[]>;
};

export type UseFileEditorModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly onMetaChange: (request: {
    readonly appId: FileEditorAppId;
    readonly appInstanceId: string;
    readonly title: string;
    readonly iconKey: FileEditorAppIconKey;
    readonly filePath: string;
    readonly fileSessionId: string;
    readonly isDirty: boolean;
  }) => void;
};

export type FileEditorReadOutcome = FileReadResult;
export type FileEditorWriteOutcome = FileWriteResult;

export const isLspLanguageId = (value: string): value is LspLanguageId =>
  value === "typescript" ||
  value === "javascript" ||
  value === "rust" ||
  value === "python";
