import type {
  ImageViewerOpenResult,
  ImageViewerReadTileRequest,
  ImageViewerTileResponse
} from "../../../shared/image-viewer";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

export type ImageViewerAppId = "image-viewer";
export type ImageViewerAppIconKey = "image-viewer-default";

export type ImageViewerStatus = "idle" | "loading" | "ready" | "unsupported" | "error";
export type ImageViewerBackground = "checkerboard" | "dark" | "light";

export type ImageViewerViewport = {
  readonly zoom: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly rotation: number;
  readonly background: ImageViewerBackground;
};

export type ImageViewerAppState = {
  readonly instanceId: string;
  readonly filePath: string;
  readonly title: string;
  readonly iconKey: ImageViewerAppIconKey;
  readonly status: ImageViewerStatus;
  readonly sessionId: string | undefined;
  readonly openResult: ImageViewerOpenResult | null;
  readonly importProgress: number | undefined;
  readonly message: string | undefined;
  readonly view: ImageViewerViewport;
  readonly siblingPaths: readonly string[];
  readonly siblingIndex: number;
};

export type ImageViewerLabels = {
  readonly loading: string;
  readonly unavailable: string;
  readonly unsupported: string;
  readonly retry: string;
  readonly fit: string;
  readonly actualSize: string;
  readonly zoomIn: string;
  readonly zoomOut: string;
  readonly reset: string;
  readonly rotateLeft: string;
  readonly rotateRight: string;
  readonly background: string;
  readonly previous: string;
  readonly next: string;
  readonly nativeTiles: string;
  readonly sourceOnly: string;
  readonly metadata: string;
};

export type ImageViewerModel = {
  readonly createInstance: (filePath: string) => {
    readonly appId: ImageViewerAppId;
    readonly appInstanceId: string;
    readonly title: string;
    readonly iconKey: ImageViewerAppIconKey;
    readonly filePath: string;
    readonly isDirty: boolean;
  };
  readonly findInstanceByPath: (filePath: string) => string | null;
  readonly getState: (instanceId: string) => ImageViewerAppState | null;
  readonly ensureInstance: (instanceId: string, options: { readonly filePath: string }) => void;
  readonly syncTabInstances: (instanceIds: readonly string[]) => void;
  readonly openImage: (instanceId: string, filePath: string) => Promise<void>;
  readonly openAdjacent: (instanceId: string, direction: -1 | 1) => Promise<void>;
  readonly readTile: (request: ImageViewerReadTileRequest) => Promise<ImageViewerTileResponse>;
  readonly setViewport: (instanceId: string, patch: Partial<ImageViewerViewport>) => void;
  readonly resetViewport: (instanceId: string) => void;
  readonly touchInstance: (instanceId: string) => void;
};

export type UseImageViewerModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly onMetaChange: (request: {
    readonly appId: ImageViewerAppId;
    readonly appInstanceId: string;
    readonly title: string;
    readonly iconKey: ImageViewerAppIconKey;
    readonly filePath: string;
    readonly fileSessionId?: string;
    readonly isDirty: boolean;
  }) => void;
};
