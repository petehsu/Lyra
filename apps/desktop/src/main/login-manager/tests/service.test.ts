import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => unknown;
  const handlers = new Map<string, Handler>();
  const ciphertexts = new Map<string, string>();
  let encryptionAvailable = true;
  let nextCiphertextId = 0;
  return {
    handlers,
    setEncryptionAvailable: (value: boolean) => {
      encryptionAvailable = value;
    },
    resetCiphertexts: () => {
      ciphertexts.clear();
      nextCiphertextId = 0;
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        handlers.delete(channel);
      })
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => encryptionAvailable),
      encryptString: vi.fn((value: string) => {
        const key = `ciphertext-${nextCiphertextId}`;
        nextCiphertextId += 1;
        ciphertexts.set(key, value);
        return Buffer.from(key, "utf8");
      }),
      decryptString: vi.fn((buffer: Buffer) => {
        const key = buffer.toString("utf8");
        const value = ciphertexts.get(key);
        if (value === undefined) {
          throw new Error("Unknown ciphertext");
        }
        return value;
      })
    },
    session: {
      defaultSession: undefined
    }
  };
});

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain,
  safeStorage: electronMock.safeStorage,
  session: electronMock.session
}));

import { LYRA_CHANNELS } from "../../../shared/desktop-bridge";
import { createLoginManagerIpcBridge } from "../service";

type Listener = (...args: unknown[]) => void;

const createWebContents = () => {
  const listeners = new Map<string, Set<Listener>>();
  const cookiesGet = vi.fn(async () => [
    { name: "session" },
    { name: "theme" }
  ]);
  const cookiesRemove = vi.fn(async () => undefined);
  const clearStorageData = vi.fn(async () => undefined);
  const fetch = vi.fn(async () => new Response(
    Buffer.from([0, 0, 1, 0, 1, 0, 16, 16]),
    {
      status: 200,
      headers: {
        "content-type": "image/x-icon"
      }
    }
  ));
  const executeJavaScript = vi.fn(async (script: string) => (
    script.includes("usernameValue")
      ? { filled: true }
      : false
  ));
  return {
    webContents: {
      getURL: vi.fn(() => "https://example.com/login"),
      getTitle: vi.fn(() => "Example Login"),
      isDestroyed: vi.fn(() => false),
      executeJavaScript,
      session: {
        fetch,
        cookies: {
          get: cookiesGet,
          remove: cookiesRemove
        },
        clearStorageData
      },
      on: vi.fn((event: string, listener: Listener) => {
        const set = listeners.get(event) ?? new Set<Listener>();
        set.add(listener);
        listeners.set(event, set);
      }),
      off: vi.fn((event: string, listener: Listener) => {
        listeners.get(event)?.delete(listener);
      })
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
    cookiesGet,
    cookiesRemove,
    clearStorageData,
    fetch,
    executeJavaScript
  };
};

const waitForTruthy = async (
  predicate: () => boolean,
  timeoutMs = 500
): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition");
};

const submitCredentialMessage = (password: string) =>
  `__LYRA_LOGIN_MANAGER__:${JSON.stringify({
    type: "credential-submit",
    url: "https://example.com/login",
    title: "Example Login",
    username: "alice@example.com",
    password
  })}`;

