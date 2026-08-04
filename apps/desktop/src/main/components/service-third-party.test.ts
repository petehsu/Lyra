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
import type {
  ModuleDataSchemaStore,
  ModuleDataSchemaTransaction
} from "./data-schema";
import type { ComponentRegistryStore, InstalledComponentV1 } from "./registry";
import { createComponentsIpcBridge } from "./service";
import type { ThirdPartyAppLifecycleService } from "../third-party-apps";

afterEach(() => {
  electronMock.handlers.clear();
  vi.clearAllMocks();
});

const manifest = (
  version: string,
  executionClass: NonNullable<ComponentManifestV1["executionClass"]>
): ComponentManifestV1 => ({
  schemaVersion: 1,
  componentId: "example.notes",
  kind: "app",
  version,
  target: "darwin-arm64",
  entry: "index.html",
  executionClass,
  activation: "module-idle",
  hostApiRange: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
  dataSchema: { readerMin: 1, readerMax: 1, writer: 1 },
  permissions: [],
  publisher: "Example Publisher",
  files: [{ path: "index.html", size: 1, sha256: "a".repeat(64) }],
  keyId: "example-key",
  signature: "A".repeat(86) + "=="
});

describe("components bridge third-party lifecycle routing", () => {
  test("does not bypass leases for activation, rollback, or uninstall", async () => {
    const component: InstalledComponentV1 = {
      componentId: "example.notes",
      kind: "app",
      active: "1.0.0",
      previous: "0.9.0",
      pending: "1.1.0",
      versions: {
        "0.9.0": {
          installedAt: "2026-07-31T00:00:00.000Z",
          target: "darwin-arm64",
          manifest: manifest("0.9.0", "sandboxed-web")
        },
        "1.0.0": {
          installedAt: "2026-07-31T00:00:00.000Z",
          target: "darwin-arm64",
          manifest: manifest("1.0.0", "sandboxed-web")
        },
        "1.1.0": {
          installedAt: "2026-07-31T00:00:00.000Z",
          target: "darwin-arm64",
          manifest: manifest("1.1.0", "sandboxed-web")
        }
      }
    };
    const store = {
      list: vi.fn(async () => [component]),
      read: vi.fn(async () => component),
      verifyInstalledVersion: vi.fn(),
      installFromDirectory: vi.fn(),
      activate: vi.fn(),
      rollback: vi.fn(),
      uninstallVersion: vi.fn(),
      recordKeyringSequence: vi.fn(),
      recordCatalogSequence: vi.fn()
    } as unknown as ComponentRegistryStore;
    const thirdPartyApps = {
      activatePending: vi.fn(async () => ({ status: "deferred", component })),
      rollback: vi.fn(async () => component),
      uninstallVersion: vi.fn(async () => undefined)
    } as unknown as ThirdPartyAppLifecycleService;
    const bridge = createComponentsIpcBridge({
      componentsRoot: "/tmp/lyra-components-test",
      systemRoot: "/tmp/lyra-system-test",
      publicKeys: {},
      releaseKeyScopes: {},
      allowLocalInstall: false,
      registryStore: store,
      thirdPartyApps
    });

    await expect(electronMock.handlers.get(LYRA_CHANNELS.componentsActivate)?.(
      {},
      { componentId: "example.notes", confirmedReasons: [] }
    )).resolves.toMatchObject({ componentId: "example.notes", pending: "1.1.0" });
    expect(thirdPartyApps.activatePending).toHaveBeenCalledWith("example.notes");
    expect(store.activate).not.toHaveBeenCalled();

    await electronMock.handlers.get(LYRA_CHANNELS.componentsRollback)?.(
      {},
      "example.notes"
    );
    expect(thirdPartyApps.rollback).toHaveBeenCalledWith("example.notes");
    expect(store.rollback).not.toHaveBeenCalled();

    await electronMock.handlers.get(LYRA_CHANNELS.componentsUninstallVersion)?.(
      {},
      { componentId: "example.notes", version: "0.9.0" }
    );
    expect(thirdPartyApps.uninstallVersion).toHaveBeenCalledWith(
      "example.notes",
      "0.9.0"
    );
    expect(store.uninstallVersion).not.toHaveBeenCalled();
    bridge.dispose();
  });

  test("restores prepared data before component pointers when commit fails", async () => {
    const oldManifest = {
      ...manifest("1.0.0", "first-party-shared-renderer"),
      componentId: "lyra.example"
    };
    const nextManifest = {
      ...manifest("1.1.0", "first-party-shared-renderer"),
      componentId: "lyra.example",
      dataSchema: { readerMin: 2, readerMax: 2, writer: 2 }
    };
    const original: InstalledComponentV1 = {
      componentId: "lyra.example",
      kind: "app",
      active: "1.0.0",
      pending: "1.1.0",
      versions: {
        "1.0.0": {
          installedAt: "2026-07-31T00:00:00.000Z",
          target: "darwin-arm64",
          manifest: oldManifest
        },
        "1.1.0": {
          installedAt: "2026-07-31T00:00:00.000Z",
          target: "darwin-arm64",
          manifest: nextManifest
        }
      }
    };
    const activated: InstalledComponentV1 = {
      ...original,
      active: "1.1.0",
      previous: "1.0.0",
      pending: undefined
    } as unknown as InstalledComponentV1;
    let current = original;
    let data = "v1";
    const recoveryOrder: string[] = [];
    const beforeData = {
      schemaVersion: 1 as const,
      componentId: "lyra.example",
      dataSchema: 1,
      updatedAt: "2026-07-30T00:00:00.000Z"
    };
    const dataTransaction: ModuleDataSchemaTransaction = {
      componentId: "lyra.example",
      before: beforeData,
      prepared: {
        ...beforeData,
        dataSchema: 2,
        updatedAt: "2026-07-31T00:00:00.000Z"
      },
      changed: true,
      commit: vi.fn(async () => {
        throw new Error("data commit failed");
      }),
      rollback: vi.fn(async (restoreActivation) => {
        data = "v1";
        recoveryOrder.push("data");
        await restoreActivation?.();
        return beforeData;
      })
    };
    const store = {
      list: vi.fn(async () => [current]),
      read: vi.fn(async () => current),
      verifyInstalledVersion: vi.fn(),
      installFromDirectory: vi.fn(),
      activate: vi.fn(async () => {
        current = activated;
        return activated;
      }),
      rollback: vi.fn(),
      restoreActivation: vi.fn(async () => {
        expect(data).toBe("v1");
        recoveryOrder.push("version");
        current = original;
        return original;
      }),
      uninstallVersion: vi.fn(),
      recordKeyringSequence: vi.fn(),
      recordCatalogSequence: vi.fn()
    } as unknown as ComponentRegistryStore;
    const dataSchemaStore = {
      readOrInitialize: vi.fn(),
      prepare: vi.fn(async () => {
        data = "v2";
        return dataTransaction;
      }),
      recoverInterruptedTransactions: vi.fn()
    } as unknown as ModuleDataSchemaStore;
    const bridge = createComponentsIpcBridge({
      componentsRoot: "/tmp/lyra-components-test",
      systemRoot: "/tmp/lyra-system-test",
      publicKeys: {},
      releaseKeyScopes: {},
      allowLocalInstall: false,
      registryStore: store,
      dataSchemaStore
    });

    await expect(electronMock.handlers.get(LYRA_CHANNELS.componentsActivate)?.(
      {},
      {
        componentId: "lyra.example",
        confirmedReasons: ["data-migration"]
      }
    )).rejects.toThrow("data commit failed");
    expect(data).toBe("v1");
    expect(current).toBe(original);
    expect(recoveryOrder).toEqual(["data", "version"]);
    expect(dataTransaction.rollback).toHaveBeenCalledOnce();
    bridge.dispose();
  });
});
