import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ComponentManifestV1 } from "@lyra/app-runtime";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  ComponentRegistryStore,
  InstalledComponentV1,
  InstalledComponentVersionV1
} from "../../components";
import type { ThirdPartyAppHost, ThirdPartyAppHostOptions } from "../host";
import {
  createThirdPartyAppLifecycleService,
  type ThirdPartyAppHostFactory
} from "../lifecycle";
import type {
  ThirdPartyWasiRunnerService,
  ThirdPartyWasiRunRequest,
  ThirdPartyWasiRunResult
} from "../wasi-runner";

const temporaryRoots: string[] = [];
const TARGET = "darwin-arm64" as const;
const APP_ID = "example.notes";

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const createVersion = async ({
  componentsRoot,
  version,
  executionClass = "sandboxed-web-wasi",
  permissions = [
    "network",
    "wasi:app-data.read",
    "wasi:temp.write"
  ],
  html = `<!doctype html><title>${version}</title>`
}: {
  readonly componentsRoot: string;
  readonly version: string;
  readonly executionClass?: ComponentManifestV1["executionClass"];
  readonly permissions?: readonly string[];
  readonly html?: string;
}): Promise<InstalledComponentVersionV1> => {
  const root = path.join(componentsRoot, APP_ID, version, TARGET);
  await mkdir(root, { recursive: true });
  const wasm = `component-${version}`;
  await writeFile(path.join(root, "index.html"), html);
  await writeFile(path.join(root, "backend.wasm"), wasm);
  return {
    installedAt: "2026-07-31T00:00:00.000Z",
    target: TARGET,
    manifest: {
      schemaVersion: 1,
      componentId: APP_ID,
      kind: "app",
      version,
      target: TARGET,
      entry: "index.html",
      executionClass,
      activation: "module-idle",
      hostApiRange: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
      dataSchema: { readerMin: 1, readerMax: 1, writer: 1 },
      permissions,
      publisher: "Example Publisher",
      files: [
        { path: "index.html", size: Buffer.byteLength(html), sha256: sha256(html) },
        { path: "backend.wasm", size: Buffer.byteLength(wasm), sha256: sha256(wasm) }
      ],
      keyId: "example-release-key",
      signature: "A".repeat(86) + "=="
    }
  };
};

const createFixture = async (): Promise<{
  readonly componentsRoot: string;
  readonly dataRoot: string;
  readonly temporaryRoot: string;
  readonly component: () => InstalledComponentV1;
  readonly setComponent: (value: InstalledComponentV1) => void;
  readonly registry: ComponentRegistryStore;
  readonly hostFactory: ThirdPartyAppHostFactory;
  readonly hostOptions: ThirdPartyAppHostOptions[];
  readonly hosts: Array<{
    readonly load: ReturnType<typeof vi.fn>;
    readonly dispose: ReturnType<typeof vi.fn>;
  }>;
  readonly wasiRunner: ThirdPartyWasiRunnerService;
  readonly wasiRequests: ThirdPartyWasiRunRequest[];
}> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-third-party-lifecycle-"));
  temporaryRoots.push(root);
  const componentsRoot = path.join(root, "components");
  const dataRoot = path.join(root, "data");
  const temporaryRoot = path.join(root, "temporary");
  await Promise.all([
    mkdir(componentsRoot, { recursive: true }),
    mkdir(dataRoot, { recursive: true }),
    mkdir(temporaryRoot, { recursive: true })
  ]);
  const v0 = await createVersion({ componentsRoot, version: "0.9.0" });
  const v1 = await createVersion({ componentsRoot, version: "1.0.0" });
  const v2 = await createVersion({ componentsRoot, version: "2.0.0" });
  let component: InstalledComponentV1 = {
    componentId: APP_ID,
    kind: "app",
    active: "1.0.0",
    previous: "0.9.0",
    pending: "2.0.0",
    versions: { "0.9.0": v0, "1.0.0": v1, "2.0.0": v2 }
  };
  const activate = vi.fn(async () => {
    const pending = component.pending;
    if (pending === undefined) {
      return component;
    }
    const next: InstalledComponentV1 = {
      ...component,
      active: pending,
      ...(component.active === undefined ? {} : { previous: component.active })
    };
    const { pending: _pending, ...withoutPending } = next;
    component = withoutPending;
    return component;
  });
  const rollback = vi.fn(async () => {
    const previous = component.previous;
    if (previous === undefined) {
      return component;
    }
    component = {
      ...component,
      active: previous,
      ...(component.active === undefined ? {} : { previous: component.active })
    };
    return component;
  });
  const uninstallVersion = vi.fn(async (_componentId: string, version: string) => {
    const { [version]: _removed, ...versions } = component.versions;
    component = { ...component, versions };
  });
  const verifyInstalledVersion = vi.fn(async (_componentId: string, version: string) => {
    const installed = component.versions[version];
    if (installed === undefined) {
      throw new Error("missing");
    }
    return installed;
  });
  const registry = {
    list: vi.fn(async () => [component]),
    read: vi.fn(async (componentId: string) => componentId === APP_ID ? component : null),
    verifyInstalledVersion,
    installFromDirectory: vi.fn(),
    activate,
    rollback,
    uninstallVersion,
    recordKeyringSequence: vi.fn(),
    recordCatalogSequence: vi.fn()
  } as unknown as ComponentRegistryStore;
  const hostOptions: ThirdPartyAppHostOptions[] = [];
  const hosts: Array<{
    readonly load: ReturnType<typeof vi.fn>;
    readonly dispose: ReturnType<typeof vi.fn>;
  }> = [];
  const hostFactory: ThirdPartyAppHostFactory = (options) => {
    hostOptions.push(options);
    const load = vi.fn(async () => undefined);
    const dispose = vi.fn();
    hosts.push({ load, dispose });
    return {
      view: {} as ThirdPartyAppHost["view"],
      partition: "lyra-test",
      load,
      setBounds: vi.fn(),
      setVisible: vi.fn(),
      dispose
    };
  };
  const wasiRequests: ThirdPartyWasiRunRequest[] = [];
  const wasiRunner: ThirdPartyWasiRunnerService = {
    run: vi.fn(async (request): Promise<ThirdPartyWasiRunResult> => {
      wasiRequests.push(request);
      return { status: "success" };
    })
  };
  return {
    componentsRoot,
    dataRoot,
    temporaryRoot,
    component: () => component,
    setComponent: (value) => {
      component = value;
    },
    registry,
    hostFactory,
    hostOptions,
    hosts,
    wasiRunner,
    wasiRequests
  };
};

describe("third-party application lifecycle", () => {
  test("opens only a verified active sandbox version with normalized data roots", async () => {
    const fixture = await createFixture();
    const service = await createThirdPartyAppLifecycleService({
      componentsRoot: fixture.componentsRoot,
      dataRoot: fixture.dataRoot,
      temporaryRoot: fixture.temporaryRoot,
      registryStore: fixture.registry,
      hostFactory: fixture.hostFactory,
      wasiRunner: fixture.wasiRunner,
      hostFeatureEnabled: true,
      wasiFeatureEnabled: true
    });

    const instance = await service.open({
      componentId: APP_ID,
      instanceId: "instance-1",
      networkOrigins: ["https://api.example.test"]
    });

    expect(instance.version).toBe("1.0.0");
    expect(service.references(APP_ID, "1.0.0")).toBe(1);
    expect(fixture.hostOptions[0]).toMatchObject({
      appId: APP_ID,
      instanceId: "instance-1",
      appRoot: await realpath(path.join(fixture.componentsRoot, APP_ID, "1.0.0", TARGET)),
      entryFile: await realpath(path.join(
        fixture.componentsRoot,
        APP_ID,
        "1.0.0",
        TARGET,
        "index.html"
      )),
      permissions: ["network"],
      networkOrigins: ["https://api.example.test"]
    });
    expect(instance.appDataRoot).toBe(await realpath(path.join(fixture.dataRoot, APP_ID)));
    await expect(instance.runWasi("backend.wasm")).resolves.toEqual({ status: "success" });
    expect(fixture.wasiRequests[0]).toMatchObject({
      componentPackageRoot: await realpath(path.join(
        fixture.componentsRoot,
        APP_ID,
        "1.0.0",
        TARGET
      )),
      expectedSha256: sha256("component-1.0.0"),
      appDataRoot: instance.appDataRoot,
      temporaryRoot: instance.temporaryRoot,
      permissions: ["wasi:app-data.read", "wasi:temp.write"]
    });

    await instance.close();
    expect(service.references(APP_ID, "1.0.0")).toBe(0);
    await expect(access(instance.temporaryRoot)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(instance.appDataRoot)).resolves.toBeUndefined();
    expect(fixture.hosts[0]?.dispose).toHaveBeenCalledOnce();
  });

  test("pins the active version until the final instance closes", async () => {
    const fixture = await createFixture();
    const service = await createThirdPartyAppLifecycleService({
      componentsRoot: fixture.componentsRoot,
      dataRoot: fixture.dataRoot,
      temporaryRoot: fixture.temporaryRoot,
      registryStore: fixture.registry,
      hostFactory: fixture.hostFactory,
      wasiRunner: fixture.wasiRunner,
      hostFeatureEnabled: true,
      wasiFeatureEnabled: true
    });
    const first = await service.open({ componentId: APP_ID, instanceId: "first" });
    const second = await service.open({ componentId: APP_ID, instanceId: "second" });

    await expect(service.activatePending(APP_ID)).resolves.toMatchObject({
      status: "deferred",
      component: { active: "1.0.0", pending: "2.0.0" }
    });
    const third = await service.open({ componentId: APP_ID, instanceId: "third" });
    expect(third.version).toBe("1.0.0");
    await first.close();
    await second.close();
    expect(fixture.component().active).toBe("1.0.0");
    await third.close();
    expect(fixture.component()).toMatchObject({ active: "2.0.0", previous: "1.0.0" });

    const next = await service.open({ componentId: APP_ID, instanceId: "next" });
    expect(next.version).toBe("2.0.0");
    await expect(service.rollback(APP_ID)).rejects.toThrow("running third-party application");
    await expect(service.uninstallVersion(APP_ID, "2.0.0")).rejects.toThrow("leased");
    await next.close();
    await expect(service.rollback(APP_ID)).resolves.toMatchObject({ active: "1.0.0" });
  });

  test("fails closed for shared-renderer, unknown permissions, and tampered entries", async () => {
    const fixture = await createFixture();
    const service = await createThirdPartyAppLifecycleService({
      componentsRoot: fixture.componentsRoot,
      dataRoot: fixture.dataRoot,
      temporaryRoot: fixture.temporaryRoot,
      registryStore: fixture.registry,
      hostFactory: fixture.hostFactory,
      wasiRunner: fixture.wasiRunner,
      hostFeatureEnabled: true,
      wasiFeatureEnabled: true
    });
    const original = fixture.component();
    const active = original.versions["1.0.0"]!;
    fixture.setComponent({
      ...original,
      versions: {
        ...original.versions,
        "1.0.0": {
          ...active,
          manifest: {
            ...active.manifest,
            executionClass: "first-party-shared-renderer"
          }
        }
      }
    });
    await expect(service.open({
      componentId: APP_ID,
      instanceId: "shared-renderer"
    })).rejects.toThrow("not authorized for third-party sandbox");

    fixture.setComponent({
      ...original,
      versions: {
        ...original.versions,
        "1.0.0": {
          ...active,
          manifest: { ...active.manifest, permissions: ["core:private"] }
        }
      }
    });
    await expect(service.open({
      componentId: APP_ID,
      instanceId: "unknown-permission"
    })).rejects.toThrow("Unsupported sandboxed application permission");

    fixture.setComponent({
      ...original,
      versions: {
        ...original.versions,
        "1.0.0": {
          ...active,
          manifest: { ...active.manifest, activation: "next-session" }
        }
      }
    });
    await expect(service.open({
      componentId: APP_ID,
      instanceId: "unsafe-activation"
    })).rejects.toThrow("must use module-idle activation");

    fixture.setComponent(original);
    const entry = path.join(
      fixture.componentsRoot,
      APP_ID,
      "1.0.0",
      TARGET,
      "index.html"
    );
    const contents = await readFile(entry, "utf8");
    await writeFile(entry, contents.replace("1.0.0", "9.9.9"));
    await expect(service.open({
      componentId: APP_ID,
      instanceId: "tampered"
    })).rejects.toThrow("differs from its signed inventory");
    expect(fixture.hostOptions).toHaveLength(0);
  });

  test("does not create temporary directories through a symbolic-link ancestor", async () => {
    if (process.platform === "win32") {
      return;
    }
    const fixture = await createFixture();
    const outside = path.join(path.dirname(fixture.temporaryRoot), "outside");
    await mkdir(outside);
    await symlink(outside, path.join(fixture.temporaryRoot, APP_ID), "dir");
    const service = await createThirdPartyAppLifecycleService({
      componentsRoot: fixture.componentsRoot,
      dataRoot: fixture.dataRoot,
      temporaryRoot: fixture.temporaryRoot,
      registryStore: fixture.registry,
      hostFactory: fixture.hostFactory,
      wasiRunner: fixture.wasiRunner,
      hostFeatureEnabled: true,
      wasiFeatureEnabled: true
    });

    await expect(service.open({
      componentId: APP_ID,
      instanceId: "symlink-ancestor"
    })).rejects.toThrow("real directories only");
    await expect(access(path.join(outside, "1.0.0"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(fixture.hostOptions).toHaveLength(0);
  });

  test("routes uninstallation through the registry and closes all leases on dispose", async () => {
    const fixture = await createFixture();
    const service = await createThirdPartyAppLifecycleService({
      componentsRoot: fixture.componentsRoot,
      dataRoot: fixture.dataRoot,
      temporaryRoot: fixture.temporaryRoot,
      registryStore: fixture.registry,
      hostFactory: fixture.hostFactory,
      wasiRunner: fixture.wasiRunner,
      hostFeatureEnabled: true,
      wasiFeatureEnabled: true
    });
    await service.uninstallVersion(APP_ID, "0.9.0");
    expect(fixture.registry.uninstallVersion).toHaveBeenCalledWith(APP_ID, "0.9.0");
    const instance = await service.open({ componentId: APP_ID, instanceId: "dispose-me" });
    await service.dispose();
    expect(service.references(APP_ID, instance.version)).toBe(0);
    expect(fixture.component()).toMatchObject({
      active: "1.0.0",
      pending: "2.0.0"
    });
    expect(fixture.registry.activate).not.toHaveBeenCalled();
    expect(fixture.hosts.at(-1)?.dispose).toHaveBeenCalledOnce();
    await expect(service.open({
      componentId: APP_ID,
      instanceId: "after-dispose"
    })).rejects.toThrow("disposed");
  });
});
