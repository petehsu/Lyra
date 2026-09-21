import type { AgentToolActivity } from "../../../../shared/agent";
import type { ToolDetails } from "../../ai-panel/lyra-agents/core/types";
import { asRecord, stringField, toolInputRecord } from "./common";

type ParsedTerminalDetails = Extract<ToolDetails, { type: "terminal" }>;

export const normalizeTerminalTarget = (value: unknown): ParsedTerminalDetails["target"] => {
  const record = asRecord(value);
  const type = stringField(record, "type");
  if (type === "private" || type === "ui" || type === "list") {
    return type;
  }
  return "private";
};

export const normalizeTerminalReason = (
  value: string | undefined
): ParsedTerminalDetails["reason"] | undefined => {
  if (value === "output" || value === "exit" || value === "timeout") {
    return value;
  }
  return undefined;
};

export const splitCommandDump = (
  command: string | undefined,
  dump: string
): { readonly command: string | null; readonly output: string | null } => {
  const cmd = command?.trim() ?? "";
  const body = dump.trim();
  if (cmd.length === 0) {
    return { command: null, output: body.length > 0 ? body : null };
  }
  if (body.length === 0 || body === cmd) {
    return { command: cmd, output: null };
  }
  const repeats = body.startsWith(`${cmd}\n`) || body.startsWith(`$ ${cmd}`);
  return repeats
    ? { command: null, output: body }
    : { command: cmd, output: body };
};

export const humanProcessOutput = (
  raw: Record<string, unknown>,
  fallback: string
): string => {
  const hasStdout = typeof raw.stdout === "string";
  const hasStderr = typeof raw.stderr === "string";
  if (!hasStdout && !hasStderr) {
    return fallback;
  }
  const stdout = hasStdout ? raw.stdout as string : "";
  const stderr = hasStderr ? raw.stderr as string : "";
  return [stdout, stderr].filter((part) => part.length > 0).join("\n");
};

export const isDumpArtifactKind = (kind: string | undefined): boolean => {
  const value = (kind ?? "").toLowerCase();
  return value === "stdout" || value === "stderr" || value === "log";
};

export const toTerminalDetails = (
  tool: AgentToolActivity,
  output: string,
  raw: Record<string, unknown>
): ParsedTerminalDetails => {
  const input = toolInputRecord(tool);
  const target = asRecord(raw.target);
  const action = stringField(input, "action") ?? "terminal";
  const cursor = stringField(raw, "cursor");
  const sessionId = stringField(raw, "sessionId");
  const terminalTabId = stringField(raw, "terminalTabId") ?? stringField(target, "terminalTabId");
  const paneId = stringField(raw, "paneId") ?? stringField(target, "paneId");
  const command = stringField(raw, "command") ?? stringField(input, "command");
  const wrote = stringField(raw, "wrote");
  const reason = normalizeTerminalReason(stringField(raw, "reason"));
  const screen = typeof raw.screen === "object" && raw.screen !== null && !Array.isArray(raw.screen)
    ? raw.screen as Readonly<Record<string, unknown>>
    : undefined;
  const visibleText = screen === undefined ? undefined : stringField(screen, "visibleText");
  const dump = stringField(raw, "output")
    ?? (visibleText !== undefined && visibleText.length > 0 ? visibleText : undefined)
    ?? output;
  const memory = typeof raw.memory === "object" && raw.memory !== null && !Array.isArray(raw.memory)
    ? raw.memory as Readonly<Record<string, unknown>>
    : undefined;
  const readHint = typeof raw.readHint === "object"
    && raw.readHint !== null
    && !Array.isArray(raw.readHint)
    ? raw.readHint as Readonly<Record<string, unknown>>
    : undefined;
  return {
    type: "terminal",
    action,
    target: normalizeTerminalTarget(raw.target),
    output: dump,
    running: typeof raw.running === "boolean" ? raw.running : false,
    exitCode: typeof raw.exitCode === "number" ? raw.exitCode : null,
    truncated: typeof raw.truncated === "boolean" ? raw.truncated : false,
    ...(cursor === undefined ? {} : { cursor }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(terminalTabId === undefined ? {} : { terminalTabId }),
    ...(paneId === undefined ? {} : { paneId }),
    ...(command === undefined ? {} : { command }),
    ...(wrote === undefined ? {} : { wrote }),
    ...(reason === undefined ? {} : { reason }),
    ...(screen === undefined ? {} : { screen }),
    ...(memory === undefined ? {} : { memory }),
    ...(readHint === undefined ? {} : { readHint })
  };
};
