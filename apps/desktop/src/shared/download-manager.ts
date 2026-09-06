export type DownloadManagerTaskState =
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "canceled";

export type DownloadManagerTaskSource = "browser" | "manual" | "retry";

export type DownloadManagerPriority = "low" | "normal" | "high";

export type DownloadManagerTaskBackend = "electron" | "native-http" | "curl" | "aria2";

export type DownloadManagerTaskOutputKind = "file" | "directory";

export type DownloadManagerProxySettings = {
  readonly mode: "system" | "direct" | "http" | "socks5";
  readonly url?: string | undefined;
};

export type DownloadManagerBtSettings = {
  readonly dhtEnabled: boolean;
  readonly peerExchangeEnabled: boolean;
  readonly localPeerDiscoveryEnabled: boolean;
  readonly seedTimeMinutes: number;
  readonly trackerUrls: readonly string[];
  readonly maxUploadBytesPerSecond: number | null;
};

export type DownloadManagerSettings = {
  readonly version: 1;
  readonly speedLimitBytesPerSecond: number | null;
  readonly proxy: DownloadManagerProxySettings;
  readonly bt: DownloadManagerBtSettings;
  readonly defaultHeaders: Readonly<Record<string, string>>;
  readonly defaultCookieHeader: string | null;
  readonly maxConcurrentDownloads: number;
  readonly defaultDirectory?: string | null | undefined;
  readonly updatedAt: string;
};

export type DownloadManagerUpdateSettingsRequest = {
  readonly speedLimitBytesPerSecond?: number | null | undefined;
  readonly proxy?: DownloadManagerProxySettings | undefined;
  readonly bt?: DownloadManagerBtSettings | undefined;
  readonly defaultHeaders?: Readonly<Record<string, string>> | undefined;
  readonly defaultCookieHeader?: string | null | undefined;
  readonly maxConcurrentDownloads?: number | undefined;
  readonly defaultDirectory?: string | null | undefined;
};

export type DownloadManagerTask = {
  readonly id: string;
  readonly url: string;
  readonly originalUrl?: string | undefined;
  readonly fileName: string;
  readonly mimeType?: string | undefined;
  readonly requestHeaders?: Readonly<Record<string, string>> | undefined;
  readonly savePath: string;
  readonly directory: string;
  readonly protocol: string;
  readonly source: DownloadManagerTaskSource;
  readonly backend?: DownloadManagerTaskBackend | undefined;
  readonly outputKind?: DownloadManagerTaskOutputKind | undefined;
  readonly sourceTabId?: string | undefined;
  readonly sourceTitle?: string | undefined;
  readonly state: DownloadManagerTaskState;
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly speedBytesPerSecond: number;
  readonly estimatedRemainingMs?: number | undefined;
  readonly priority: DownloadManagerPriority;
  readonly connectionsRequested: number;
  readonly connectionsActive: number;
  readonly canResume: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string | undefined;
  readonly completedAt?: string | undefined;
  readonly errorMessage?: string | undefined;
  readonly retryCount?: number | undefined;
  readonly maxRetries?: number | undefined;
  readonly retryDelayMs?: number | undefined;
};

export type DownloadManagerSnapshot = {
  readonly tasks: readonly DownloadManagerTask[];
};

export type DownloadManagerEvent =
  | {
      readonly kind: "snapshot";
      readonly snapshot: DownloadManagerSnapshot;
    }
  | {
      readonly kind: "task-updated";
      readonly task: DownloadManagerTask;
    }
  | {
      readonly kind: "task-removed";
      readonly taskId: string;
    };

export type DownloadManagerEnqueueRequest = {
  readonly text?: string | undefined;
  readonly urls?: readonly string[] | undefined;
  readonly partialFilePath?: string | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly cookieHeader?: string | undefined;
  readonly source?: DownloadManagerTaskSource | undefined;
  readonly sourceTabId?: string | undefined;
  readonly sourceTitle?: string | undefined;
};

export type DownloadManagerTaskRequest = {
  readonly taskId: string;
};

export type DownloadManagerSetPriorityRequest = DownloadManagerTaskRequest & {
  readonly priority: DownloadManagerPriority;
};

export type DownloadManagerBatchRequest = {
  readonly taskIds?: readonly string[] | undefined;
};