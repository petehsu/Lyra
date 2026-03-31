export type LinuxGraphicsBackend = "wayland" | "x11";

export type LinuxGpuMode = "hardware" | "software";

export type LinuxStrategySource = "auto" | "cli" | "env";

export type LinuxSessionType = "wayland" | "x11" | "unknown";

export type LinuxCompatWarning = {
  readonly code:
    | "both-display-servers-detected"
    | "session-env-mismatch"
    | "unknown-session"
    | "unknown-desktop";
  readonly message: string;
};

export type LinuxEnvironmentFacts = {
  readonly sessionType: LinuxSessionType;
  readonly desktop: string;
  readonly waylandDisplay: string | null;
  readonly x11Display: string | null;
  readonly isRoot: boolean;
};

export type LinuxCompatPlan = {
  readonly enabled: boolean;
  readonly safeMode: boolean;
  readonly backend: LinuxGraphicsBackend;
  readonly gpuMode: LinuxGpuMode;
  readonly backendSource: LinuxStrategySource;
  readonly gpuSource: LinuxStrategySource;
  readonly warnings: readonly LinuxCompatWarning[];
  readonly notes: readonly string[];
  readonly appliedEnv: Readonly<Record<string, string>>;
  readonly appliedSwitches: Readonly<Record<string, string>>;
  readonly disableHardwareAcceleration: boolean;
  readonly facts: LinuxEnvironmentFacts;
};

export type LinuxCompatStatus = {
  readonly platform: NodeJS.Platform;
  readonly enabled: boolean;
  readonly safeMode: boolean;
  readonly backend: LinuxGraphicsBackend;
  readonly gpuMode: LinuxGpuMode;
  readonly backendSource: LinuxStrategySource;
  readonly gpuSource: LinuxStrategySource;
  readonly warnings: readonly LinuxCompatWarning[];
  readonly notes: readonly string[];
  readonly appliedEnv: Readonly<Record<string, string>>;
  readonly appliedSwitches: Readonly<Record<string, string>>;
  readonly facts: LinuxEnvironmentFacts;
  readonly generatedAt: string;
};

export type LinuxCompatReadStatusResponse = LinuxCompatStatus;

export type LinuxCompatExportResponse = {
  readonly ok: boolean;
  readonly filePath?: string;
  readonly error?: string;
};

export type LinuxCompatBridge = {
  readonly status: LinuxCompatStatus;
  readonly applyToProcessEnv: () => void;
  readonly applyToElectronApp: (app: Electron.App) => void;
  readonly persistStatusSnapshot: (storageRoot: string) => void;
  readonly exportDiagnosticsSnapshot: (storageRoot: string) => LinuxCompatExportResponse;
};
