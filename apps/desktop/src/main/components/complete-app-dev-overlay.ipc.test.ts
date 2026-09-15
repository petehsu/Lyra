import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
import type { ModuleDataSchemaStore } from "./data-schema";
import type { ComponentRegistryStore } from "./registry";
import { createComponentsIpcBridge } from "./service";

const roots: string[] = [];

afterEach(async () => {
  electronMock.handlers.clear();
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const createOverlayRoot = async (distSource: string | undefined): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-complete-app-overlay-ipc-"));
  roots.push(root);
  await mkdir(path.join(root, "apps", "lyra-notifications", "dist"), { recursive: true });
  await writeFile(
    path.join(root, "apps", "lyra-notifications", "package.json"),
    "{\"name\":\"@lyra/app-notifications\",\"version\":\"1.0.0\"}\n"
  );
  if (distSource !== undefined) {
    await writeFile(
      path.join(root, "apps", "lyra-notifications", "dist", "index.mjs"),
      distSource
    );
  }
  return root;
};

const createStore = (
  overrides: Partial<ComponentRegistryStore> = {}
): ComponentRegistryStore => ({
  list: vi.fn(async () => []),
  read: vi.fn(async () => null),
  verifyInstalledVersion: vi.fn(async () => {
    throw new Error("signed component is missing");
  }),
  ...overrides
} as unknown as ComponentRegistryStore);

const createBridge = (
  overlayRoot: string | undefined,
  store: ComponentRegistryStore,
  dataSchemaStore?: ModuleDataSchemaStore
) => createComponentsIpcBridge({
  componentsRoot: "/tmp/lyra-components-overlay-test",
  systemRoot: "/tmp/lyra-system-overlay-test",
  publicKeys: {},
  releaseKeyScopes: {},
  allowLocalInstall: false,
  completeAppDevOverlayRoot: overlayRoot,
  registryStore: store,
  ...(dataSchemaStore === undefined ? {} : { dataSchemaStore })
});

describe("complete app dev overlay IPC", () => {
  test("lists and resolves unpackaged notifications dist without touching module data", async () => {
    const source = "export default { id: 'lyra.notifications' };\n";
    const overlayRoot = await createOverlayRoot(source);
    const store = createStore();
    const dataSchemaStore = {
      readOrInitialize: vi.fn()
    } as unknown as ModuleDataSchemaStore;
    const bridge = createBridge(overlayRoot, store, dataSchemaStore);

    const listed = await electronMock.handlers.get(LYRA_CHANNELS.componentsList)?.({});
    expect(listed).toEqual([expect.objectContaining({
      componentId: "lyra.notifications",
      kind: "app",
      active: "1.0.0"
    })]);

    const runtime = await electronMock.handlers.get(LYRA_CHANNELS.componentsResolveAppModule)?.(
      {},
      { componentId: "lyra.notifications", version: "1.0.0" }
    );
    expect(runtime).toEqual({
      componentId: "lyra.notifications",
      version: "1.0.0",
      entryUrl: "lyra-app-module://component/lyra.notifications/1.0.0/index.mjs",
      permissions: ["notifications:read"]
    });
    expect(dataSchemaStore.readOrInitialize).not.toHaveBeenCalled();
    expect(store.verifyInstalledVersion).not.toHaveBeenCalled();

    const protocolHandler = electronMock.protocol.handle.mock.calls[0]?.[1] as
      | ((request: { readonly url: string }) => Promise<Response>)
      | undefined;
    const response = await protocolHandler?.({ url: runtime.entryUrl });
    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe(source);
    bridge.dispose();
  });

  test("keeps the signed registry when notifications is already installed", async () => {
    const overlayRoot = await createOverlayRoot("export default { id: 'overlay' };\n");
    const store = createStore({
      list: vi.fn(async () => [{
        componentId: "lyra.notifications",
        kind: "app",
        active: "9.0.0",
        versions: {
          "9.0.0": {
            installedAt: "2026-07-30T00:00:00.000Z",
            target: "linux-x64",
            manifest: { componentId: "lyra.notifications" }
          }
        }
      }]),
      read: vi.fn(async () => ({
        componentId: "lyra.notifications",
        kind: "app",
        active: "9.0.0",
        versions: {
          "9.0.0": {
            installedAt: "2026-07-30T00:00:00.000Z",
            target: "linux-x64",
            manifest: { componentId: "lyra.notifications" }
          }
        }
      })),
      verifyInstalledVersion: vi.fn(async () => {
        throw new Error("signed verify");
      })
    });
    const bridge = createBridge(overlayRoot, store);

    const listed = await electronMock.handlers.get(LYRA_CHANNELS.componentsList)?.({});
    expect(listed).toEqual([expect.objectContaining({
      componentId: "lyra.notifications",
      active: "9.0.0"
    })]);
    await expect(electronMock.handlers.get(LYRA_CHANNELS.componentsResolveAppModule)?.(
      {},
      { componentId: "lyra.notifications", version: "1.0.0" }
    )).rejects.toThrow("signed verify");
    bridge.dispose();
  });

  test("does not list notifications when dist is missing", async () => {
    const overlayRoot = await createOverlayRoot(undefined);
    const store = createStore();
    const bridge = createBridge(overlayRoot, store);
    expect(await electronMock.handlers.get(LYRA_CHANNELS.componentsList)?.({})).toEqual([]);
    await expect(electronMock.handlers.get(LYRA_CHANNELS.componentsResolveAppModule)?.(
      {},
      { componentId: "lyra.notifications", version: "1.0.0" }
    )).rejects.toThrow("Component is not installed");
    bridge.dispose();
  });
});
