import type {
  AgentVmBinding,
  AgentVmImageEntry,
  AgentVmPasswordRevealResult,
  AgentVmSummary,
  LyraDesktopApi
} from "../../../shared/desktop-bridge";

export type AgentVmSurfaceLabels = {
  readonly title: string;
  readonly subtitle: string;
  readonly create: string;
  readonly createSessionTitle: string;
  readonly defaultImage: string;
  readonly imageMissing: string;
  readonly downloadAndStart: string;
  readonly preparing: string;
  readonly checkingImage: string;
  readonly downloadingImage: string;
  readonly creatingVm: string;
  readonly startingVm: string;
  readonly downloadProgress: string;
  readonly downloadFailed: string;
  readonly downloadManagerUnavailable: string;
  readonly importImage: string;
  readonly imageInstalled: string;
  readonly refresh: string;
  readonly unavailable: string;
  readonly empty: string;
  readonly loading: string;
  readonly vmId: string;
  readonly state: string;
  readonly image: string;
  readonly workspace: string;
  readonly ownerSession: string;
  readonly attachedSessions: string;
  readonly updatedAt: string;
  readonly start: string;
  readonly stop: string;
  readonly loginUser: string;
  readonly loginPassword: string;
  readonly showPassword: string;
  readonly copyPassword: string;
  readonly passwordCopied: string;
  readonly passwordUnavailable: string;
  readonly attach: string;
  readonly takeover: string;
  readonly fork: string;
  readonly inherit: string;
  readonly scopedSession: string;
  readonly noSessionScope: string;
  readonly actionFailed: string;
  readonly console: string;
  readonly consoleConnecting: string;
  readonly consoleConnected: string;
  readonly consoleDisconnected: string;
  readonly consoleUnavailable: string;
  readonly consoleStopped: string;
  readonly consoleNoPort: string;
  readonly activeVm: string;
  readonly vmList: string;
  readonly connection: string;
  readonly sshPort: string;
  readonly vncPort: string;
  readonly liteProfile: string;
};

export type AgentVmSurfaceProps = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: AgentVmSurfaceLabels;
  readonly sessionId?: string | null;
};

export type AgentVmRuntimeStatus = "idle" | "loading" | "ready" | "error";
export type AgentVmProvisioningStage =
  | "idle"
  | "checking_image"
  | "downloading_image"
  | "creating_vm"
  | "starting_vm";

export type AgentVmRuntimeState = {
  readonly status: AgentVmRuntimeStatus;
  readonly vms: readonly AgentVmSummary[];
  readonly bindings: readonly AgentVmBinding[];
  readonly images: readonly AgentVmImageEntry[];
  readonly busyVmId: string | null;
  readonly creating: boolean;
  readonly downloadingImage: boolean;
  readonly provisioningStage: AgentVmProvisioningStage;
  readonly downloadTaskId: string | null;
  readonly downloadReceivedBytes: number;
  readonly downloadTotalBytes: number;
  readonly downloadSpeedBytesPerSecond: number;
  readonly importingImage: boolean;
  readonly revealingPasswordVmId: string | null;
  readonly revealedPasswords: Readonly<Record<string, AgentVmPasswordRevealResult>>;
  readonly errorMessage: string | null;
};
