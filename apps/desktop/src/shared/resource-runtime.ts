export type LyraResourceLifecycleState =
  | "foreground"
  | "visible"
  | "hot-hidden"
  | "warm-suspended"
  | "frozen"
  | "tombstoned"
  | "restoring"
  | "archived";

export type LyraResourceNode = {
  readonly resourceId: string;
  readonly kind: string;
  readonly label: string;
  readonly viewId: string;
  readonly stateKey: string;
  readonly coreKey: string;
  readonly lifecycleState: LyraResourceLifecycleState;
  readonly tabId?: string;
  readonly address?: string;
  readonly pid?: number;
  readonly visible: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
};

export type LyraResourceProcessSnapshot = {
  readonly pid: number;
  readonly memoryBytes: number;
};

export type LyraResourceCoreGroup = {
  readonly coreKey: string;
  readonly resourceIds: readonly string[];
  readonly viewCount: number;
  readonly activeCount: number;
  readonly tombstonedCount: number;
};

export type LyraResourceSnapshot = {
  readonly generation: number;
  readonly capturedAt: number;
  readonly process: LyraResourceProcessSnapshot;
  readonly resources: readonly LyraResourceNode[];
  readonly coreGroups: readonly LyraResourceCoreGroup[];
};

export type LyraResourceMonitorScope = "lyra" | "all";

export type LyraSystemLoadSample = {
  readonly score: number;
  readonly capturedAt: number;
};

export type LyraSystemMetricSnapshot = {
  readonly supported: boolean;
  readonly value: number | null;
  readonly total?: number;
  readonly used?: number;
  readonly free?: number;
  readonly unit: "percent" | "bytes" | "bytesPerSecond" | "count" | "score" | "text";
  readonly detail?: string;
};

export type LyraSystemActivityKind = "lyra-resource" | "process" | "runtime";

export type LyraSystemActivityAction =
  | "restart"
  | "kill"
  | "suspend"
  | "resume"
  | "inspect"
  | "reveal";

export type LyraSystemActivity = {
  readonly activityId: string;
  readonly kind: LyraSystemActivityKind;
  readonly label: string;
  readonly subtitle?: string;
  readonly pid?: number;
  readonly state?: string;
  readonly cpuPercent?: number;
  readonly memoryBytes?: number;
  readonly loadScore?: number;
  readonly actions: readonly LyraSystemActivityAction[];
};

export type LyraSystemSnapshot = {
  readonly capturedAt: number;
  readonly runtimeName: string;
  readonly kernelName: string;
  readonly loadScore: number;
  readonly cpu: LyraSystemMetricSnapshot & {
    readonly logicalCores?: number;
    readonly loadAverage1m?: number;
  };
  readonly memory: LyraSystemMetricSnapshot;
  readonly buffers: LyraSystemMetricSnapshot;
  readonly disk: LyraSystemMetricSnapshot;
  readonly network: LyraSystemMetricSnapshot & {
    readonly receivedBytes?: number;
    readonly transmittedBytes?: number;
  };
  readonly gpu: LyraSystemMetricSnapshot;
  readonly lyra: LyraSystemMetricSnapshot & {
    readonly resources?: number;
    readonly coreGroups?: number;
    readonly tombstoned?: number;
    readonly generation?: number;
  };
  readonly activities: readonly LyraSystemActivity[];
};

export type LyraSystemActivityActionRequest = {
  readonly activityId: string;
  readonly action: LyraSystemActivityAction;
};

export type LyraSystemActivityActionResult = {
  readonly ok: boolean;
  readonly supported: boolean;
  readonly message: string;
};

export type LyraResourceRegisterRequest = {
  readonly resourceId: string;
  readonly kind: string;
  readonly label: string;
  readonly viewId: string;
  readonly stateKey: string;
  readonly coreKey: string;
  readonly lifecycleState: LyraResourceLifecycleState;
  readonly tabId?: string;
  readonly address?: string;
  readonly pid?: number;
  readonly visible?: boolean;
};

export type LyraResourceLifecycleRequest = {
  readonly resourceId: string;
  readonly targetState: LyraResourceLifecycleState;
};

export type LyraResourceEvent =
  | {
      readonly kind: "snapshot";
      readonly snapshot: LyraResourceSnapshot;
    }
  | {
      readonly kind: "resource-updated";
      readonly resourceId: string;
      readonly generation: number;
    }
  | {
      readonly kind: "resource-removed";
      readonly resourceId: string;
      readonly generation: number;
    }
  | {
      readonly kind: "lifecycle-requested";
      readonly resourceId: string;
      readonly targetState: LyraResourceLifecycleState;
      readonly generation: number;
    };
