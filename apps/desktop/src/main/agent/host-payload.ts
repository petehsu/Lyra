import type { RuntimeRequestHandler } from "../runtime-client";

export type AgentHostCapabilityHandlers = Record<string, RuntimeRequestHandler>;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const normalizePayload = (payload: unknown): Record<string, unknown> =>
  isRecord(payload) ? payload : {};

export const readNumberField = (payload: Record<string, unknown>, fieldName: string): number => {
  const value = payload[fieldName];
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  if (Number.isFinite(numberValue) === false) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  return Math.round(numberValue);
};

export const readOptionalNumberField = (
  payload: Record<string, unknown>,
  fieldName: string
): number | undefined => {
  if (payload[fieldName] === undefined) {
    return undefined;
  }
  return readNumberField(payload, fieldName);
};

export const readStringField = (payload: Record<string, unknown>, fieldName: string): string => {
  const value = payload[fieldName];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
};

export const readOptionalStringField = (
  payload: Record<string, unknown>,
  fieldName: string
): string | undefined => {
  if (payload[fieldName] === undefined) {
    return undefined;
  }
  return readStringField(payload, fieldName);
};

export const readOptionalStringArrayField = (
  payload: Record<string, unknown>,
  fieldName: string
): readonly string[] | undefined => {
  const value = payload[fieldName];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings`);
  }
  const items = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  if (items.length === 0) {
    throw new Error(`${fieldName} must include at least one string`);
  }
  return items;
};

export const readOptionalBooleanField = (
  payload: Record<string, unknown>,
  fieldName: string
): boolean | undefined => {
  if (payload[fieldName] === undefined) {
    return undefined;
  }
  const value = payload[fieldName];
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean`);
  }
  return value;
};

export const readRuntimeTurnId = (payload: Record<string, unknown>): string | undefined => {
  const directTurnId = payload.runtimeTurnId ?? payload.turnId;
  if (typeof directTurnId === "string" && directTurnId.trim().length > 0) {
    return directTurnId.trim();
  }
  const runtimeCancellation = payload.runtimeCancellation;
  if (runtimeCancellation === null || typeof runtimeCancellation !== "object") {
    return undefined;
  }
  const turnId = (runtimeCancellation as Record<string, unknown>).turnId;
  return typeof turnId === "string" && turnId.trim().length > 0
    ? turnId.trim()
    : undefined;
};

export const readRuntimeToolCallId = (payload: Record<string, unknown>): string | undefined => {
  const directToolCallId = payload.toolCallId ?? payload.tool_call_id;
  if (typeof directToolCallId === "string" && directToolCallId.trim().length > 0) {
    return directToolCallId.trim();
  }
  const runtimeCancellation = payload.runtimeCancellation;
  if (runtimeCancellation === null || typeof runtimeCancellation !== "object") {
    return undefined;
  }
  const toolCallId = (runtimeCancellation as Record<string, unknown>).toolCallId
    ?? (runtimeCancellation as Record<string, unknown>).tool_call_id;
  return typeof toolCallId === "string" && toolCallId.trim().length > 0
    ? toolCallId.trim()
    : undefined;
};

export const readRuntimeSessionId = (payload: Record<string, unknown>): string => {
  const runtimeCancellation = payload.runtimeCancellation;
  if (runtimeCancellation !== null && typeof runtimeCancellation === "object") {
    const sessionId = (runtimeCancellation as Record<string, unknown>).sessionId;
    if (typeof sessionId === "string" && sessionId.trim().length > 0) {
      return sessionId.trim();
    }
  }
  const directSessionId = payload.agentSessionId ?? payload.lyraAgentSessionId;
  if (typeof directSessionId === "string" && directSessionId.trim().length > 0) {
    return directSessionId.trim();
  }
  return "agent-session-default";
};

export const readClampedOptionalNumber = (
  payload: Record<string, unknown>,
  fieldName: string,
  fallback: number,
  min: number,
  max: number
): number => {
  const value = readOptionalNumberField(payload, fieldName) ?? fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
};

export const runHostCapabilityWithTimeout = async <T>(
  label: string,
  timeoutMs: number,
  execute: () => Promise<T>
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([execute(), timeout]);
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
};
