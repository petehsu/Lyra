export type ScreenshotPreviewImage = {
  readonly previewId: string;
  readonly imageBase64: string;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly label?: string;
  readonly source?: string;
  readonly width?: number;
  readonly height?: number;
  readonly workspaceTabId?: string;
  readonly workspaceTabTitle?: string;
  readonly workspaceTabPageKind?: string;
  readonly workspaceTabAddress?: string;
};

export type ScreenshotPreviewPresentRequest = {
  readonly imageBase64: string;
  readonly mimeType?: "image/png" | "image/jpeg";
  readonly label?: string;
  readonly source?: string;
  readonly width?: number;
  readonly height?: number;
  readonly workspaceTabId?: string;
  readonly workspaceTabTitle?: string;
  readonly workspaceTabPageKind?: string;
  readonly workspaceTabAddress?: string;
};

export type ScreenshotPreviewEvent =
  | {
      readonly kind: "presented";
      readonly previewId: string;
    }
  | {
      readonly kind: "dismissed";
      readonly previewId: string;
    }
  | {
      readonly kind: "drag-started";
      readonly previewId: string;
    };