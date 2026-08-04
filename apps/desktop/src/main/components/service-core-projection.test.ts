import type { ComponentManifestV1 } from "@lyra/app-runtime";
import { afterEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
        handlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel))
    },
    protocol: {
      handle: vi.fn(),
      unhandle: vi.fn()
    }
  };
});

vi.mock("electron", () => electronMock);

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
import type { CoreProjectionCoordinator } from "../component-update";
import type { ComponentRegistryStore, InstalledComponentV1 } from "./registry";
import { createComponentsIpcBridge } from "./service";

afterEach(() => {
  electronMock.handlers.clear();
  vi.clearAllMocks();
});

const manifest = (version: string, permissions: readonly string[]): ComponentManifestV1 => ({
  schemaVersion: 1,
  componentId: "lyra.core",
  kind: "core",
  version,
  target: "darwin-arm64",
  entry: "payload.zip",
  activation: "core-restart",
  hostApiRange: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
  dataSchema: { readerMin: 1, readerMax: 1, writer: 1 },
  permissions,
  publisher: "Lyra",
  files: [{ path: "payload.zip", size: 1, sha256: "a".repeat(64) }],
  keyId: "lyra-release",
  signature: "A".repeat(86) + "=="
});

const installedCore = (): InstalledComponentV1 => ({
  componentId: "lyra.core",
  kind: "core",
  active: "1.0.0",
  pending: "1.1.0",
  versions: {
    "1.0.0": {
      installedAt: "2026-07-30T00:00:00.000Z",
      target: "darwin-arm64",
      manifest: manifest("1.0.0", [])
    },
    "1.1.0": {
      installedAt: "2026-07-31T00:00:00.000Z",
      target: "darwin-arm64",
      manifest: manifest("1.1.0", ["core.update"])
    }
  }
});

describe("components bridge Core projection routing", () => {
  test("requires the exact Core activation assessment before handoff", async () => {
    const component = installedCore();
    const store = {
      list: vi.fn(async () => [component]),
      read: vi.fn(async () => component),
      verifyInstalledVersion: vi.fn(),
      installFromDirectory: vi.fn(),
      activate: vi.fn(),
      rollback: vi.fn(),
      restoreActivation: vi.fn(),
      uninstallVersion: vi.fn(),
      recordKeyringSequence: vi.fn(),
      recordCatalogSequence: vi.fn()
    } as unknown as ComponentRegistryStore;
    const coreProjection = {
      noteStaged: vi.fn(),
      readStatus: vi.fn(async () => ({
        state: "pending" as const,
        componentId: "lyra.core" as const,
        pendingVersion: "1.1.0"
      })),
      applyAndQuit: vi.fn(async () => ({
        state: "spawned" as const,
        componentId: "lyra.core" as const,
        pendingVersion: "1.1.0",
        requestId: "2bb03cb7-3d2d-49f8-a7f7-47b755821916",
        helperPath: "/tmp/lyra-bootstrap",
        args: []
      })),
      dispose: vi.fn()
    } satisfies CoreProjectionCoordinator;
    const bridge = createComponentsIpcBridge({
      componentsRoot: "/tmp/lyra-components-test",
      systemRoot: "/tmp/lyra-system-test",
      publicKeys: {},
      releaseKeyScopes: {},
      allowLocalInstall: false,
      registryStore: store,
      coreProjection
    });
    const apply = electronMock.handlers.get(LYRA_CHANNELS.componentsApplyCore);

    await expect(apply?.({}, {
      componentId: "lyra.core",
      confirmedReasons: []
    })).rejects.toThrow("permission-increase");
    expect(coreProjection.applyAndQuit).not.toHaveBeenCalled();

    await expect(apply?.({}, {
      componentId: "example.notes",
      confirmedReasons: ["permission-increase"]
    })).rejects.toThrow("only apply lyra.core");
    expect(coreProjection.applyAndQuit).not.toHaveBeenCalled();

    await expect(apply?.({}, {
      componentId: "lyra.core",
      confirmedReasons: ["permission-increase"]
    })).resolves.toEqual({
      state: "spawned",
      componentId: "lyra.core",
      pendingVersion: "1.1.0",
      requestId: "2bb03cb7-3d2d-49f8-a7f7-47b755821916"
    });
    expect(coreProjection.applyAndQuit).toHaveBeenCalledOnce();

    await expect(electronMock.handlers.get(LYRA_CHANNELS.componentsRollback)?.(
      {},
      "lyra.core"
    )).rejects.toThrow("Core rollback requires an external projection helper");
    expect(store.rollback).not.toHaveBeenCalled();
    bridge.dispose();
  });

  test("rejects handoff when the registry has no pending Core", async () => {
    const component = { ...installedCore(), pending: undefined } as unknown as InstalledComponentV1;
    const store = {
      list: vi.fn(async () => [component]),
      read: vi.fn(async () => component)
    } as unknown as ComponentRegistryStore;
    const coreProjection = {
      applyAndQuit: vi.fn()
    } as unknown as CoreProjectionCoordinator;
    const bridge = createComponentsIpcBridge({
      componentsRoot: "/tmp/lyra-components-test",
      systemRoot: "/tmp/lyra-system-test",
      publicKeys: {},
      releaseKeyScopes: {},
      allowLocalInstall: false,
      registryStore: store,
      coreProjection
    });

    await expect(electronMock.handlers.get(LYRA_CHANNELS.componentsApplyCore)?.({}, {
      componentId: "lyra.core",
      confirmedReasons: []
    })).rejects.toThrow("No pending Core update");
    expect(coreProjection.applyAndQuit).not.toHaveBeenCalled();
    bridge.dispose();
  });
});
