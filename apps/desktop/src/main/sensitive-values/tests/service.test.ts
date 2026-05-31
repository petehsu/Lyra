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
    }
  };
});

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain
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
});
