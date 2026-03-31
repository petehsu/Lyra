import type { FileManagerDiskOsFlavor } from "./file-manager";

export type AiComputerPowerState = "off" | "booting" | "on" | "shutting_down";
export type AiComputerBootReason = "user" | "ai";
export type AiComputerAppKind = "desktop" | "file-manager" | "file-editor" | "terminal" | "browser";
export type AiComputerWindowState = "normal" | "minimized" | "maximized";
export type AiComputerSystemRuntimeMode = "sandbox" | "inprocess";
export type AiComputerSystemShellMode = "content-only" | "full-shell";
export type AiComputerSystemContextState = "off" | "booting" | "on" | "error";

export type AiComputerWindowFrame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type AiComputerAppInstance = {
  readonly id: string;
  readonly kind: AiComputerAppKind;
  readonly title: string;
  readonly openedAt: string;
  readonly lastFocusedAt: string;
  readonly windowState: AiComputerWindowState;
  readonly frame: AiComputerWindowFrame;
  readonly lastNormalFrame: AiComputerWindowFrame | null;
  readonly zIndex: number;
  readonly filePath?: string;
  readonly directoryPath?: string;
  readonly address?: string;
};

export type AiComputerSessionState = {
  readonly sessionId: string;
  readonly hasBooted: boolean;
  readonly powerState: AiComputerPowerState;
  readonly bootReason?: AiComputerBootReason;
  readonly openApps: readonly AiComputerAppInstance[];
  readonly activeAppId: string | null;
  readonly resolvedSystemImageId?: string | null;
  readonly effectiveRuntimeMode?: AiComputerSystemRuntimeMode | null;
  readonly effectiveShellMode?: AiComputerSystemShellMode | null;
  readonly systemContextState?: AiComputerSystemContextState;
  readonly updatedAt: string;
};

export type AiComputerHostPlatform = "linux" | "macos" | "windows";

export type AiComputerHostStatus = {
  readonly platform: AiComputerHostPlatform;
  readonly platformLabel: string;
  readonly hostname: string;
  readonly release: string;
  readonly osFlavor: FileManagerDiskOsFlavor;
};

export type AiComputerReadSessionRequest = {
  readonly sessionId: string;
};

export type AiComputerPowerRequest = {
  readonly sessionId: string;
  readonly reason: AiComputerBootReason;
};

export type AiComputerPowerOffRequest = {
  readonly sessionId: string;
};

export type AiComputerOpenAppRequest = {
  readonly sessionId: string;
  readonly kind: Exclude<AiComputerAppKind, "desktop">;
  readonly title?: string;
  readonly appInstanceId?: string;
  readonly filePath?: string;
  readonly directoryPath?: string;
  readonly address?: string;
};

export type AiComputerFocusAppRequest = {
  readonly sessionId: string;
  readonly appInstanceId: string;
};

export type AiComputerCloseAppRequest = {
  readonly sessionId: string;
  readonly appInstanceId: string;
};

export type AiComputerWindowActionRequest = {
  readonly sessionId: string;
  readonly appInstanceId: string;
};

export type AiComputerUpdateWindowFrameRequest = {
  readonly sessionId: string;
  readonly appInstanceId: string;
  readonly frame: AiComputerWindowFrame;
};

export type AiComputerSessionEvent = {
  readonly sessionId: string;
  readonly state: AiComputerSessionState;
};
