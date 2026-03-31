import type { FileEditorLabels, FileEditorModel } from "../../file-editor";

export type AiPanelRuntimeKind = "file" | "web" | "app" | (string & {});
export type AiPanelRuntimeDecision = "accepted" | "rejected";
export type AiPanelRuntimeControlMode = "ai_only" | "human_takeover";
export type AiPanelRuntimeWindowState = "visible" | "collapsing" | "collapsed";
export type AiPanelRuntimeCollapsedState = "running" | "completed" | "error";

export type AiPanelRuntimeStatus =
  | "queued"
  | "running"
  | "completed"
  | "collapsing"
  | "collapsed"
  | "error";

export type AiPanelRuntimePresentation = "window" | "capsule";

export type AiPanelRuntimeItem = {
  readonly id: string;
  readonly kind: AiPanelRuntimeKind;
  readonly taskCardKind?: string;
  readonly taskCardPayload?: unknown;
  readonly title: string;
  readonly summary: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly status: AiPanelRuntimeStatus;
  readonly presentation: AiPanelRuntimePresentation;
  readonly windowState: AiPanelRuntimeWindowState;
  readonly collapsedState: AiPanelRuntimeCollapsedState;
  readonly controlMode: AiPanelRuntimeControlMode;
  readonly filePath?: string;
  readonly editorInstanceId?: string;
  readonly computerAppKind?: "file-manager" | "file-editor" | "terminal" | "browser";
  readonly computerAppInstanceId?: string;
  readonly addedLines?: number;
  readonly removedLines?: number;
  readonly decision?: AiPanelRuntimeDecision;
};

export type AiPanelRuntimeLabels = {
  readonly workspaceTitle: string;
  readonly emptyState: string;
  readonly openInWorkspaceTab: string;
  readonly kindFile: string;
  readonly kindWeb: string;
  readonly kindApp: string;
  readonly statusQueued: string;
  readonly statusRunning: string;
  readonly statusCompleted: string;
  readonly statusError: string;
};

export type AiPanelRuntimeWorkspaceStageProps = {
  readonly items: readonly AiPanelRuntimeItem[];
  readonly activeItemId: string | null;
  readonly labels: AiPanelRuntimeLabels;
  readonly fileEditorModel: FileEditorModel;
  readonly fileEditorLabels: FileEditorLabels;
  readonly taskCardAcceptLabel: string;
  readonly taskCardRejectLabel: string;
  readonly taskCardUndoLabel: string;
  readonly themeSignature: string;
  readonly onActivateItem: (itemId: string) => void;
  readonly onOpenFileInWorkspaceTab: (filePath: string) => void;
  readonly onAcceptItem?: (itemId: string) => void;
  readonly onRejectItem?: (itemId: string) => void;
  readonly onUndoItem?: (itemId: string) => void;
};
