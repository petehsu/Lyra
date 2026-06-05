export type LyraPerformanceResourceKind =
  | "browserPage"
  | "workspaceSurface"
  | "pluginSurface"
  | "terminalPane"
  | "agentTask"
  | "downloadTask"
  | "lspTask"
  | "searchTask";

export type LyraPerformanceResourceLifecycle =
  | "foreground"
  | "visible"
  | "hotHidden"
  | "keptAlive"
  | "throttled"
  | "snapshotted"
  | "tombstoned"
  | "restoring";

export type LyraPerformanceActivitySignals = {
  readonly hasUserInput?: boolean;
  readonly hasFormDraft?: boolean;
  readonly hasActiveMedia?: boolean;
  readonly hasPermissionPrompt?: boolean;
  readonly hasAgentControl?: boolean;
  readonly hasDivergentStorage?: boolean;
  readonly hasDivergentHistory?: boolean;
  readonly isLoading?: boolean;
  readonly isFullscreen?: boolean;
  readonly unknown?: boolean;
};

export type LyraPerformanceIsolationFlags = {
  readonly requiresDedicatedCore?: boolean;
  readonly containsSensitiveInput?: boolean;
  readonly authenticatedSession?: boolean;
  readonly crossOriginState?: boolean;
  readonly untrustedPlugin?: boolean;
  readonly elevatedPrivilege?: boolean;
};

export type LyraPerformanceResourceDescriptor = {
  readonly resourceId: string;
  readonly kind: LyraPerformanceResourceKind;
  readonly coreKey: string;
  readonly stateKey: string;
  readonly lifecycle: LyraPerformanceResourceLifecycle;
  readonly visible: boolean;
  readonly active: boolean;
  readonly signals?: LyraPerformanceActivitySignals;
  readonly isolation?: LyraPerformanceIsolationFlags;
  readonly processId?: number;
  readonly webContentsId?: number;
  readonly platformHandle?: string;
  readonly sharedSignature?: string;
  readonly updatedAt?: number;
};

export type LyraPerformanceDecisionKind =
  | "grouped"
  | "forked"
  | "keptAlive"
  | "throttled"
  | "snapshotted"
  | "restored"
  | "degraded"
  | "authorizationRequired";

export type LyraPerformanceKernelEvent = {
  readonly sequence: number;
  readonly at: number;
  readonly decision: LyraPerformanceDecisionKind;
  readonly resourceId: string;
  readonly kind: LyraPerformanceResourceKind;
  readonly coreKey: string;
  readonly stateKey: string;
  readonly assignedCoreId: string;
  readonly reason: string;
  readonly degraded: boolean;
  readonly affectedResourceIds: readonly string[];
};

export type LyraPerformanceHelperStatus = {
  readonly protocolVersion: number;
  readonly platform: string;
  readonly adapterKind: string;
  readonly processId: number;
  readonly elevated: boolean;
  readonly serviceMode: boolean;
  readonly transport: string;
  readonly canSampleProcesses: boolean;
  readonly canApplyPressurePolicy: boolean;
  readonly notes: readonly string[];
};

export type LyraPerformancePlatformAdapterStatus = {
  readonly platform: string;
  readonly adapterKind: string;
  readonly supported: boolean;
  readonly authorizationRequired: boolean;
  readonly authorized: boolean;
  readonly helperConfigured: boolean;
  readonly helperTransport?: string;
  readonly helperStatus?: LyraPerformanceHelperStatus;
  readonly notes: readonly string[];
};

export type LyraPerformanceKernelStatus = {
  readonly mode: "fullKernel" | "degraded" | string;
  readonly fullKernelAvailable: boolean;
  readonly authorizationRequired: boolean;
  readonly authorized: boolean;
  readonly platformAdapter: LyraPerformancePlatformAdapterStatus;
  readonly resources: number;
  readonly coreGroups: number;
  readonly eventsRetained: number;
  readonly v1Target: {
    readonly repeatedResourceCount: number;
    readonly memoryReductionPercent: number;
    readonly cpuReductionPercent: number;
    readonly restoreP95Ms: number;
  };
};

export type LyraPerformanceProcessSample = {
  readonly processId: number;
  readonly exists: boolean;
  readonly residentMemoryBytes: number;
  readonly virtualMemoryBytes: number;
  readonly cpuPercent: number;
  readonly name?: string;
};

export type LyraPerformancePressureSnapshot = {
  readonly at: number;
  readonly helperAvailable: boolean;
  readonly helperConfigured: boolean;
  readonly helperTransport?: string;
  readonly helperError?: string;
  readonly requestedProcessIds: readonly number[];
  readonly samples: readonly LyraPerformanceProcessSample[];
  readonly totalResidentMemoryBytes: number;
  readonly totalCpuPercent: number;
};

export type LyraPerformancePressureHarnessResult = {
  readonly repeatedResourceCount: number;
  readonly status: LyraPerformanceKernelStatus;
  readonly logicalSavings: {
    readonly baselineResourceUnits: number;
    readonly scheduledCoreUnits: number;
    readonly memoryReductionPercent: number;
    readonly cpuReductionPercent: number;
    readonly restoreP95TargetMs: number;
    readonly meetsV1Target: boolean;
  };
  readonly measuredSavings: {
    readonly baselineResourceUnits: number;
    readonly logicalScheduledCoreUnits: number;
    readonly measuredUniqueProcesses: number;
    readonly baselineResidentMemoryBytes: number;
    readonly scheduledResidentMemoryBytes: number;
    readonly memoryReductionPercent?: number;
    readonly baselineCpuPercent: number;
    readonly scheduledCpuPercent: number;
    readonly cpuReductionPercent?: number;
  };
  readonly pressureSnapshot: LyraPerformancePressureSnapshot;
  readonly restoreForkP95Ms: number;
  readonly acceptance: {
    readonly logicalReuseTargetMet: boolean;
    readonly measuredMemoryTargetMet: boolean;
    readonly measuredCpuTargetMet: boolean;
    readonly restoreP95TargetMet: boolean;
    readonly fullKernelAuthorized: boolean;
    readonly noCrossStateLeaksDetected: boolean;
    readonly activeWorkWasNotInterrupted: boolean;
    readonly meetsV1Target: boolean;
  };
};
