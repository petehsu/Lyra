import type {
  TerminalCloseRequest,
  TerminalCreateRequest,
  TerminalEvent,
  TerminalResizeRequest,
  TerminalRestoreRequest,
  TerminalSessionSnapshot,
  TerminalWriteRequest
} from "../../shared/desktop-bridge";

export type TerminalNativeBindings = {
  readonly registerEventCallback: (callback: (...args: unknown[]) => void) => void;
  readonly createSession: (request: TerminalCreateRequest) => TerminalSessionSnapshot;
  readonly restoreSessions: (request: TerminalRestoreRequest) => readonly TerminalSessionSnapshot[];
  readonly writeSession: (request: TerminalWriteRequest) => void;
  readonly resizeSession: (request: TerminalResizeRequest) => void;
  readonly closeSession: (request: TerminalCloseRequest) => void;
  readonly shutdown: () => void;
};

export type TerminalNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: TerminalNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };
