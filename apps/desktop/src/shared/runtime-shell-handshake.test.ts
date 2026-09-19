import { HOST_API_VERSION } from "@lyra/app-runtime";
import { describe, expect, test } from "vitest";

import {
  RUNTIME_AUXILIARY_CONNECTION_ROLE,
  RUNTIME_FATAL_HANDSHAKE_ERROR_CODES,
  RUNTIME_HOST_API_VERSION,
  RUNTIME_PRIMARY_HOST_EXISTS_CODE,
  RUNTIME_PRIMARY_HOST_HANDOFF,
  RUNTIME_PROTOCOL_MAX_VERSION,
  RUNTIME_PROTOCOL_MIN_VERSION,
  RUNTIME_SHELL_CAPABILITY_HOST_REQUESTS,
  RUNTIME_SHELL_CONNECTION_ROLE,
  RUNTIME_SHELL_DATA_SCHEMA_NAME,
  RUNTIME_SHELL_DATA_SCHEMA_VERSION,
  assertRuntimeShellHandshake,
  isRuntimeShellHandshake
} from "./runtime-shell-handshake";

const shellHello = {
  protocolMinVersion: RUNTIME_PROTOCOL_MIN_VERSION,
  protocolMaxVersion: RUNTIME_PROTOCOL_MAX_VERSION,
  clientName: "lyra-desktop",
  componentVersion: "0.1.0",
  buildId: "test-build",
  hostApiVersion: RUNTIME_HOST_API_VERSION,
  capabilities: [RUNTIME_SHELL_CAPABILITY_HOST_REQUESTS],
  dataSchemas: {
    [RUNTIME_SHELL_DATA_SCHEMA_NAME]: RUNTIME_SHELL_DATA_SCHEMA_VERSION
  },
  connectionRole: RUNTIME_SHELL_CONNECTION_ROLE,
  connectionLeaseId: "lease-1"
};

describe("runtime shell handshake freeze", () => {
  test("shell entry is protocol 2-2 primaryHost with host requests", () => {
    expect(RUNTIME_PROTOCOL_MIN_VERSION).toBe(2);
    expect(RUNTIME_PROTOCOL_MAX_VERSION).toBe(2);
    expect(RUNTIME_HOST_API_VERSION).toBe(HOST_API_VERSION);
    expect(RUNTIME_SHELL_CONNECTION_ROLE).toBe("primaryHost");
    expect(RUNTIME_AUXILIARY_CONNECTION_ROLE).toBe("auxiliaryClient");
    expect(isRuntimeShellHandshake(shellHello)).toBe(true);
    expect(() => assertRuntimeShellHandshake(shellHello)).not.toThrow();
  });

  test("CLI-shaped auxiliary hello is not a shell entry", () => {
    expect(
      isRuntimeShellHandshake({
        ...shellHello,
        clientName: "lyra-cli",
        capabilities: [],
        dataSchemas: {},
        connectionRole: RUNTIME_AUXILIARY_CONNECTION_ROLE
      })
    ).toBe(false);
    expect(() =>
      assertRuntimeShellHandshake({
        ...shellHello,
        connectionRole: RUNTIME_AUXILIARY_CONNECTION_ROLE
      })
    ).toThrow("frozen primaryHost shell entry");
  });

  test("primary-host lease is exclusive and only hands off by disconnect then claim", () => {
    expect(RUNTIME_PRIMARY_HOST_HANDOFF).toBe("disconnectThenClaim");
    expect(RUNTIME_FATAL_HANDSHAKE_ERROR_CODES).toContain(RUNTIME_PRIMARY_HOST_EXISTS_CODE);
  });
});
