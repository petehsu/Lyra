import type {
  TerminalReadRequest,
  TerminalReadResponse
} from "../../shared/desktop-bridge";

export type TerminalObservationReadRequest = TerminalReadRequest;
export type TerminalObservationReadResponse = TerminalReadResponse;

export type TerminalRuntimeLoadResult = {
  readonly loadedFrom: string;
};

export type TerminalIpcBridge = {
  readonly dispose: () => void;
  readonly loadResult: TerminalRuntimeLoadResult;
  readonly readObservation: (
    request: TerminalObservationReadRequest
  ) => Promise<TerminalObservationReadResponse>;
};
