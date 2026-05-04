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

export type DownloadManagerChecksumAlgorithm = "md5" | "sha1" | "sha256";

export type DownloadManagerChecksum = {
  readonly algorithm: DownloadManagerChecksumAlgorithm;
  readonly expected: string;
  readonly actual?: string | undefined;
  readonly verified?: boolean | undefined;
};

export type DownloadManagerSaveRule = {
  readonly id: string;
  readonly enabled: boolean;
  readonly name: string;
  readonly directory: string;
  readonly extensions?: readonly string[] | undefined;
  readonly hostContains?: readonly string[] | undefined;
  readonly protocols?: readonly string[] | undefined;
  readonly tags?: readonly string[] | undefined;
};

export type DownloadManagerScheduleSettings = {
  readonly enabled: boolean;
  readonly startMinuteOfDay: number;
  readonly endMinuteOfDay: number;
  readonly outsideAction: "pause" | "speed-limit";
  readonly outsideSpeedLimitBytesPerSecond?: number | null | undefined;
};

export type DownloadManagerProxySettings = {
  readonly mode: "system" | "direct" | "http" | "socks5";
  readonly url?: string | undefined;
};

export type DownloadManagerPostProcessingSettings = {
  readonly autoExtract: boolean;
  readonly extractDirectory?: string | undefined;
  readonly deleteArchiveAfterExtract: boolean;
  readonly detectSplitArchives: boolean;
};

export type DownloadManagerBtSettings = {
  readonly dhtEnabled: boolean;
  readonly peerExchangeEnabled: boolean;
  readonly localPeerDiscoveryEnabled: boolean;
  readonly seedTimeMinutes: number;
  readonly trackerUrls: readonly string[];
  readonly maxUploadBytesPerSecond: number | null;
};

export type DownloadManagerBtTaskOptions = {
  readonly selectedFileIndexes?: readonly number[] | undefined;
  readonly trackerUrls?: readonly string[] | undefined;
};

export type DownloadManagerPostProcessingState =
  | "idle"
  | "running"
  | "completed"
  | "warning"
  | "failed";

export type DownloadManagerSettings = {
  readonly version: 1;
  readonly speedLimitBytesPerSecond: number | null;
  readonly schedule: DownloadManagerScheduleSettings | null;
  readonly proxy: DownloadManagerProxySettings;
  readonly postProcessing: DownloadManagerPostProcessingSettings;
  readonly bt: DownloadManagerBtSettings;
  readonly defaultHeaders: Readonly<Record<string, string>>;
  readonly defaultCookieHeader: string | null;
  readonly saveRules: readonly DownloadManagerSaveRule[];
  readonly updatedAt: string;
};

export type DownloadManagerUpdateSettingsRequest = {
  readonly speedLimitBytesPerSecond?: number | null | undefined;
  readonly schedule?: DownloadManagerScheduleSettings | null | undefined;
  readonly proxy?: DownloadManagerProxySettings | undefined;
  readonly postProcessing?: DownloadManagerPostProcessingSettings | undefined;
  readonly bt?: DownloadManagerBtSettings | undefined;
  readonly defaultHeaders?: Readonly<Record<string, string>> | undefined;
  readonly defaultCookieHeader?: string | null | undefined;
  readonly saveRules?: readonly DownloadManagerSaveRule[] | undefined;
};

export type DownloadManagerTask = {
  readonly id: string;
  readonly url: string;
  readonly originalUrl?: string | undefined;
  readonly finalUrl?: string | undefined;
  readonly referrer?: string | undefined;
  readonly fileName: string;
  readonly mimeType?: string | undefined;
  readonly requestHeaders?: Readonly<Record<string, string>> | undefined;
  readonly proxy?: DownloadManagerProxySettings | undefined;
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
  readonly checksum?: DownloadManagerChecksum | undefined;
  readonly retryCount?: number | undefined;
  readonly maxRetries?: number | undefined;
  readonly retryDelayMs?: number | undefined;
  readonly mirrors?: readonly string[] | undefined;
  readonly activeMirrorIndex?: number | undefined;
  readonly bt?: DownloadManagerBtTaskOptions | undefined;
  readonly schedulePaused?: boolean | undefined;
  readonly postProcessingState?: DownloadManagerPostProcessingState | undefined;
  readonly postProcessingMessage?: string | undefined;
  readonly missingArchiveParts?: readonly string[] | undefined;
  readonly tags: readonly string[];
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
  readonly proxy?: DownloadManagerProxySettings | undefined;
  readonly checksum?: DownloadManagerChecksum | undefined;
  readonly maxRetries?: number | undefined;
  readonly retryDelayMs?: number | undefined;
  readonly mirrors?: readonly string[] | undefined;
  readonly bt?: DownloadManagerBtTaskOptions | undefined;
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

export type DownloadManagerRemoteApiStatus = {
  readonly running: boolean;
  readonly host: string;
  readonly port: number | null;
  readonly baseUrl: string | null;
  readonly token: string;
};

export type DownloadManagerRemoteApiStartRequest = {
  readonly host?: string | undefined;
  readonly port?: number | undefined;
  readonly allowLan?: boolean | undefined;
};
