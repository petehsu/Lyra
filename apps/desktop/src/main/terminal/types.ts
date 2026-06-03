import type {
  TerminalActExecuteRequest,
  TerminalActExecuteResponse,
  TerminalAttachmentAttachRequest,
  TerminalAttachmentAttachResponse,
  TerminalAttachmentDetachRequest,
  TerminalAttachmentDetachResponse,
  TerminalAttachmentListRequest,
  TerminalAttachmentListResponse,
  TerminalAttachmentPauseRequest,
  TerminalAttachmentPauseResponse,
  TerminalAttachmentResumeRequest,
  TerminalAttachmentResumeResponse,
  TerminalArtifactsListRequest,
  TerminalArtifactsListResponse,
  TerminalCloseRequest,
  TerminalCommandOutputReadRequest,
  TerminalCommandOutputReadResponse,
  TerminalCommandStatusRequest,
  TerminalCommandStatusResponse,
  TerminalCommandWaitRequest,
  TerminalCommandWaitResponse,
  TerminalCommandsReadRequest,
  TerminalCommandsReadResponse,
  TerminalCreateRequest,
  TerminalDataAckRequest,
  TerminalEventsReadRequest,
  TerminalEventsReadResponse,
  TerminalInputExecuteRequest,
  TerminalInputExecuteResponse,
  TerminalMapReadRequest,
  TerminalMapReadResponse,
  TerminalMemoryTimelineReadRequest,
  TerminalMemoryTimelineReadResponse,
  TerminalOutputRangeReadRequest,
  TerminalOutputRangeReadResponse,
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
  TerminalScreenReadRequest,
  TerminalScreenReadResponse,
  TerminalRestoreRequest,
  TerminalSessionSnapshot,
  TerminalWaitUntilRequest,
  TerminalWaitUntilResponse,
  TerminalWriteRequest
} from "../../shared/desktop-bridge";

export type TerminalObservationReadRequest = TerminalReadRequest;
export type TerminalObservationReadResponse = TerminalReadResponse;
export type TerminalScreenObservationReadRequest = TerminalScreenReadRequest;
export type TerminalScreenObservationReadResponse = TerminalScreenReadResponse;
export type TerminalEventsObservationReadRequest = TerminalEventsReadRequest;
export type TerminalEventsObservationReadResponse = TerminalEventsReadResponse;
export type TerminalCommandsObservationReadRequest = TerminalCommandsReadRequest;
export type TerminalCommandsObservationReadResponse = TerminalCommandsReadResponse;
export type TerminalOutputRangeObservationReadRequest = TerminalOutputRangeReadRequest;
export type TerminalOutputRangeObservationReadResponse = TerminalOutputRangeReadResponse;
export type TerminalArtifactsObservationListRequest = TerminalArtifactsListRequest;
export type TerminalArtifactsObservationListResponse = TerminalArtifactsListResponse;
export type TerminalMemoryTimelineObservationReadRequest = TerminalMemoryTimelineReadRequest;
export type TerminalMemoryTimelineObservationReadResponse = TerminalMemoryTimelineReadResponse;

export type TerminalRuntimeLoadResult = {
  readonly loadedFrom: string;
};

export type TerminalIpcBridge = {
  readonly dispose: () => void;
  readonly loadResult: TerminalRuntimeLoadResult;
  readonly createSession: (
    request: TerminalCreateRequest
  ) => Promise<TerminalSessionSnapshot>;
  readonly restoreSessions: (
    request: TerminalRestoreRequest
  ) => Promise<readonly TerminalSessionSnapshot[]>;
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
  readonly readScreen: (
    request: TerminalScreenObservationReadRequest
  ) => Promise<TerminalScreenObservationReadResponse>;
  readonly readEvents: (
    request: TerminalEventsObservationReadRequest
  ) => Promise<TerminalEventsObservationReadResponse>;
  readonly readCommands: (
    request: TerminalCommandsObservationReadRequest
  ) => Promise<TerminalCommandsObservationReadResponse>;
  readonly readOutputRange: (
    request: TerminalOutputRangeObservationReadRequest
  ) => Promise<TerminalOutputRangeObservationReadResponse>;
  readonly listArtifacts: (
    request: TerminalArtifactsObservationListRequest
  ) => Promise<TerminalArtifactsObservationListResponse>;
  readonly readMemoryTimeline: (
    request: TerminalMemoryTimelineObservationReadRequest
  ) => Promise<TerminalMemoryTimelineObservationReadResponse>;
  readonly waitUntil: (request: TerminalWaitUntilRequest) => Promise<TerminalWaitUntilResponse>;
  readonly executeInput: (
    request: TerminalInputExecuteRequest
  ) => Promise<TerminalInputExecuteResponse>;
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
  readonly readCommandStatus: (
    request: TerminalCommandStatusRequest
  ) => Promise<TerminalCommandStatusResponse>;
  readonly waitCommand: (
    request: TerminalCommandWaitRequest
  ) => Promise<TerminalCommandWaitResponse>;
  readonly readCommandOutput: (
    request: TerminalCommandOutputReadRequest
  ) => Promise<TerminalCommandOutputReadResponse>;
  readonly readMap: (request: TerminalMapReadRequest) => Promise<TerminalMapReadResponse>;
  readonly executeAct: (
    request: TerminalActExecuteRequest
  ) => Promise<TerminalActExecuteResponse>;
  readonly attachAgent: (
    request: TerminalAttachmentAttachRequest
  ) => Promise<TerminalAttachmentAttachResponse>;
  readonly detachAgent: (
    request: TerminalAttachmentDetachRequest
  ) => Promise<TerminalAttachmentDetachResponse>;
  readonly listAttachments: (
    request: TerminalAttachmentListRequest
  ) => Promise<TerminalAttachmentListResponse>;
  readonly pauseAttachment: (
    request: TerminalAttachmentPauseRequest
  ) => Promise<TerminalAttachmentPauseResponse>;
  readonly resumeAttachment: (
    request: TerminalAttachmentResumeRequest
  ) => Promise<TerminalAttachmentResumeResponse>;
  readonly resize: (request: TerminalResizeRequest) => Promise<void>;
  readonly closeSession: (request: TerminalCloseRequest) => Promise<void>;
};
