export type ImageViewerOpenRequest = {
  readonly path: string;
};

export type ImageViewerCloseSessionRequest = {
  readonly sessionId: string;
};

export type ImageViewerReadTileRequest = {
  readonly sessionId: string;
  readonly level: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly generationId?: string;
};

export type ImageViewerLevel = {
  readonly level: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
};

export type ImageViewerOpenResult = {
  readonly sessionId: string;
  readonly path: string;
  readonly title: string;
  readonly format: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly hasAlpha: boolean;
  readonly orientation: number;
  readonly colorSpace: string;
  readonly sizeBytes: number;
  readonly tileSize: number;
  readonly levels: readonly ImageViewerLevel[];
  readonly nativeTileSupported: boolean;
  readonly sourceUrl: string;
  readonly kernel: string;
  readonly renderMode: "source" | "vector" | "native-tiles";
  readonly cacheState: "none" | "memory" | "metadata" | "importing" | "ready" | "error";
  readonly cacheId: string;
  readonly generationId: string;
  readonly sampleFormat: string;
  readonly channelCount: number;
  readonly hasInternalTiles: boolean;
  readonly hasInternalMipmaps: boolean;
  readonly importProgress: number;
};

export type ImageViewerTileResponse = {
  readonly width: number;
  readonly height: number;
  readonly stride: number;
  readonly pixelFormat: "rgba8";
  readonly pixels: Uint8Array;
};

export type ImageViewerSessionStatusEvent = {
  readonly kind: "session-status";
  readonly sessionId: string;
  readonly generationId: string;
  readonly status: "opening" | "ready" | "closed" | "error";
  readonly message?: string;
};

export type ImageViewerImportProgressEvent = {
  readonly kind: "import-progress";
  readonly sessionId: string;
  readonly generationId: string;
  readonly cacheId: string;
  readonly progress: number;
  readonly message?: string;
};

export type ImageViewerCacheReadyEvent = {
  readonly kind: "cache-ready";
  readonly sessionId: string;
  readonly generationId: string;
  readonly cacheId: string;
};

export type ImageViewerCacheErrorEvent = {
  readonly kind: "cache-error";
  readonly sessionId: string;
  readonly generationId: string;
  readonly cacheId: string;
  readonly message: string;
};

export type ImageViewerEvent =
  | ImageViewerSessionStatusEvent
  | ImageViewerImportProgressEvent
  | ImageViewerCacheReadyEvent
  | ImageViewerCacheErrorEvent;
