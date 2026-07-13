import { rmSync } from "node:fs";
import { beforeEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => unknown;
  const handlers = new Map<string, Handler>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      })
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`, "utf8")),
      decryptString: vi.fn((value: Buffer) => value.toString("utf8").replace(/^encrypted:/u, ""))
    }
  };
});

const pathMock = vi.hoisted(() => ({
  home: `/tmp/lyra-sensitive-values-test-${process.pid}-${Math.random().toString(16).slice(2)}`
}));

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain,
  safeStorage: electronMock.safeStorage
}));

vi.mock("node:os", async (importActual) => ({
  ...(await importActual<typeof import("node:os")>()),
  homedir: () => pathMock.home
}));

import { LYRA_CHANNELS } from "../../../shared/desktop-bridge";
import { createLoginManagerPasswordRef } from "../../../shared/sensitive-value";
import type { LoginManagerIpcBridge } from "../../login-manager";
import { createSensitiveValuesIpcBridge } from "../service";

describe("Sensitive values IPC bridge", () => {
  beforeEach(() => {
    electronMock.handlers.clear();
    electronMock.ipcMain.handle.mockClear();
    electronMock.ipcMain.removeHandler.mockClear();
    electronMock.safeStorage.encryptString.mockClear();
    electronMock.safeStorage.decryptString.mockClear();
    rmSync(pathMock.home, { recursive: true, force: true });
  });

  test("reveals user-owned login-manager refs without exposing owner metadata as plaintext", async () => {
    const revealCredential = vi.fn(() => ({
      credentialId: "credential-example",
      username: "alice@example.com",
      password: "super-secret-password"
    }));
    const bridge = createSensitiveValuesIpcBridge({
      loginManager: {
        revealCredential
      } as unknown as LoginManagerIpcBridge
    });
    const ref = createLoginManagerPasswordRef({
      credentialId: "credential-example",
      origin: "https://example.com",
      hostname: "example.com",
      username: "alice@example.com"
    });

    await expect(
      electronMock.handlers.get(LYRA_CHANNELS.sensitiveValuesRevealToUser)?.(
        {},
        { ref, reason: "user-ai-panel" }
      )
    ).resolves.toEqual({
      refId: ref.id,
      value: "super-secret-password"
    });
    expect(revealCredential).toHaveBeenCalledWith({
      credentialId: "credential-example",
      reason: "user-ai-panel"
    });
    expect(JSON.stringify(ref)).not.toContain("super-secret-password");

    bridge.dispose();
    expect(electronMock.ipcMain.removeHandler)
      .toHaveBeenCalledWith(LYRA_CHANNELS.sensitiveValuesRevealToUser);
  });

  test("rejects unsupported refs instead of falling back to field-name guesses", async () => {
    const bridge = createSensitiveValuesIpcBridge({
      loginManager: {
        revealCredential: vi.fn()
      } as unknown as LoginManagerIpcBridge
    });

    await expect(bridge.revealToUser({
      ref: {
        kind: "lyra-sensitive-value-ref",
        id: "external:secret:1",
        owner: "external",
        valueKind: "secret",
        ownership: "user_owned",
        label: "External secret",
        displayHint: "••••••••",
        ownerRef: {
          kind: "opaque",
          owner: "external",
          valueId: "1"
        },
        capabilities: ["reveal_to_user"],
        modelVisibility: "metadata_only",
        plaintextVisibility: "user_reveal_only"
      }
    })).rejects.toThrow("Unsupported sensitive value ref");

    bridge.dispose();
  });

  test("resolves stored opaque safeStorage refs by owner value id", async () => {
    const bridge = createSensitiveValuesIpcBridge({
      loginManager: {
        revealCredential: vi.fn()
      } as unknown as LoginManagerIpcBridge
    });

    const stored = await bridge.store({
      owner: "ai-provider",
      valueKind: "api_key",
      label: "API key for OpenAI",
      value: "sk-provider-secret",
      capabilities: ["list_metadata", "use"]
    });

    await expect(bridge.resolveForAgentFill(stored.ref)).resolves.toBe("sk-provider-secret");
    expect(electronMock.safeStorage.encryptString).toHaveBeenCalledWith("sk-provider-secret");
    expect(electronMock.safeStorage.decryptString).toHaveBeenCalled();

    bridge.dispose();
  });

  test("restores legacy system credentials stored with use capability", async () => {
    const bridge = createSensitiveValuesIpcBridge({
      loginManager: {
        revealCredential: vi.fn()
      } as unknown as LoginManagerIpcBridge
    });

    const stored = await bridge.store({
      owner: "system",
      valueKind: "credential",
      label: "Administrator credential",
      value: "local-admin-password",
      capabilities: ["list_metadata", "use"]
    });

    await expect(bridge.revealToUser({ ref: stored.ref })).resolves.toEqual({
      refId: stored.ref.id,
      value: "local-admin-password"
    });

    bridge.dispose();
  });
});
