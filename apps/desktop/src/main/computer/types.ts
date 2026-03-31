import type {
  AiComputerCloseAppRequest,
  AiComputerFocusAppRequest,
  AiComputerOpenAppRequest,
  AiComputerPowerRequest,
  AiComputerPowerState,
  AiComputerReadSessionRequest,
  AiComputerSessionState,
  AiComputerUpdateWindowFrameRequest,
  AiComputerWindowActionRequest
} from "../../shared/computer";

type StorageRootRequest = {
  readonly storageRoot: string;
};

export type NativeComputerReadSessionRequest = AiComputerReadSessionRequest & StorageRootRequest;
export type NativeComputerPowerRequest = AiComputerPowerRequest & StorageRootRequest;
export type NativeComputerPowerOffRequest = {
  readonly sessionId: string;
  readonly storageRoot: string;
};
export type NativeComputerFinishPowerTransitionRequest = {
  readonly sessionId: string;
  readonly storageRoot: string;
  readonly targetState: Extract<AiComputerPowerState, "on" | "off">;
};
export type NativeComputerOpenAppRequest = AiComputerOpenAppRequest & StorageRootRequest;
export type NativeComputerFocusAppRequest = AiComputerFocusAppRequest & StorageRootRequest;
export type NativeComputerCloseAppRequest = AiComputerCloseAppRequest & StorageRootRequest;
export type NativeComputerWindowActionRequest = AiComputerWindowActionRequest & StorageRootRequest;
export type NativeComputerUpdateWindowFrameRequest = AiComputerUpdateWindowFrameRequest & StorageRootRequest;

export type ComputerNativeBindings = {
  readonly readSession: (request: NativeComputerReadSessionRequest) => AiComputerSessionState;
  readonly powerOnSession: (request: NativeComputerPowerRequest) => AiComputerSessionState;
  readonly powerOffSession: (request: NativeComputerPowerOffRequest) => AiComputerSessionState;
  readonly finishPowerTransition: (
    request: NativeComputerFinishPowerTransitionRequest
  ) => AiComputerSessionState;
  readonly openApp: (request: NativeComputerOpenAppRequest) => AiComputerSessionState;
  readonly focusApp: (request: NativeComputerFocusAppRequest) => AiComputerSessionState;
  readonly closeApp: (request: NativeComputerCloseAppRequest) => AiComputerSessionState;
  readonly moveAppWindow: (request: NativeComputerUpdateWindowFrameRequest) => AiComputerSessionState;
  readonly resizeAppWindow: (request: NativeComputerUpdateWindowFrameRequest) => AiComputerSessionState;
  readonly minimizeApp: (request: NativeComputerWindowActionRequest) => AiComputerSessionState;
  readonly maximizeApp: (request: NativeComputerWindowActionRequest) => AiComputerSessionState;
  readonly restoreApp: (request: NativeComputerWindowActionRequest) => AiComputerSessionState;
};

export type ComputerNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: ComputerNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };
