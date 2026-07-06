import type {
  FileEditorAppState,
  FileEditorChangeReviewItem,
  FileEditorControlMode,
  FileEditorLabels,
  FileEditorModel,
  FileEditorSurfaceVariant
} from "./types";
import type { WorkbenchEditorGpuAcceleration } from "../preferences";

export type FileEditorSurfaceProps = {
  readonly state: FileEditorAppState | null;
  readonly labels: FileEditorLabels;
  readonly themeSignature: string;
  readonly model: FileEditorModel;
  readonly surfaceVariant?: FileEditorSurfaceVariant;
  readonly controlMode?: FileEditorControlMode;
  readonly contributeTitlebar?: boolean;
  readonly gpuAcceleration?: WorkbenchEditorGpuAcceleration;
  readonly editorWorkAcceptLabel?: string;
  readonly editorWorkRejectLabel?: string;
  readonly editorWorkUndoLabel?: string;
  readonly editorWorkPrevLabel?: string;
  readonly editorWorkNextLabel?: string;
  readonly editorWorkAcceptAllLabel?: string;
  readonly canGoToPreviousEditorWorkItem?: boolean;
  readonly canGoToNextEditorWorkItem?: boolean;
  readonly canAcceptAllEditorWorkItems?: boolean;
  readonly activeEditorWorkItem?: FileEditorChangeReviewItem;
  readonly onGoToPreviousEditorWorkItem?: () => void;
  readonly onGoToNextEditorWorkItem?: () => void;
  readonly onAcceptAllEditorWorkItems?: () => void;
  readonly onAcceptEditorWorkItem?: (item: FileEditorChangeReviewItem) => void;
  readonly onRejectEditorWorkItem?: (item: FileEditorChangeReviewItem) => void;
  readonly onUndoEditorWorkItem?: (item: FileEditorChangeReviewItem) => void;
};
