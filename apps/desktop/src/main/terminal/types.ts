import type {
  TerminalCloseRequest,
  TerminalCreateRequest,
  TerminalDataAckRequest,
  TerminalPermissionEvaluateRequest,
  TerminalPermissionEvaluateResponse,
  TerminalPermissionRespondRequest,
  TerminalPermissionRespondResponse,
  TerminalProcessesReadRequest,
  TerminalProcessesReadResponse,
  TerminalProcessSignalRequest,
  TerminalProcessSignalResponse,
  TerminalReadRequest,
  TerminalReadResponse,
  TerminalReloadPromptRequest,
  TerminalReloadPromptResult,
  TerminalRendererAttachRequest,
  TerminalRendererAttachResponse,
  TerminalRendererDetachRequest,
  TerminalResizeRequest,
  TerminalSessionSnapshot,
  TerminalWriteRequest
} from "../../shared/desktop-bridge";

export type TerminalObservationReadRequest = TerminalReadRequest;
export type TerminalObservationReadResponse = TerminalReadResponse;

export type TerminalRuntimeLoadResult = {
  readonly loadedFrom: string;
};

export type TerminalIpcBridge = {
  readonly dispose: () => void;
  readonly loadResult: TerminalRuntimeLoadResult;
  readonly createSession: (
    request: TerminalCreateRequest
  ) => Promise<TerminalSessionSnapshot>;
  readonly attachRenderer: (
    request: TerminalRendererAttachRequest
  ) => Promise<TerminalRendererAttachResponse>;
  readonly detachRenderer: (request: TerminalRendererDetachRequest) => Promise<void>;
  readonly ackData: (request: TerminalDataAckRequest) => Promise<void>;
  readonly reloadPrompt: (
    request: TerminalReloadPromptRequest
  ) => Promise<TerminalReloadPromptResult>;
  readonly write: (request: TerminalWriteRequest) => Promise<void>;
  readonly readObservation: (
    request: TerminalObservationReadRequest
  ) => Promise<TerminalObservationReadResponse>;
  readonly evaluatePermission: (
    request: TerminalPermissionEvaluateRequest
  ) => Promise<TerminalPermissionEvaluateResponse>;
  readonly respondPermission: (
    request: TerminalPermissionRespondRequest
  ) => Promise<TerminalPermissionRespondResponse>;
  readonly readProcesses: (
    request: TerminalProcessesReadRequest
  ) => Promise<TerminalProcessesReadResponse>;
  readonly signalProcess: (
    request: TerminalProcessSignalRequest
  ) => Promise<TerminalProcessSignalResponse>;
  readonly resize: (request: TerminalResizeRequest) => Promise<void>;
  readonly closeSession: (request: TerminalCloseRequest) => Promise<void>;
};