describe("Login Manager IPC bridge", () => {
  let storageRoot: string;

  beforeEach(() => {
    storageRoot = mkdtempSync(path.join(tmpdir(), "lyra-login-manager-test-"));
    electronMock.handlers.clear();
    electronMock.ipcMain.handle.mockClear();
    electronMock.ipcMain.removeHandler.mockClear();
    electronMock.safeStorage.isEncryptionAvailable.mockClear();
    electronMock.safeStorage.encryptString.mockClear();
    electronMock.safeStorage.decryptString.mockClear();
    electronMock.resetCiphertexts();
    electronMock.setEncryptionAvailable(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  test("stores captured passwords only as safeStorage ciphertext metadata", async () => {
    const bridge = createLoginManagerIpcBridge({
      storageRoot,
      getWindow: () => null
    });
    const tab = createWebContents();
    bridge.attachWebContents("page-1", tab.webContents as never);

    tab.emit("page-favicon-updated", {}, ["https://example.com/favicon.ico"]);
    tab.emit("console-message", {}, 1, submitCredentialMessage("super-secret-password"));
    await waitForTruthy(() =>
      bridge.list().sessions[0]?.faviconUrl?.startsWith("lyra-file://preview") === true
    );

    const snapshot = bridge.list();
    expect(tab.fetch).toHaveBeenCalledWith(
      "https://example.com/favicon.ico",
      expect.objectContaining({
        redirect: "follow"
      })
    );
    expect(snapshot.passwordsAvailable).toBe(true);
    expect(snapshot.credentials).toHaveLength(1);
    expect(snapshot.credentials[0]).toMatchObject({
      origin: "https://example.com",
      username: "alice@example.com",
      hasPassword: true,
      passwordAvailable: true,
      passwordRef: {
        kind: "lyra-sensitive-value-ref",
        owner: "login-manager",
        valueKind: "password",
        ownership: "user_owned",
        modelVisibility: "metadata_only",
        plaintextVisibility: "user_reveal_only",
        ownerRef: {
          kind: "login-manager-credential",
          credentialId: snapshot.credentials[0]!.id
        }
      }
    });
    expect(snapshot.credentials[0]?.faviconUrl).toMatch(/^lyra-file:\/\/preview\?/u);
    expect(snapshot.sessions[0]).toMatchObject({
      origin: "https://example.com"
    });
    expect(snapshot.sessions[0]?.faviconUrl).toMatch(/^lyra-file:\/\/preview\?/u);
    expect(JSON.stringify(snapshot.credentials[0]!.passwordRef)).not.toContain("super-secret-password");
    const storeText = readFileSync(path.join(storageRoot, "login-manager.v1.json"), "utf8");
    expect(storeText).not.toContain("super-secret-password");
    expect(storeText).toContain("passwordCiphertextBase64");

    expect(
      bridge.revealCredential({
        credentialId: snapshot.credentials[0]!.id,
        reason: "user-reveal"
      })
    ).toEqual({
      credentialId: snapshot.credentials[0]!.id,
      username: "alice@example.com",
      password: "super-secret-password"
    });

    const fillResult = await bridge.fillCredential({
      credentialId: snapshot.credentials[0]!.id,
      reason: "user-fill"
    });
    expect(fillResult).toEqual({
      filled: true,
      tabId: "page-1",
      origin: "https://example.com",
      username: "alice@example.com"
    });
    expect(JSON.stringify(fillResult)).not.toContain("super-secret-password");

    bridge.dispose();
    expect(electronMock.ipcMain.removeHandler)
      .toHaveBeenCalledWith(LYRA_CHANNELS.loginManagerList);
  });

  test("keeps session management enabled when safeStorage is unavailable", () => {
    electronMock.setEncryptionAvailable(false);
    const bridge = createLoginManagerIpcBridge({
      storageRoot,
      getWindow: () => null
    });
    const tab = createWebContents();
    bridge.attachWebContents("page-1", tab.webContents as never);

    tab.emit("console-message", {}, 1, submitCredentialMessage("disabled-secret"));

    const snapshot = bridge.list();
    expect(snapshot.passwordsAvailable).toBe(false);
    expect(snapshot.passwordStorageReason).toBe("electron_safe_storage_unavailable");
    expect(snapshot.sessions[0]).toMatchObject({
      origin: "https://example.com",
      accountHint: "alice@example.com"
    });
    expect(snapshot.credentials[0]).toMatchObject({
      hasPassword: false,
      passwordAvailable: false
    });
    const storeText = readFileSync(path.join(storageRoot, "login-manager.v1.json"), "utf8");
    expect(storeText).not.toContain("disabled-secret");
    expect(() => bridge.revealCredential({
      credentialId: snapshot.credentials[0]!.id
    })).toThrow("Saved password is unavailable");
  });

  test("clears site cookies and storage instead of clicking page logout controls", async () => {
    const bridge = createLoginManagerIpcBridge({
      storageRoot,
      getWindow: () => null
    });
    const tab = createWebContents();
    bridge.attachWebContents("page-1", tab.webContents as never);
    tab.emit("console-message", {}, 1, submitCredentialMessage("super-secret-password"));

    const result = await bridge.clearSite({
      origin: "https://example.com"
    });

    expect(result).toEqual({
      cleared: true,
      origin: "https://example.com",
      hostname: "example.com",
      cookiesRemoved: 2,
      storageCleared: true
    });
    expect(tab.cookiesRemove).toHaveBeenCalledWith("https://example.com", "session");
    expect(tab.cookiesRemove).toHaveBeenCalledWith("https://example.com", "theme");
    expect(tab.clearStorageData).toHaveBeenCalledWith({
      origin: "https://example.com",
      storages: [
        "cookies",
        "localstorage",
        "indexdb",
        "cachestorage",
        "serviceworkers",
        "websql"
      ]
    });
    expect(bridge.list().sessions[0]).toMatchObject({
      status: "possible",
      signals: expect.objectContaining({
        cookieCount: 0,
        storageObserved: false
      })
    });
  });

  test("warms stored remote favicons into local snapshot URLs", async () => {
    const fetch = vi.fn(async () => new Response(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      {
        status: 200,
        headers: {
          "content-type": "image/png"
        }
      }
    ));
    vi.stubGlobal("fetch", fetch);
    const timestamp = "2026-05-31T00:00:00.000Z";
    mkdirSync(storageRoot, { recursive: true });
    writeFileSync(
      path.join(storageRoot, "login-manager.v1.json"),
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: "https://example.com",
            origin: "https://example.com",
            hostname: "example.com",
            faviconUrl: "https://example.com/favicon.ico",
            status: "observed",
            authMethod: {
              kind: "site_session",
              label: "Site session",
              source: "observed",
              confidence: 1
            },
            authMethodSource: "observed",
            signals: {
              cookieCount: 1,
              storageObserved: true,
              formSubmitted: false
            },
            credentialIds: [],
            firstSeenAt: timestamp,
            lastSeenAt: timestamp,
            updatedAt: timestamp
          }
        ],
        credentials: []
      }),
      "utf8"
    );

    const bridge = createLoginManagerIpcBridge({
      storageRoot,
      getWindow: () => null
    });
    await waitForTruthy(() =>
      bridge.list().sessions[0]?.faviconUrl?.startsWith("lyra-file://preview") === true
    );

    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/favicon.ico",
      expect.objectContaining({
        redirect: "follow"
      })
    );
    expect(bridge.list().sessions[0]?.faviconUrl).toMatch(/^lyra-file:\/\/preview\?/u);
    expect(
      readFileSync(path.join(storageRoot, "favicons", "index.v1.json"), "utf8")
    ).toContain("https://example.com/favicon.ico");

    bridge.dispose();
  });
});
