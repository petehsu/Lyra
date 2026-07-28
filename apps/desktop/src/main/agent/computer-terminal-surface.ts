import {
  encodeLyraTerminalOsRef,
  LYRA_TERMINAL_SURFACE,
  parseLyraTerminalOsRef
} from "./computer-internal-surface";
import type { AgentHostCapabilityHandlers } from "./host-payload";
import { isRecord } from "./host-payload";

const TERMINAL_BUFFER_REGION_ID = "output-buffer";
const TERMINAL_COMPATIBILITY_TAIL_BYTES = 16_000;

export const isTerminalOutputBufferOsRef = (osRef: string): boolean =>
  parseLyraTerminalOsRef(osRef)?.regionId === TERMINAL_BUFFER_REGION_ID;

const platformLabel = (): string => {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "win32") return "win32";
  if (process.platform === "linux") return "linux";
  return "unsupported";
};

const invokeTerminalHandler = async (
  handlers: AgentHostCapabilityHandlers,
  method: "terminal.read" | "terminal.write",
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const handler = handlers[method];
  if (handler === undefined) {
    return {
      ok: false,
      present: false,
      error: {
        kind: "internalSurfaceUnavailable",
        message: `Terminal compatibility routing requires ${method}.`
      },
      nextRecommendedAction: "computer.map"
    };
  }
  try {
    const result = await handler(payload);
    return isRecord(result)
      ? result
      : {
          ok: false,
          present: false,
          error: {
            kind: "internalSurfaceUnavailable",
            message: `${method} returned an invalid result.`
          },
          nextRecommendedAction: "computer.map"
        };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stale =
      /session not found|terminal pane was not found|no ui terminal pane/i.test(message);
    return {
      ok: false,
      present: false,
      error: {
        kind: stale ? "staleOsRef" : "internalSurfaceUnavailable",
        message: stale
          ? "The terminal session no longer exists; run computer.map to resolve the current terminal."
          : `${method} failed while validating the terminal session: ${message}`
      },
      nextRecommendedAction: "computer.map"
    };
  }
};

const staleTerminalOsRef = (
  osRef: string,
  message =
    "This terminal osRef belongs to the removed semantic-screen mapper; run computer.map for the current output-buffer node."
): Record<string, unknown> => ({
  ok: false,
  platform: platformLabel(),
  surface: LYRA_TERMINAL_SURFACE,
  capabilityLevel: 1,
  present: false,
  osRef,
  error: {
    kind: "staleOsRef",
    message
  },
  nextRecommendedAction: "computer.map"
});

const terminalBufferNode = (
  sessionId: string,
  output: string,
  running: boolean,
  title?: string
): Record<string, unknown> => ({
  osRef: encodeLyraTerminalOsRef(sessionId, TERMINAL_BUFFER_REGION_ID),
  platform: platformLabel(),
  app: LYRA_TERMINAL_SURFACE,
  window: sessionId,
  role: "terminal",
  name: title ?? "Terminal output",
  value: output,
  actions: running ? ["typeText", "pressKey"] : [],
  source: "internal-ipc",
  secure: false,
  osPath: TERMINAL_BUFFER_REGION_ID
});

export const adaptTerminalReadToComputerMap = (
  tabId: string,
  result: {
    readonly sessionId: string;
    readonly output: string;
    readonly cursor?: string;
    readonly running?: boolean;
    readonly exitCode?: number | null;
    readonly truncated?: boolean;
    readonly title?: string;
  }
): Record<string, unknown> => {
  const running = result.running === true;
  return {
    ok: true,
    platform: platformLabel(),
    surface: LYRA_TERMINAL_SURFACE,
    capabilityLevel: 1,
    tabId,
    status: {
      ok: true,
      state: running ? "available" : "stopped",
      message:
        "Lyra terminal output was read through the terminal.read compatibility route; semantic screen regions are unavailable.",
      nodeCount: 1,
      sessionId: result.sessionId,
      running,
      exitCode: result.exitCode ?? null,
      truncated: result.truncated === true
    },
    nodes: [terminalBufferNode(result.sessionId, result.output, running, result.title)]
  };
};

export const mapTerminalSurface = async ({
  handlers,
  input,
  tabId
}: {
  readonly handlers: AgentHostCapabilityHandlers;
  readonly input: Record<string, unknown>;
  readonly tabId: string;
}): Promise<Record<string, unknown>> => {
  const raw = await invokeTerminalHandler(handlers, "terminal.read", {
    ...input,
    sessionId: undefined,
    target: "ui",
    terminalTabId: tabId,
    cursor: undefined,
    tailBytes: TERMINAL_COMPATIBILITY_TAIL_BYTES,
    maxBytes: TERMINAL_COMPATIBILITY_TAIL_BYTES
  });
  if (raw.ok === false) {
    return raw;
  }
  if (typeof raw.sessionId !== "string" || typeof raw.output !== "string") {
    return {
      ok: false,
      present: false,
      error: {
        kind: "internalSurfaceUnavailable",
        message: "terminal.read returned an invalid compatibility result."
      },
      nextRecommendedAction: "computer.map"
    };
  }
  const target = isRecord(raw.target) ? raw.target : undefined;
  return adaptTerminalReadToComputerMap(tabId, {
    sessionId: raw.sessionId,
    output: raw.output,
    ...(typeof raw.cursor === "string" ? { cursor: raw.cursor } : {}),
    ...(typeof raw.running === "boolean" ? { running: raw.running } : {}),
    ...(typeof raw.exitCode === "number" || raw.exitCode === null
      ? { exitCode: raw.exitCode }
      : {}),
    ...(typeof raw.truncated === "boolean" ? { truncated: raw.truncated } : {}),
    ...(typeof target?.title === "string" ? { title: target.title } : {})
  });
};

