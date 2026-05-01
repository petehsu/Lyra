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
