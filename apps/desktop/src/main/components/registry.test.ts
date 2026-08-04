import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  canonicalComponentManifestV1,
  type ComponentExecutionClassV1,
  type ComponentManifestV1,
  type ComponentTargetV1
} from "@lyra/app-runtime";
import { afterEach, describe, expect, test } from "vitest";

import { createComponentRegistryStore } from "./registry";
import type {
  BootstrapActivationRegistryV1,
  CanonicalActivationRegistryClient
} from "./bootstrap-registry-client";

const roots: string[] = [];
const releaseKeyScopes = {
  "test-release": {
    publisher: "Lyra",
    componentKinds: ["core", "runtime", "app", "resource", "extension"],
    componentIdPrefixes: ["lyra."],
    executionClasses: [
      "first-party-shared-renderer",
      "sandboxed-web",
      "sandboxed-web-wasi"
    ]
  }
} as const;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const currentTarget = (): ComponentTargetV1 => {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  return `${platform}-${process.arch}` as ComponentTargetV1;
};

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-component-test-"));
  roots.push(root);
  return root;
};

const createFixture = async ({
  root,
  version,
  privateKey,
  componentId = "lyra.images",
  executionClass = "first-party-shared-renderer",
  publisher = "Lyra"
}: {
  readonly root: string;
  readonly version: string;
  readonly privateKey: KeyObject;
  readonly componentId?: string;
  readonly executionClass?: ComponentExecutionClassV1;
  readonly publisher?: string;
}) => {
  const source = path.join(root, `source-${version}`);
  await mkdir(path.join(source, "payload"), { recursive: true });
  const entry = Buffer.from(`export default ${JSON.stringify(version)};\n`);
  await writeFile(path.join(source, "payload", "entry.js"), entry);
  const unsigned = {
    schemaVersion: 1,
    componentId,
    kind: "app",
    version,
    target: currentTarget(),
    entry: "payload/entry.js",
    executionClass,
    activation: "module-idle",
    hostApiRange: { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
    dataSchema: { readerMin: 1, readerMax: 1, writer: 1 },
    permissions: [],
    publisher,
    files: [{
      path: "payload/entry.js",
      size: entry.length,
      sha256: createHash("sha256").update(entry).digest("hex")
    }],
    keyId: "test-release"
  } as const;
  const manifest = {
    ...unsigned,
    signature: sign(
      null,
      Buffer.from(canonicalComponentManifestV1({ ...unsigned, signature: "AA==" } as ComponentManifestV1)),
      privateKey
    ).toString("base64")
  } satisfies ComponentManifestV1;
  await writeFile(path.join(source, "component.json"), `${JSON.stringify(manifest)}\n`);
  return source;
};

const writeBootstrapProjection = async (
  systemRoot: string,
  projection: BootstrapActivationRegistryV1
): Promise<void> => {
  const directory = path.join(systemRoot, "registry-v1");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(
      directory,
      `registry-${String(projection.revision).padStart(20, "0")}-${randomUUID()}.json`
    ),
    `${JSON.stringify(projection)}\n`
  );
};

