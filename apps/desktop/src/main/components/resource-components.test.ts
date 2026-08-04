import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
  ComponentManifestV1,
  ComponentTargetV1
} from "@lyra/app-runtime";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  ComponentRegistryStore,
  InstalledComponentV1
} from "./registry";
import {
  ResourceComponentUpdatePendingError,
  createResourceComponentManager,
  readActiveLanguageResourceBundles
} from "./resource-components";
import { applyRuntimeResourceComponentEnvironment } from "./resource-environment";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

const currentTarget = (): ComponentTargetV1 => {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  return `${platform}-${process.arch}` as ComponentTargetV1;
};

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-resource-component-"));
  roots.push(root);
  return root;
};

const createInstalledResource = ({
  componentId,
  version = "1.0.0",
  entry = "bundle.json"
}: {
  readonly componentId: string;
  readonly version?: string;
  readonly entry?: string;
}): InstalledComponentV1 => {
  const manifest = {
    schemaVersion: 1,
    componentId,
    kind: "resource",
    version,
    target: currentTarget(),
    entry,
    activation: "resource-idle",
    dataSchema: { readerMin: 1, readerMax: 1, writer: 1 },
    permissions: [],
    publisher: "Lyra",
    files: [{ path: entry, size: 1, sha256: "0".repeat(64) }],
    keyId: "test",
    signature: `${"A".repeat(86)}==`
  } satisfies ComponentManifestV1;
  return {
    componentId,
    kind: "resource",
    active: version,
    versions: {
      [version]: {
        manifest,
        installedAt: "2026-07-31T00:00:00.000Z",
        target: manifest.target
      }
    }
  };
};

const createRegistry = (
  components: Readonly<Record<string, InstalledComponentV1>>
): ComponentRegistryStore => ({
  list: async () => Object.values(components),
  read: async (componentId) => components[componentId] ?? null,
  verifyInstalledVersion: async (componentId, version) => {
    const installed = components[componentId]?.versions[version];
    if (installed === undefined) {
      throw new Error("missing fixture");
    }
    return installed;
  },
  installFromDirectory: async () => {
    throw new Error("not implemented");
  },
  activate: async () => {
    throw new Error("not implemented");
  },
  rollback: async () => {
    throw new Error("not implemented");
  },
  restoreActivation: async () => {
    throw new Error("not implemented");
  },
  uninstallVersion: async () => undefined,
  recordKeyringSequence: async () => undefined,
  recordCatalogSequence: async () => undefined
});

const writeInstalledFiles = async (
  componentsRoot: string,
  component: InstalledComponentV1,
  files: Readonly<Record<string, string>>
): Promise<void> => {
  const version = component.active!;
  const installed = component.versions[version]!;
  const root = path.join(
    componentsRoot,
    component.componentId,
    version,
    installed.target
  );
  await mkdir(root, { recursive: true });
  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const destination = path.join(root, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents);
    })
  );
};

describe("resource component manager", () => {
  test("pins the selected version and blocks new references during an idle switch", async () => {
    const root = await createRoot();
    const componentsRoot = path.join(root, "components");
    const component = createInstalledResource({
      componentId: "lyra.language.en-us"
    });
    await writeInstalledFiles(componentsRoot, component, {
      "bundle.json": JSON.stringify({ hello: "Hello" }),
      "resource.json": JSON.stringify({
        schemaVersion: 1,
        locale: "en-US",
        version: "1.0.0"
      })
    });
    const manager = createResourceComponentManager({
      componentsRoot,
      registry: createRegistry({ [component.componentId]: component }),
      healthCheck: async () => undefined
    });

    const lease = await manager.acquire(component.componentId);
    expect(manager.listReferences()).toEqual([{
      componentId: component.componentId,
      version: "1.0.0",
      count: 1
    }]);
    const lockPromise = manager.acquireExclusive(component.componentId, 1_000);
    await Promise.resolve();
    await expect(manager.acquire(component.componentId)).rejects.toBeInstanceOf(
      ResourceComponentUpdatePendingError
    );
    lease.release();
    const lock = await lockPromise;
    expect(manager.listReferences()).toEqual([]);
    lock.release();
    await expect(manager.acquire(component.componentId)).resolves.toMatchObject({
      componentId: component.componentId,
      version: "1.0.0"
    });
    manager.dispose();
  });

  test("reads active signed language bundles through short-lived references", async () => {
    const root = await createRoot();
    const componentsRoot = path.join(root, "components");
    const component = createInstalledResource({
      componentId: "lyra.language.zh-cn"
    });
    await writeInstalledFiles(componentsRoot, component, {
      "bundle.json": JSON.stringify({ hello: "你好" }),
      "resource.json": JSON.stringify({
        schemaVersion: 1,
        locale: "zh-CN",
        version: "1.0.0"
      })
    });
    const registry = createRegistry({ [component.componentId]: component });
    const manager = createResourceComponentManager({
      componentsRoot,
      registry,
      healthCheck: async () => undefined
    });

    await expect(readActiveLanguageResourceBundles({
      registry,
      manager,
      validateBundle: (_locale, value) => value as Record<string, string>
    })).resolves.toEqual({
      "zh-CN": { hello: "你好" }
    });
    expect(manager.listReferences()).toEqual([]);
  });

  test("rejects a resource entry that escapes its signed version directory", async () => {
    const root = await createRoot();
    const component = createInstalledResource({
      componentId: "lyra.resource.test",
      entry: "../outside"
    });
    const manager = createResourceComponentManager({
      componentsRoot: path.join(root, "components"),
      registry: createRegistry({ [component.componentId]: component }),
      healthCheck: async () => undefined
    });

    await expect(manager.resolveActive(component.componentId)).rejects.toThrow(
      "escapes its package"
    );
  });
});

describe("runtime resource environment", () => {
  test("uses signed component paths and blocks missing packaged fallbacks", async () => {
    const resources = new Map([
      ["lyra.resource.rust-analyzer", {
        componentId: "lyra.resource.rust-analyzer",
        version: "1.0.0",
        runtimePath: "/signed/rust-analyzer"
      }]
    ]);
    const manager = {
      resolveActive: vi.fn(async (componentId: string) => {
        const resource = resources.get(componentId);
        return resource === undefined
          ? null
          : {
              ...resource,
              installedAt: "2026-07-31T00:00:00.000Z",
              rootPath: "/signed",
              entryPath: resource.runtimePath,
              family: "rust-analyzer" as const,
              manifest: {} as ComponentManifestV1
            };
      }),
      assertHealthy: vi.fn(async () => undefined)
    };
    const env: NodeJS.ProcessEnv = {};

    const result = await applyRuntimeResourceComponentEnvironment({
      manager: manager as never,
      componentsRoot: "/components",
      developmentFallback: false,
      env
    });

    expect(env.LYRA_LSP_RUST_ANALYZER).toBe("/signed/rust-analyzer");
    expect(env.LYRA_ARIA2_BINARY).toBe(
      path.join("/components", "lyra.resource.aria2", ".missing")
    );
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe(
      path.join("/components", "lyra.resource.playwright", ".missing")
    );
    expect(result.resources.map(({ source }) => source)).toEqual([
      "component",
      "missing",
      "missing"
    ]);
  });

  test("binds aria2 to the signed component root, version, and binary digest", async () => {
    const binaryPath = path.join("/signed", "aria2", "bin", "aria2c");
    const digest = "a".repeat(64);
    const resource = {
      componentId: "lyra.resource.aria2",
      version: "1.0.0",
      installedAt: "2026-07-31T00:00:00.000Z",
      rootPath: path.join("/signed", "aria2"),
      entryPath: path.join("/signed", "aria2", "manifest.json"),
      runtimePath: binaryPath,
      family: "aria2" as const,
      manifest: {
        files: [{ path: "bin/aria2c", size: 1, sha256: digest }]
      } as unknown as ComponentManifestV1
    };
    const manager = {
      resolveActive: vi.fn(async (componentId: string) =>
        componentId === resource.componentId ? resource : null),
      assertHealthy: vi.fn(async () => undefined)
    };
    const env: NodeJS.ProcessEnv = {
      LYRA_ARIA2_TRUST: "forged",
      LYRA_ARIA2_BINARY_SHA256: "0".repeat(64)
    };

    await applyRuntimeResourceComponentEnvironment({
      manager: manager as never,
      componentsRoot: "/components",
      developmentFallback: false,
      env
    });

    expect(env.LYRA_ARIA2_BINARY).toBe(binaryPath);
    expect(env.LYRA_ARIA2_BINARY_SHA256).toBe(digest);
    expect(env.LYRA_ARIA2_COMPONENT_ROOT).toBe(resource.rootPath);
    expect(env.LYRA_ARIA2_COMPONENT_VERSION).toBe("1.0.0");
    expect(env.LYRA_ARIA2_TRUST).toBe("verified-component-v1");
  });

  test("clears inherited aria2 trust when no signed component is active", async () => {
    const manager = {
      resolveActive: vi.fn(async () => null),
      assertHealthy: vi.fn(async () => undefined)
    };
    const env: NodeJS.ProcessEnv = {
      LYRA_ARIA2_TRUST: "verified-component-v1",
      LYRA_ARIA2_BINARY_SHA256: "0".repeat(64),
      LYRA_ARIA2_COMPONENT_ROOT: "/forged",
      LYRA_ARIA2_COMPONENT_VERSION: "9.9.9"
    };

    await applyRuntimeResourceComponentEnvironment({
      manager: manager as never,
      componentsRoot: "/components",
      developmentFallback: false,
      env
    });

    expect(env.LYRA_ARIA2_TRUST).toBeUndefined();
    expect(env.LYRA_ARIA2_BINARY_SHA256).toBeUndefined();
    expect(env.LYRA_ARIA2_COMPONENT_ROOT).toBeUndefined();
    expect(env.LYRA_ARIA2_COMPONENT_VERSION).toBeUndefined();
  });

  test("binds the repository aria2 bundle as an explicit development-only fallback", async () => {
    const root = await createRoot();
    const resourcesPath = path.join(root, "resources");
    const targetId = process.platform === "win32"
      ? `win32-${process.arch}`
      : `${process.platform}-${process.arch}`;
    const bundleRoot = path.join(resourcesPath, "aria2", targetId);
    const binaryRelative = process.platform === "win32" ? "aria2c.exe" : "bin/aria2c";
    const binaryPath = path.join(bundleRoot, ...binaryRelative.split("/"));
    await mkdir(path.dirname(binaryPath), { recursive: true });
    await writeFile(binaryPath, "development aria2 fixture");
    if (process.platform !== "win32") await chmod(binaryPath, 0o755);
    const digest = createHash("sha256")
      .update("development aria2 fixture")
      .digest("hex");
    await writeFile(path.join(bundleRoot, "manifest.json"), JSON.stringify({
      bundleVersion: "aria2-development-test",
      target: targetId,
      binary: binaryRelative,
      source: "test",
      files: [{ path: binaryRelative, sha256: digest, executable: true }]
    }));
    const manager = {
      resolveActive: vi.fn(async () => null),
      assertHealthy: vi.fn(async () => undefined)
    };
    const env: NodeJS.ProcessEnv = {};

    const result = await applyRuntimeResourceComponentEnvironment({
      manager: manager as never,
      componentsRoot: path.join(root, "components"),
      developmentFallback: true,
      resourcesPath,
      cwd: root,
      env
    });

    expect(env.LYRA_RESOURCE_COMPONENT_MODE).toBe("development-fallback");
    expect(env.LYRA_ARIA2_BINARY).toBe(binaryPath);
    expect(env.LYRA_ARIA2_BINARY_SHA256).toBe(digest);
    expect(env.LYRA_ARIA2_COMPONENT_ROOT).toBe(bundleRoot);
    expect(env.LYRA_ARIA2_COMPONENT_VERSION).toBe("aria2-development-test");
    expect(env.LYRA_ARIA2_TRUST).toBe("development-bundle-v1");
    expect(result.resources.find(
      ({ componentId }) => componentId === "lyra.resource.aria2"
    )).toMatchObject({ source: "development-fallback", runtimePath: binaryPath });
  });

  test("fails closed when the signed manifest does not bind the aria2 binary", async () => {
    const resource = {
      componentId: "lyra.resource.aria2",
      version: "1.0.0",
      installedAt: "2026-07-31T00:00:00.000Z",
      rootPath: path.join("/signed", "aria2"),
      entryPath: path.join("/signed", "aria2", "manifest.json"),
      runtimePath: path.join("/signed", "aria2", "bin", "aria2c"),
      family: "aria2" as const,
      manifest: { files: [] } as unknown as ComponentManifestV1
    };
    const manager = {
      resolveActive: vi.fn(async (componentId: string) =>
        componentId === resource.componentId ? resource : null),
      assertHealthy: vi.fn(async () => undefined)
    };
    const env: NodeJS.ProcessEnv = {};

    const result = await applyRuntimeResourceComponentEnvironment({
      manager: manager as never,
      componentsRoot: "/components",
      developmentFallback: false,
      env
    });

    expect(env.LYRA_ARIA2_BINARY).toBe(
      path.join("/components", "lyra.resource.aria2", ".missing")
    );
    expect(env.LYRA_ARIA2_TRUST).toBeUndefined();
    expect(result.resources.find(
      ({ componentId }) => componentId === resource.componentId
    )?.error).toContain("signed component manifest");
  });
});
