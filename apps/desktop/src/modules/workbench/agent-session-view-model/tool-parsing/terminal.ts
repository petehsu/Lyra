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
  return {
    type: "terminal",
    action,
    target: normalizeTerminalTarget(raw.target),
    output: stringField(raw, "output") ?? output,
    running: typeof raw.running === "boolean" ? raw.running : false,
    exitCode: typeof raw.exitCode === "number" ? raw.exitCode : null,
    truncated: typeof raw.truncated === "boolean" ? raw.truncated : false,
    ...(cursor === undefined ? {} : { cursor }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(terminalTabId === undefined ? {} : { terminalTabId }),
    ...(paneId === undefined ? {} : { paneId }),
    ...(command === undefined ? {} : { command }),
    ...(wrote === undefined ? {} : { wrote }),
    ...(reason === undefined ? {} : { reason })
  };
};