const unsupportedTerminalAction = (
  osRef: string,
  action: string,
  message?: string
): Record<string, unknown> => ({
  ok: false,
  platform: platformLabel(),
  surface: LYRA_TERMINAL_SURFACE,
  capabilityLevel: 1,
  osRef,
  action,
  error: {
    kind: "unsupportedOnInternalSurface",
    message:
      message
      ?? `Action "${action}" is unavailable for the terminal output-buffer compatibility node.`
  },
  nextRecommendedAction: "write_stdin"
});

export const actOnTerminalSurface = async ({
  handlers,
  input,
  osRef,
  action
}: {
  readonly handlers: AgentHostCapabilityHandlers;
  readonly input: Record<string, unknown>;
  readonly osRef: string;
  readonly action: string;
}): Promise<Record<string, unknown>> => {
  const parsed = parseLyraTerminalOsRef(osRef);
  if (parsed === null) {
    return {
      ok: false,
      error: { kind: "invalidArgument", message: "Malformed Lyra terminal osRef." }
    };
  }
  if (parsed.regionId !== TERMINAL_BUFFER_REGION_ID) {
    return staleTerminalOsRef(osRef);
  }
  if (action !== "typeText" && action !== "pressKey") {
    return unsupportedTerminalAction(osRef, action);
  }
  const value = action === "typeText" ? input.text : input.key;
  if (typeof value !== "string" || value.length === 0) {
    return {
      ok: false,
      error: {
        kind: "invalidArgument",
        message: `${action} on a Lyra terminal requires a non-empty ${
          action === "typeText" ? "text" : "key"
        } value.`
      }
    };
  }
  const raw = await invokeTerminalHandler(handlers, "terminal.write", {
    ...input,
    target: "ui",
    sessionId: parsed.sessionId,
    ...(action === "typeText"
      ? { text: value, appendNewline: false, keys: undefined }
      : { keys: [value], text: undefined, data: undefined, appendNewline: false })
  });
  if (raw.ok === false) {
    return {
      ...raw,
      osRef,
      action
    };
  }
  return {
    ok: true,
    platform: platformLabel(),
    surface: LYRA_TERMINAL_SURFACE,
    capabilityLevel: 1,
    osRef,
    action,
    sessionId: parsed.sessionId,
    changed: ["terminal-output"],
    ...(typeof raw.cursor === "string" ? { afterObservationId: raw.cursor } : {}),
    ...(typeof raw.running === "boolean" ? { running: raw.running } : {}),
    ...(typeof raw.exitCode === "number" || raw.exitCode === null
      ? { exitCode: raw.exitCode }
      : {})
  };
};

export const readTerminalSurfaceNode = async ({
  handlers,
  input,
  osRef
}: {
  readonly handlers: AgentHostCapabilityHandlers;
  readonly input: Record<string, unknown>;
  readonly osRef: string;
}): Promise<Record<string, unknown>> => {
  const parsed = parseLyraTerminalOsRef(osRef);
  if (parsed === null) {
    return {
      ok: false,
      error: { kind: "invalidArgument", message: "Malformed Lyra terminal osRef." }
    };
  }
  if (parsed.regionId !== TERMINAL_BUFFER_REGION_ID) {
    return staleTerminalOsRef(osRef);
  }
  const raw = await invokeTerminalHandler(handlers, "terminal.read", {
    ...input,
    target: "ui",
    sessionId: parsed.sessionId,
    cursor: undefined,
    tailBytes: TERMINAL_COMPATIBILITY_TAIL_BYTES,
    maxBytes: TERMINAL_COMPATIBILITY_TAIL_BYTES
  });
  if (raw.ok === false) {
    return {
      ...raw,
      osRef
    };
  }
  if (typeof raw.output !== "string") {
    return {
      ok: false,
      present: false,
      osRef,
      error: {
        kind: "internalSurfaceUnavailable",
        message: "terminal.read returned an invalid compatibility result."
      },
      nextRecommendedAction: "computer.map"
    };
  }
  const target = isRecord(raw.target) ? raw.target : undefined;
  return {
    ok: true,
    platform: platformLabel(),
    surface: LYRA_TERMINAL_SURFACE,
    capabilityLevel: 1,
    present: true,
    osRef,
    node: terminalBufferNode(
      parsed.sessionId,
      raw.output,
      raw.running === true,
      typeof target?.title === "string" ? target.title : undefined
    )
  };
};

export const validateTerminalSurfaceNode = async ({
  handlers,
  osRef
}: {
  readonly handlers: AgentHostCapabilityHandlers;
  readonly osRef: string;
}): Promise<Record<string, unknown>> => {
  const parsed = parseLyraTerminalOsRef(osRef);
  if (parsed === null) {
    return {
      ok: false,
      present: false,
      error: { kind: "invalidArgument", message: "Malformed Lyra terminal osRef." }
    };
  }
  if (parsed.regionId !== TERMINAL_BUFFER_REGION_ID) {
    return staleTerminalOsRef(osRef);
  }
  const raw = await invokeTerminalHandler(handlers, "terminal.read", {
    target: "ui",
    sessionId: parsed.sessionId,
    cursor: String(Number.MAX_SAFE_INTEGER),
    maxBytes: 1
  });
  if (raw.ok === false) {
    return { ...raw, osRef };
  }
  if (raw.sessionId !== parsed.sessionId || typeof raw.output !== "string") {
    return {
      ok: false,
      present: false,
      osRef,
      error: {
        kind: "internalSurfaceUnavailable",
        message: "terminal.read could not verify the referenced terminal session."
      },
      nextRecommendedAction: "computer.map"
    };
  }
  return {
    ok: true,
    present: true,
    osRef,
    sessionId: parsed.sessionId
  };
};
