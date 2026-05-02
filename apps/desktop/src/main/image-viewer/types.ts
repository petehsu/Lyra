import type {
  ImageViewerCloseSessionRequest,
  ImageViewerEvent,
  ImageViewerOpenRequest,
  ImageViewerOpenResult,
  ImageViewerReadTileRequest,
  ImageViewerTileResponse
} from "../../shared/image-viewer";

export type ImageViewerNativeOpenRequest = ImageViewerOpenRequest & {
  readonly storageRoot?: string;
};

export type ImageViewerNativeBindings = {
  readonly openImage: (request: ImageViewerNativeOpenRequest) => Promise<ImageViewerOpenResult>;
  readonly readTile: (request: ImageViewerReadTileRequest) => Promise<ImageViewerTileResponse>;
  readonly closeSession: (request: ImageViewerCloseSessionRequest) => Promise<boolean>;
};

export type ImageViewerNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: ImageViewerNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };

export type ImageViewerIpcBridge = {
  readonly loadResult: Extract<ImageViewerNativeLoadResult, { readonly ok: true }>;
  readonly nativeBindings: ImageViewerNativeBindings;
  readonly publishEvent: (event: ImageViewerEvent) => void;
  readonly dispose: () => void;
};
