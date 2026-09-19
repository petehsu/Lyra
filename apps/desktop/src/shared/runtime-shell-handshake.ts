import { HOST_API_VERSION } from "@lyra/app-runtime";

export const RUNTIME_PROTOCOL_MIN_VERSION = 2;
export const RUNTIME_PROTOCOL_MAX_VERSION = 2;
export const RUNTIME_HOST_API_VERSION = HOST_API_VERSION;
export const RUNTIME_HANDSHAKE_METHOD = "runtime.handshake";
export const RUNTIME_SHELL_CONNECTION_ROLE = "primaryHost";
export const RUNTIME_AUXILIARY_CONNECTION_ROLE = "auxiliaryClient";
export const RUNTIME_SHELL_CAPABILITY_HOST_REQUESTS = "runtime.host.requests";
export const RUNTIME_SHELL_DATA_SCHEMA_NAME = "lyra.desktop";
export const RUNTIME_SHELL_DATA_SCHEMA_VERSION = 1;
export const RUNTIME_DATA_SCHEMA_NAME = "lyra.runtime";
export const RUNTIME_DATA_SCHEMA_VERSION = 1;
export const RUNTIME_SHELL_CAPABILITIES = [RUNTIME_SHELL_CAPABILITY_HOST_REQUESTS] as const;
export const RUNTIME_SHELL_DATA_SCHEMAS = {
  [RUNTIME_SHELL_DATA_SCHEMA_NAME]: RUNTIME_SHELL_DATA_SCHEMA_VERSION
} as const;
export const RUNTIME_REQUIRED_DATA_SCHEMAS = {
  [RUNTIME_DATA_SCHEMA_NAME]: RUNTIME_DATA_SCHEMA_VERSION
} as const;
export const RUNTIME_DAEMON_REQUIRED_CAPABILITIES = ["agent.import.v2", "lsp.upsert"] as const;
export const RUNTIME_PRIMARY_HOST_EXISTS_CODE = "RUNTIME_PRIMARY_HOST_EXISTS";
export const RUNTIME_PRIMARY_HOST_HANDOFF = "disconnectThenClaim";
export const RUNTIME_FATAL_HANDSHAKE_ERROR_CODES = [
  "BAD_REQUEST",
  "DATA_SCHEMA_MISMATCH",
  "HOST_API_VERSION_MISMATCH",
  "PROTOCOL_VERSION_MISMATCH",
  "RUNTIME_COMPONENT_VERSION_INVALID",
  "RUNTIME_DUPLICATE_HANDSHAKE",
  "RUNTIME_DUPLICATE_LEASE",
  RUNTIME_PRIMARY_HOST_EXISTS_CODE
] as const;

export type RuntimeConnectionRole =
  | typeof RUNTIME_SHELL_CONNECTION_ROLE
  | typeof RUNTIME_AUXILIARY_CONNECTION_ROLE;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const isRuntimeShellHandshake = (payload: unknown): boolean => {
  if (!isRecord(payload)) {
    return false;
  }
  const capabilities = payload.capabilities;
  const dataSchemas = payload.dataSchemas;
  return payload.protocolMinVersion === RUNTIME_PROTOCOL_MIN_VERSION
    && payload.protocolMaxVersion === RUNTIME_PROTOCOL_MAX_VERSION
    && payload.hostApiVersion === RUNTIME_HOST_API_VERSION
    && payload.connectionRole === RUNTIME_SHELL_CONNECTION_ROLE
    && Array.isArray(capabilities)
    && capabilities.includes(RUNTIME_SHELL_CAPABILITY_HOST_REQUESTS)
    && isRecord(dataSchemas)
    && dataSchemas[RUNTIME_SHELL_DATA_SCHEMA_NAME] === RUNTIME_SHELL_DATA_SCHEMA_VERSION;
};

export const assertRuntimeShellHandshake = (payload: unknown): void => {
  if (!isRuntimeShellHandshake(payload)) {
    throw new Error("runtime handshake is not a frozen primaryHost shell entry");
  }
};
