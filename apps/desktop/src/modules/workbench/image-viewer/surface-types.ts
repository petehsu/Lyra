import type { FileEditorLabels, FileEditorModel } from "../file-editor";
import type {
  ImageViewerAppState,
  ImageViewerLabels,
  ImageViewerModel
} from "./types";

export type ImageViewerSurfaceProps = {
  readonly state: ImageViewerAppState | null;
  readonly labels: ImageViewerLabels;
  readonly model: ImageViewerModel;
  readonly themeSignature: string;
  readonly contributeTitlebar?: boolean;
  readonly fileEditorModel?: FileEditorModel;
  readonly fileEditorLabels?: FileEditorLabels;
};