describe("component registry", () => {
  test("enforces root-certified publisher and execution-class scopes", async () => {
    const root = await createRoot();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const sharedRenderer = await createFixture({
      root,
      version: "1.0.0",
      privateKey
    });
    const publicKeys = {
      "test-release": publicKey.export({ type: "spki", format: "pem" }).toString()
    };
    const sandboxOnly = createComponentRegistryStore({
      componentsRoot: path.join(root, "sandbox-only-components"),
      systemRoot: path.join(root, "sandbox-only-system"),
      publicKeys,
      releaseKeyScopes: {
        "test-release": {
          publisher: "Lyra",
          componentKinds: ["app"],
          componentIdPrefixes: ["lyra."],
          executionClasses: ["sandboxed-web", "sandboxed-web-wasi"]
        }
      }
    });
    await expect(sandboxOnly.installFromDirectory(sharedRenderer))
      .rejects.toThrow("not authorized for execution class first-party-shared-renderer");

    const sandboxed = await createFixture({
      root,
      version: "1.1.0",
      privateKey,
      executionClass: "sandboxed-web",
      publisher: "Example Publisher"
    });
    const wrongPublisher = createComponentRegistryStore({
      componentsRoot: path.join(root, "wrong-publisher-components"),
      systemRoot: path.join(root, "wrong-publisher-system"),
      publicKeys,
      releaseKeyScopes: {
        "test-release": {
          publisher: "Different Publisher",
          componentKinds: ["app"],
          componentIdPrefixes: ["lyra."],
          executionClasses: ["sandboxed-web"]
        }
      }
    });
    await expect(wrongPublisher.installFromDirectory(sandboxed))
      .rejects.toThrow("publisher is not authorized");

    const restrictedSandbox = createComponentRegistryStore({
      componentsRoot: path.join(root, "sandbox-allowed-components"),
      systemRoot: path.join(root, "sandbox-allowed-system"),
      publicKeys,
      releaseKeyScopes: {
        "test-release": {
          publisher: "Example Publisher",
          componentKinds: ["app"],
          componentIdPrefixes: ["example."],
          executionClasses: ["sandboxed-web"]
        }
      }
    });
    await expect(restrictedSandbox.installFromDirectory(sandboxed))
      .rejects.toThrow("not authorized for component ID lyra.images");

    const ownNamespace = await createFixture({
      root,
      version: "1.2.0",
      privateKey,
      componentId: "example.notes",
      executionClass: "sandboxed-web",
      publisher: "Example Publisher"
    });
    await expect(restrictedSandbox.installFromDirectory(ownNamespace)).resolves.toMatchObject({
      componentId: "example.notes",
      pending: "1.2.0"
    });
  });

  test("accepts every component id allowed by ComponentManifestV1", async () => {
    const root = await createRoot();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const source = await createFixture({
      root,
      version: "1.0.0",
      privateKey,
      componentId: "lyra.resource_pack"
    });
    const store = createComponentRegistryStore({
      componentsRoot: path.join(root, "components"),
      systemRoot: path.join(root, "system"),
      publicKeys: {
        "test-release": publicKey.export({ type: "spki", format: "pem" }).toString()
      },
      releaseKeyScopes,
      allowLocalActivation: true
    });

    await expect(store.installFromDirectory(source)).resolves.toMatchObject({
      componentId: "lyra.resource_pack",
      pending: "1.0.0"
    });
  });

  test("stages, activates and rolls back immutable component versions", async () => {
    const root = await createRoot();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const first = await createFixture({ root, version: "1.0.0", privateKey });
    const second = await createFixture({ root, version: "1.1.0", privateKey });
    const store = createComponentRegistryStore({
      componentsRoot: path.join(root, "components"),
      systemRoot: path.join(root, "system"),
      publicKeys: {
        "test-release": publicKey.export({ type: "spki", format: "pem" }).toString()
      },
      releaseKeyScopes,
      allowLocalActivation: true
    });
    expect(await store.installFromDirectory(first)).toMatchObject({
      pending: "1.0.0"
    });
    expect(await store.activate("lyra.images")).toMatchObject({
      active: "1.0.0"
    });
    expect(await store.installFromDirectory(second)).toMatchObject({
      active: "1.0.0",
      pending: "1.1.0"
    });
    expect(await store.activate("lyra.images")).toMatchObject({
      active: "1.1.0",
      previous: "1.0.0"
    });
    expect(await store.rollback("lyra.images")).toMatchObject({
      active: "1.0.0",
      previous: "1.1.0"
    });
  });

  test("keeps local activation fail-closed unless development explicitly enables it", async () => {
    const root = await createRoot();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const source = await createFixture({ root, version: "1.0.0", privateKey });
    const store = createComponentRegistryStore({
      componentsRoot: path.join(root, "components"),
      systemRoot: path.join(root, "system"),
      publicKeys: {
        "test-release": publicKey.export({ type: "spki", format: "pem" }).toString()
      },
      releaseKeyScopes
    });
    await store.installFromDirectory(source);

    await expect(store.activate("lyra.images"))
      .rejects.toThrow("Canonical activation registry is required");
  });

  test("atomically restores activation pointers after a failed coordinated switch", async () => {
    const root = await createRoot();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const first = await createFixture({ root, version: "1.0.0", privateKey });
    const second = await createFixture({ root, version: "1.1.0", privateKey });
    const store = createComponentRegistryStore({
      componentsRoot: path.join(root, "components"),
      systemRoot: path.join(root, "system"),
      publicKeys: {
        "test-release": publicKey.export({ type: "spki", format: "pem" }).toString()
      },
      releaseKeyScopes,
      allowLocalActivation: true
    });
    await store.installFromDirectory(first);
    await store.activate("lyra.images");
    const before = await store.installFromDirectory(second);

    await store.activate("lyra.images");
    await store.restoreActivation("lyra.images", {
      ...(before.active === undefined ? {} : { active: before.active }),
      ...(before.previous === undefined ? {} : { previous: before.previous }),
      ...(before.pending === undefined ? {} : { pending: before.pending })
    });

    expect(await store.read("lyra.images")).toMatchObject({
      active: "1.0.0",
      pending: "1.1.0"
    });
    expect((await store.read("lyra.images"))?.previous).toBeUndefined();
  });

  test("rejects catalog sequence rollback", async () => {
    const root = await createRoot();
    const { publicKey } = generateKeyPairSync("ed25519");
    const store = createComponentRegistryStore({
      componentsRoot: path.join(root, "components"),
      systemRoot: path.join(root, "system"),
      publicKeys: { "test-release": publicKey.export({ type: "spki", format: "pem" }).toString() },
      releaseKeyScopes,
      allowLocalActivation: true
    });
    await store.recordCatalogSequence("preview", 7);
    await expect(store.recordCatalogSequence("preview", 6)).rejects.toThrow("rollback rejected");
  });

  test("rejects tampered payloads before installation", async () => {
    const root = await createRoot();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const source = await createFixture({ root, version: "1.0.0", privateKey });
    await writeFile(path.join(source, "payload", "entry.js"), "tampered\n");
    const store = createComponentRegistryStore({
      componentsRoot: path.join(root, "components"),
      systemRoot: path.join(root, "system"),
      publicKeys: { "test-release": publicKey.export({ type: "spki", format: "pem" }).toString() },
      releaseKeyScopes
    });
    await expect(store.installFromDirectory(source)).rejects.toThrow(/size mismatch|digest mismatch/u);
  });

  test("rejects files that are not covered by the signed inventory", async () => {
    const root = await createRoot();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const source = await createFixture({ root, version: "1.0.0", privateKey });
    await writeFile(path.join(source, "payload", "undeclared.js"), "unexpected\n");
    const store = createComponentRegistryStore({
      componentsRoot: path.join(root, "components"),
      systemRoot: path.join(root, "system"),
      publicKeys: { "test-release": publicKey.export({ type: "spki", format: "pem" }).toString() },
      releaseKeyScopes
    });
    await expect(store.installFromDirectory(source)).rejects.toThrow("undeclared or missing files");
  });

  test("repairs a damaged immutable installation from the same signed package", async () => {
    const root = await createRoot();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const source = await createFixture({ root, version: "1.0.0", privateKey });
    const store = createComponentRegistryStore({
      componentsRoot: path.join(root, "components"),
      systemRoot: path.join(root, "system"),
      publicKeys: { "test-release": publicKey.export({ type: "spki", format: "pem" }).toString() },
      releaseKeyScopes
    });
    await store.installFromDirectory(source);
    const installedEntry = path.join(
      root,
      "components",
      "lyra.images",
      "1.0.0",
      currentTarget(),
      "payload",
      "entry.js"
    );
    await writeFile(installedEntry, "damaged\n");

    await store.installFromDirectory(source);

    expect(await readFile(installedEntry, "utf8")).toBe('export default "1.0.0";\n');
  });

  test("re-verifies a pending version immediately before activation", async () => {
    const root = await createRoot();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const first = await createFixture({ root, version: "1.0.0", privateKey });
    const second = await createFixture({ root, version: "1.1.0", privateKey });
    const store = createComponentRegistryStore({
      componentsRoot: path.join(root, "components"),
      systemRoot: path.join(root, "system"),
      publicKeys: { "test-release": publicKey.export({ type: "spki", format: "pem" }).toString() },
      releaseKeyScopes,
      allowLocalActivation: true
    });
    await store.installFromDirectory(first);
    await store.activate("lyra.images");
    await store.installFromDirectory(second);
    await writeFile(path.join(
      root,
      "components",
      "lyra.images",
      "1.1.0",
      currentTarget(),
      "payload",
      "entry.js"
    ), "tampered\n");

    await expect(store.activate("lyra.images")).rejects.toThrow(/size mismatch|digest mismatch/u);
    expect(await store.read("lyra.images")).toMatchObject({
      active: "1.0.0",
      pending: "1.1.0"
    });
  });

  test("imports the latest atomic bootstrap activation projection", async () => {
    const root = await createRoot();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const source = await createFixture({ root, version: "1.0.0", privateKey });
    const componentsRoot = path.join(root, "components");
    const installedRoot = path.join(
      componentsRoot,
      "lyra.images",
      "1.0.0",
      currentTarget()
    );
    await mkdir(path.dirname(installedRoot), { recursive: true });
    await cp(source, installedRoot, { recursive: true });
    await writeFile(path.join(installedRoot, ".lyra-component.v1.json"), "{}\n");
    const systemRoot = path.join(root, "system");
    const bootstrapRegistryRoot = path.join(systemRoot, "registry-v1");
    await mkdir(bootstrapRegistryRoot, { recursive: true });
    await writeFile(
      path.join(
        bootstrapRegistryRoot,
        "registry-00000000000000000001-00000000-0000-4000-8000-000000000001.json"
      ),
      `${JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        keyringSequence: 5,
        catalogSequence: 17,
        target: currentTarget(),
        activeReleaseVersion: "1.0.0",
        components: {
          "lyra.images": { active: "1.0.0" }
        }
      })}\n`
    );
    const store = createComponentRegistryStore({
      componentsRoot,
      systemRoot,
      publicKeys: { "test-release": publicKey.export({ type: "spki", format: "pem" }).toString() },
      releaseKeyScopes
    });

    expect(await store.read("lyra.images")).toMatchObject({
      componentId: "lyra.images",
      active: "1.0.0"
    });
    const persisted = JSON.parse(
      await readFile(path.join(systemRoot, "registry.v1.json"), "utf8")
    ) as {
      bootstrapRevision: number;
      highestKeyringSequence: { bootstrap: number };
      highestCatalogSequence: { bootstrap: number };
    };
    expect(persisted.bootstrapRevision).toBe(1);
    expect(persisted.highestKeyringSequence.bootstrap).toBe(5);
    expect(persisted.highestCatalogSequence.bootstrap).toBe(17);
  });

  test("commits Desktop activation through the canonical helper and retains it on a later read", async () => {
    const root = await createRoot();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const componentsRoot = path.join(root, "components");
    const systemRoot = path.join(root, "system");
    for (const version of ["1.0.0", "1.1.0"]) {
      const source = await createFixture({ root, version, privateKey });
      const installedRoot = path.join(
        componentsRoot,
        "lyra.images",
        version,
        currentTarget()
      );
      await mkdir(path.dirname(installedRoot), { recursive: true });
      await cp(source, installedRoot, { recursive: true });
      await writeFile(path.join(installedRoot, ".lyra-component.v1.json"), "{}\n");
    }
    const localOnlySource = await createFixture({ root, version: "1.2.0", privateKey });
    const staged = {
      schemaVersion: 1,
      revision: 1,
      keyringSequence: 5,
      catalogSequence: 17,
      target: currentTarget(),
      activeReleaseVersion: "1.0.0",
      pendingReleaseVersion: "1.1.0",
      components: {
        "lyra.images": {
          active: "1.0.0",
          pending: "1.1.0"
        }
      }
    } satisfies BootstrapActivationRegistryV1;
    await writeBootstrapProjection(systemRoot, staged);
    let projection = staged as BootstrapActivationRegistryV1;
    const history = new Map<number, BootstrapActivationRegistryV1>([
      [staged.revision, staged]
    ]);
    const canonicalActivationRegistry: CanonicalActivationRegistryClient = {
      read: async () => projection,
      readRevision: async (revision) => {
        const selected = history.get(revision);
        if (selected === undefined) {
          throw new Error(`missing revision ${revision}`);
        }
        return selected;
      },
      activate: async (request) => {
        expect(request).toEqual({
          componentId: "lyra.images",
          expectedRevision: 1,
          expectedPending: "1.1.0"
        });
        const { pendingReleaseVersion: _pendingRelease, ...withoutPendingRelease } = projection;
        projection = {
          ...withoutPendingRelease,
          revision: 2,
          activeReleaseVersion: "1.1.0",
          components: {
            ...projection.components,
            "lyra.images": {
              active: "1.1.0",
              previous: "1.0.0"
            }
          }
        };
        history.set(projection.revision, projection);
        await writeBootstrapProjection(systemRoot, projection);
        return projection;
      },
      rollback: async () => {
        throw new Error("unexpected rollback");
      },
      restore: async () => {
        throw new Error("unexpected restore");
      }
    };
    const publicKeys = {
      "test-release": publicKey.export({ type: "spki", format: "pem" }).toString()
    };
    const store = createComponentRegistryStore({
      componentsRoot,
      systemRoot,
      publicKeys,
      releaseKeyScopes,
      canonicalActivationRegistry
    });

    await expect(store.installFromDirectory(localOnlySource)).resolves.toMatchObject({
      active: "1.0.0",
      pending: "1.1.0"
    });
    await expect(store.activate("lyra.images")).resolves.toMatchObject({
      active: "1.1.0",
      previous: "1.0.0"
    });

    const laterProcess = createComponentRegistryStore({
      componentsRoot,
      systemRoot,
      publicKeys,
      releaseKeyScopes
    });
    await expect(laterProcess.read("lyra.images")).resolves.toMatchObject({
      active: "1.1.0",
      previous: "1.0.0"
    });
    const cached = JSON.parse(
      await readFile(path.join(systemRoot, "registry.v1.json"), "utf8")
    ) as { bootstrapRevision: number };
    expect(cached.bootstrapRevision).toBe(2);
  });

  test("refuses to change canonical pointers without an injected helper", async () => {
    const root = await createRoot();
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const source = await createFixture({ root, version: "1.1.0", privateKey });
    const componentsRoot = path.join(root, "components");
    const installedRoot = path.join(
      componentsRoot,
      "lyra.images",
      "1.1.0",
      currentTarget()
    );
    await mkdir(path.dirname(installedRoot), { recursive: true });
    await cp(source, installedRoot, { recursive: true });
    await writeFile(path.join(installedRoot, ".lyra-component.v1.json"), "{}\n");
    const systemRoot = path.join(root, "system");
    await writeBootstrapProjection(systemRoot, {
      schemaVersion: 1,
      revision: 1,
      keyringSequence: 1,
      catalogSequence: 1,
      target: currentTarget(),
      pendingReleaseVersion: "1.1.0",
      components: { "lyra.images": { pending: "1.1.0" } }
    });
    const store = createComponentRegistryStore({
      componentsRoot,
      systemRoot,
      publicKeys: {
        "test-release": publicKey.export({ type: "spki", format: "pem" }).toString()
      },
      releaseKeyScopes
    });

    await expect(store.activate("lyra.images"))
      .rejects.toThrow("Canonical activation registry helper is unavailable");
  });

  test("rejects malformed bootstrap component pointers", async () => {
    const root = await createRoot();
    const { publicKey } = generateKeyPairSync("ed25519");
    const systemRoot = path.join(root, "system");
    const bootstrapRegistryRoot = path.join(systemRoot, "registry-v1");
    await mkdir(bootstrapRegistryRoot, { recursive: true });
    await writeFile(
      path.join(
        bootstrapRegistryRoot,
        "registry-00000000000000000001-00000000-0000-4000-8000-000000000001.json"
      ),
      `${JSON.stringify({
        schemaVersion: 1,
        revision: 1,
        keyringSequence: 5,
        catalogSequence: 17,
        target: currentTarget(),
        components: {
          "lyra.images": { active: 1 }
        }
      })}\n`
    );
    const store = createComponentRegistryStore({
      componentsRoot: path.join(root, "components"),
      systemRoot,
      publicKeys: { "test-release": publicKey.export({ type: "spki", format: "pem" }).toString() },
      releaseKeyScopes
    });

    await expect(store.list()).rejects.toThrow("Bootstrap activation pointer is invalid");
  });
});
