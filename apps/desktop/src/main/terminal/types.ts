import type {
  TerminalCloseRequest,
  TerminalCreateRequest,
  TerminalReadRequest,
  TerminalReadResponse,
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
  readonly write: (request: TerminalWriteRequest) => Promise<void>;
  readonly readObservation: (
    request: TerminalObservationReadRequest
  ) => Promise<TerminalObservationReadResponse>;
  readonly closeSession: (request: TerminalCloseRequest) => Promise<void>;
};
