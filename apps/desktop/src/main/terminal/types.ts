import type {
  TerminalCloseRequest,
  TerminalCreateRequest,
  TerminalReadRequest,
  TerminalReadResponse,
  TerminalResizeRequest,
  TerminalRestoreRequest,
  TerminalSessionSnapshot,
  TerminalWriteRequest
} from "../../shared/desktop-bridge";

export type TerminalExecRequest = {
  readonly command: string;
  readonly cwd?: string;
  readonly timeoutMs: number;
};

export type TerminalCapabilitySessionStartRequest = {
  readonly title?: string;
  readonly cwd?: string;
  readonly cols?: number;
  readonly rows?: number;
  readonly shell?: string;
  readonly mode?: "command" | "shell";
  readonly command?: string;
  readonly persist?: boolean;
};

export type TerminalCapabilitySessionWriteRequest = {
  readonly sessionId: string;
  readonly data?: string;
  readonly text?: string;
  readonly keys?: readonly (
    | "enter"
    | "escape"
    | "tab"
    | "ctrl_c"
    | "ctrl_d"
    | "up"
    | "down"
    | "left"
    | "right"
    | "page_up"
    | "page_down"
    | "home"
    | "end"
  )[];
  readonly appendNewline?: boolean;
};

export type TerminalCapabilitySessionCloseRequest = {
  readonly sessionId: string;
};

export type TerminalCapabilitySessionReadRequest = TerminalReadRequest;

export type TerminalExecResult = {
  readonly sessionId: string;
  readonly command: string;
  readonly exitCode: number;
  readonly output: string;
  readonly timedOut: boolean;
};

export type TerminalRuntimeLoadResult = {
  readonly loadedFrom: string;
};

export type TerminalIpcBridge = {
  readonly dispose: () => void;
  readonly loadResult: TerminalRuntimeLoadResult;
  readonly executeCommand: (request: TerminalExecRequest) => Promise<TerminalExecResult>;
  readonly startCapabilitySession: (
    request: TerminalCapabilitySessionStartRequest
  ) => Promise<TerminalSessionSnapshot>;
  readonly readCapabilitySession: (
    request: TerminalCapabilitySessionReadRequest
  ) => Promise<TerminalReadResponse>;
  readonly writeCapabilitySession: (
    request: TerminalCapabilitySessionWriteRequest
  ) => Promise<void>;
  readonly closeCapabilitySession: (
    request: TerminalCapabilitySessionCloseRequest
  ) => Promise<void>;
};
