import type { LyraAppModule } from "@lyra/app-runtime";
import { describe, expect, test, vi } from "vitest";

import type { ComponentsApi } from "../../../../shared/desktop-bridge";
import {
  loadInstalledWorkspaceAppModule,
  synchronizeInstalledWorkspaceAppModules
} from "../loader";
import {
  hydrateWorkspaceAppVersionState,
  isWorkspaceAppModuleLoaded,
  isWorkspaceAppModuleSurfaceCapable,
  isWorkspaceAppModuleSurfaceReady,
  readWorkspaceAppVersionState
} from "../registry";

const createModule = (id: string, version: string): LyraAppModule => ({
  id,
  version,
  activate: () => undefined,
  create: ({ instanceId }) => ({ instanceId }),
  restore: ({ instanceId }) => ({ instanceId }),
  snapshot: () => ({}),
  mount: () => undefined,
  unmount: () => undefined,
  close: () => undefined,
  deactivate: () => undefined
});

const createComponents = (
  resolveAppModule: ComponentsApi["resolveAppModule"]
): ComponentsApi => ({ resolveAppModule } as ComponentsApi);

describe("workspace app module loader", () => {
  test("keeps the Core fallback when an installed bundle cannot be verified", async () => {
    const componentId = "lyra.notifications";
    const version = "1.0.0";
    await expect(loadInstalledWorkspaceAppModule({
      components: createComponents(async () => ({
        componentId,
        version,
        entryUrl: "lyra-component://lyra.notifications/1.0.0/index.mjs",
        permissions: ["notifications:read"]
      })),
      componentId,
      version,
      importer: async () => ({ default: createModule("lyra.someone-else", version) })
    })).rejects.toThrow("exported the wrong module");

    expect(isWorkspaceAppModuleLoaded(componentId, version)).toBe(true);
    expect(isWorkspaceAppModuleSurfaceCapable(componentId, version)).toBe(false);
  });

  test("replaces the same-version Core fallback with a verified installed surface", async () => {
    const componentId = "lyra.images";
    const version = "1.0.0";
    expect(isWorkspaceAppModuleLoaded(componentId, version)).toBe(true);
    expect(isWorkspaceAppModuleSurfaceCapable(componentId, version)).toBe(false);
    const importer = vi.fn(async () => ({ default: createModule(componentId, version) }));

    await loadInstalledWorkspaceAppModule({
      components: createComponents(async () => ({
        componentId,
        version,
        entryUrl: "lyra-component://lyra.images/1.0.0/index.mjs",
        permissions: ["files:read"]
      })),
      componentId,
      version,
      importer
    });

    expect(importer).toHaveBeenCalledOnce();
    expect(isWorkspaceAppModuleSurfaceCapable(componentId, version)).toBe(true);
    // Loading a verified bundle replaces the non-mountable fallback record,
    // but Core's independent parity gate still keeps Images on its complete
    // static surface while the modular implementation is Preview.
    expect(isWorkspaceAppModuleSurfaceReady(componentId, version)).toBe(false);
  });

  test("loads preview Files code without allowing its package to bypass Core readiness", async () => {
    const componentId = "lyra.files";
    const version = "1.0.0";
    await loadInstalledWorkspaceAppModule({
      components: createComponents(async () => ({
        componentId,
        version,
        entryUrl: "lyra-component://lyra.files/1.0.0/index.mjs",
        permissions: ["files:read", "files:write", "apps:open"]
      })),
      componentId,
      version,
      importer: async () => ({ default: createModule(componentId, version) })
    });

    expect(isWorkspaceAppModuleSurfaceCapable(componentId, version)).toBe(true);
    expect(isWorkspaceAppModuleSurfaceReady(componentId, version)).toBe(false);
  });

  test("loads the exact verified entry and registers its module implementation", async () => {
    const componentId = "dev.loader.success";
    const version = "1.0.0";
    const resolveAppModule = vi.fn(async () => ({
      componentId,
      version,
      entryUrl: "lyra-component://dev.loader.success/1.0.0/entry.js",
      permissions: []
    }));
    const importer = vi.fn(async () => ({
      default: createModule(componentId, version)
    }));

    await loadInstalledWorkspaceAppModule({
      components: createComponents(resolveAppModule),
      componentId,
      version,
      importer
    });

    expect(resolveAppModule).toHaveBeenCalledWith({ componentId, version });
    expect(importer).toHaveBeenCalledWith(
      "lyra-component://dev.loader.success/1.0.0/entry.js"
    );
    expect(isWorkspaceAppModuleLoaded(componentId, version)).toBe(true);
  });

  test("shares one in-flight import for concurrent requests", async () => {
    const componentId = "dev.loader.concurrent";
    const version = "1.0.0";
    let releaseImport!: () => void;
    const importGate = new Promise<void>((resolve) => {
      releaseImport = resolve;
    });
    const resolveAppModule = vi.fn(async () => ({
      componentId,
      version,
      entryUrl: "lyra-component://dev.loader.concurrent/1.0.0/entry.js",
      permissions: []
    }));
    const importer = vi.fn(async () => {
      await importGate;
      return { lyraAppModule: createModule(componentId, version) };
    });
    const request = {
      components: createComponents(resolveAppModule),
      componentId,
      version,
      importer
    };

    const first = loadInstalledWorkspaceAppModule(request);
    const second = loadInstalledWorkspaceAppModule(request);
    releaseImport();
    await Promise.all([first, second]);

    expect(resolveAppModule).toHaveBeenCalledTimes(1);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  test("rejects a resolved or exported identity mismatch", async () => {
    await expect(loadInstalledWorkspaceAppModule({
      components: createComponents(async () => ({
        componentId: "dev.loader.wrong",
        version: "2.0.0",
        entryUrl: "lyra-component://dev.loader.wrong/2.0.0/entry.js",
        permissions: []
      })),
      componentId: "dev.loader.expected",
      version: "1.0.0",
      importer: vi.fn()
    })).rejects.toThrow("identity mismatch");

    await expect(loadInstalledWorkspaceAppModule({
      components: createComponents(async () => ({
        componentId: "dev.loader.export",
        version: "1.0.0",
        entryUrl: "lyra-component://dev.loader.export/1.0.0/entry.js",
        permissions: []
      })),
      componentId: "dev.loader.export",
      version: "1.0.0",
      importer: async () => ({
        default: createModule("dev.loader.someone-else", "1.0.0")
      })
    })).rejects.toThrow("exported the wrong module");
  });

  test("hydrates signed disk pointers before workspace restoration", async () => {
    const componentId = "lyra.downloads";
    const resolveAppModule = vi.fn(async ({ version }: { readonly version: string }) => ({
      componentId,
      version,
      entryUrl: `lyra-app-module://component/${componentId}/${version}/entry.js`,
      permissions: []
    }));
    const components = {
      list: async () => [{
        componentId,
        kind: "app" as const,
        active: "2.0.0",
        previous: "1.0.0",
        pending: "3.0.0",
        versions: ["1.0.0", "2.0.0", "3.0.0"].map((version) => ({
          version,
          installedAt: "2026-07-30T00:00:00.000Z",
          target: "darwin-arm64"
        }))
      }],
      resolveAppModule
    } as unknown as ComponentsApi;

    const issues = await synchronizeInstalledWorkspaceAppModules({
      components,
      importer: async (url) => {
        const version = /\/(\d+\.\d+\.\d+)\/entry\.js$/u.exec(url)?.[1];
        if (version === undefined) {
          throw new Error("missing version");
        }
        return { default: createModule(componentId, version) };
      }
    });

    expect(issues).toEqual([]);
    expect(readWorkspaceAppVersionState(componentId)).toMatchObject({
      active: "2.0.0",
      previous: "1.0.0",
      pending: "3.0.0"
    });
    hydrateWorkspaceAppVersionState(componentId, { active: "1.0.0" });
  });
});
