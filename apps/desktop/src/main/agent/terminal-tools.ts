export type TerminalAgentToolRoute = {
  readonly method: string;
  readonly displayName: "terminal";
  readonly action: string;
  readonly readOnly: boolean;
};

export type TerminalAgentToolMapping = TerminalAgentToolRoute & {
  readonly payload: Record<string, unknown>;
};

export const TERMINAL_AGENT_TOOL_ROUTES = {
  terminal_list: { method: "terminal.list", displayName: "terminal", action: "list", readOnly: true },
  terminal_create: { method: "terminal.create", displayName: "terminal", action: "create", readOnly: true },
  terminal_read: { method: "terminal.read", displayName: "terminal", action: "read", readOnly: true },
  terminal_screen: { method: "terminal.screen", displayName: "terminal", action: "screen", readOnly: true },
  terminal_wait: { method: "terminal.wait", displayName: "terminal", action: "wait", readOnly: true },
  terminal_write: { method: "terminal.write", displayName: "terminal", action: "write", readOnly: false },
  terminal_close: { method: "terminal.close", displayName: "terminal", action: "close", readOnly: false },
  terminal_events: { method: "terminal.events.read", displayName: "terminal", action: "events", readOnly: true },
  terminal_read_until: { method: "terminal.waitUntil", displayName: "terminal", action: "read_until", readOnly: true },
  terminal_run: { method: "terminal.input.execute", displayName: "terminal", action: "run", readOnly: false },
  terminal_input: { method: "terminal.input.execute", displayName: "terminal", action: "input", readOnly: false },
  terminal_keys: { method: "terminal.input.execute", displayName: "terminal", action: "keys", readOnly: false },
  terminal_resize: { method: "terminal.resize", displayName: "terminal", action: "resize", readOnly: false },
  terminal_signal: { method: "terminal.processes.signal", displayName: "terminal", action: "signal", readOnly: false },
  terminal_processes: { method: "terminal.processes.read", displayName: "terminal", action: "processes", readOnly: true },
  terminal_command_status: { method: "terminal.command.status", displayName: "terminal", action: "command_status", readOnly: true },
  terminal_map: { method: "terminal.map.read", displayName: "terminal", action: "map", readOnly: true },
  terminal_act: { method: "terminal.act.execute", displayName: "terminal", action: "act", readOnly: false },
  terminal_attach_agent: { method: "terminal.attachments.attach", displayName: "terminal", action: "attach_agent", readOnly: false },
  terminal_detach_agent: { method: "terminal.attachments.detach", displayName: "terminal", action: "detach_agent", readOnly: false }
} as const satisfies Record<string, TerminalAgentToolRoute>;

export type TerminalAgentToolName = keyof typeof TERMINAL_AGENT_TOOL_ROUTES;
export type TerminalAgentToolAction =
  (typeof TERMINAL_AGENT_TOOL_ROUTES)[TerminalAgentToolName]["action"];

export const TERMINAL_AGENT_TOOL_NAMES = Object.keys(
  TERMINAL_AGENT_TOOL_ROUTES
) as TerminalAgentToolName[];

export const TERMINAL_PERMISSION_FREE_ACTIONS = TERMINAL_AGENT_TOOL_NAMES
  .map((name) => TERMINAL_AGENT_TOOL_ROUTES[name])
  .filter((route) => route.readOnly)
  .map((route) => route.action);

export const TERMINAL_POLICY_ACTIONS = TERMINAL_AGENT_TOOL_NAMES
  .map((name) => TERMINAL_AGENT_TOOL_ROUTES[name])
  .filter((route) => !route.readOnly)
  .map((route) => route.action);

export const TERMINAL_AGENT_TOOL_NAME_BY_ACTION = Object.fromEntries(
  TERMINAL_AGENT_TOOL_NAMES.map((name) => [
    TERMINAL_AGENT_TOOL_ROUTES[name].action,
    name
  ])
) as Record<TerminalAgentToolAction, TerminalAgentToolName>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const isTerminalAgentToolName = (name: string): name is TerminalAgentToolName =>
  Object.prototype.hasOwnProperty.call(TERMINAL_AGENT_TOOL_ROUTES, name);

export const terminalAgentToolRoute = (
  name: string
): TerminalAgentToolRoute | undefined =>
  isTerminalAgentToolName(name) ? TERMINAL_AGENT_TOOL_ROUTES[name] : undefined;

export const mapTerminalAgentTool = (
  name: string,
  input: unknown
): TerminalAgentToolMapping | null => {
  const route = terminalAgentToolRoute(name);
  if (route === undefined) {
    return null;
  }
  const payload = isRecord(input) ? { ...input } : {};
  payload.action = route.action;
  return {
    ...route,
    payload
  };
};

export const terminalAgentToolNameForAction = (
  action: string
): TerminalAgentToolName | undefined =>
  (TERMINAL_AGENT_TOOL_NAME_BY_ACTION as Record<string, TerminalAgentToolName | undefined>)[
    action
  ];

export const terminalPermissionRisk = (
  action: string,
  input: unknown
): "none" | "shell" | "dangerous" => {
  const payload = isRecord(input) ? input : {};
  if (
    action === "create"
    && typeof payload.command === "string"
    && payload.command.trim().length > 0
  ) {
    return "shell";
  }
  if ((TERMINAL_PERMISSION_FREE_ACTIONS as readonly string[]).includes(action)) {
    return "none";
  }
  if (action === "run" || action === "write" || action === "close") {
    return "shell";
  }
  return "dangerous";
};

export type TerminalSemanticInputAction =
  | "runCommand"
  | "submitInput"
  | "pasteText"
  | "pressKeys"
  | "resize";

export const terminalSemanticInputActionForToolAction = (
  action: string,
  input: unknown
): TerminalSemanticInputAction => {
  const payload = isRecord(input) ? input : {};
  if (action === "run") return "runCommand";
  if (action === "keys") return "pressKeys";
  if (action === "resize") return "resize";
  return payload.bracketedPaste === true ? "pasteText" : "submitInput";
};

export type TerminalWaitTarget = "output" | "screen" | "prompt" | "command" | "event";

export const terminalWaitTargetFromPayload = (input: unknown): TerminalWaitTarget => {
  const payload = isRecord(input) ? input : {};
  const value = payload.until ?? payload.waitFor ?? payload.waitTarget;
  return value === "screen"
    || value === "prompt"
    || value === "command"
    || value === "event"
    || value === "output"
    ? value
    : "output";
};
