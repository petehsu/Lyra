import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  canonicalReleaseKeyringPayloadV1,
  type SignedReleaseKeyringV1
} from "@lyra/app-runtime";
import { afterEach, describe, expect, test } from "vitest";

import { readTrustedComponentRoots, readVerifiedReleaseKeys } from "./trust";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const makeTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-trust-test-"));
  tempRoots.push(root);
  return root;
};

const rawPublicKey = (key: KeyObject): string => {
  const der = key.export({ format: "der", type: "spki" }) as Buffer;
  return der.subarray(-32).toString("base64");
};

const createKeyring = ({
  sequence,
  rootPrivateKey,
  releasePublicKey,
  revokedKeyIds = []
}: {
  readonly sequence: number;
  readonly rootPrivateKey: KeyObject;
  readonly releasePublicKey: KeyObject;
  readonly revokedKeyIds?: readonly string[];
}): SignedReleaseKeyringV1 => {
  const value: SignedReleaseKeyringV1 = {
    schemaVersion: 1,
    payload: {
      sequence,
      generatedAt: "2026-07-30T00:00:00.000Z",
      expiresAt: "2027-07-30T00:00:00.000Z",
      keys: [{
        keyId: "release-preview-1",
        publicKey: rawPublicKey(releasePublicKey),
        publisher: "Lyra",
        channels: ["preview"],
        componentKinds: ["core", "runtime", "app", "resource", "extension"],
        componentIdPrefixes: ["lyra."],
        executionClasses: [
          "first-party-shared-renderer",
          "sandboxed-web",
          "sandboxed-web-wasi"
        ],
        validFrom: "2026-07-29T00:00:00.000Z",
        validUntil: "2027-07-29T00:00:00.000Z"
      }],
      revokedKeyIds
    },
    signature: {
      algorithm: "ed25519",
      keyId: "root-1",
      value: "A".repeat(86) + "=="
    }
  };
  return {
    ...value,
    signature: {
      ...value.signature,
      value: sign(
        null,
        Buffer.from(canonicalReleaseKeyringPayloadV1(value), "utf8"),
        rootPrivateKey
      ).toString("base64")
    }
  };
};

const persistKeyring = async (
  systemRoot: string,
  keyring: SignedReleaseKeyringV1,
  suffix = createHash("sha256").update(JSON.stringify(keyring)).digest("hex")
): Promise<void> => {
  const directory = path.join(systemRoot, "trust-v1");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `keyring-${String(keyring.payload.sequence).padStart(20, "0")}-${suffix}.json`),
    `${JSON.stringify(keyring)}\n`
  );
};

const persistBootstrapSequence = async (
  systemRoot: string,
  keyringSequence: number
): Promise<void> => {
  const directory = path.join(systemRoot, "registry-v1");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(
      directory,
      "registry-00000000000000000001-00000000-0000-4000-8000-000000000001.json"
    ),
    `${JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      keyringSequence,
      catalogSequence: 1,
      target: "darwin-arm64",
      components: {}
    })}\n`
  );
};

describe("persisted component release trust", () => {
  test("loads the highest persisted keyring sequence and ignores older state", async () => {
    const systemRoot = await makeTempRoot();
    const root = generateKeyPairSync("ed25519");
    const oldRelease = generateKeyPairSync("ed25519");
    const latestRelease = generateKeyPairSync("ed25519");
    await persistKeyring(systemRoot, createKeyring({
      sequence: 4,
      rootPrivateKey: root.privateKey,
      releasePublicKey: oldRelease.publicKey
    }));
    await persistKeyring(systemRoot, createKeyring({
      sequence: 5,
      rootPrivateKey: root.privateKey,
      releasePublicKey: latestRelease.publicKey
    }));
    const roots = await readTrustedComponentRoots({
      filePath: path.join(systemRoot, "unused.json"),
      envJson: JSON.stringify({ schemaVersion: 1, roots: { "root-1": rawPublicKey(root.publicKey) } })
    });

    const verified = await readVerifiedReleaseKeys({ systemRoot, roots });

    expect(verified.keyringSequence).toBe(5);
    expect(verified.pem["release-preview-1"]).toBe(
      latestRelease.publicKey.export({ format: "pem", type: "spki" }).toString()
    );
    expect(verified.scopes["release-preview-1"]).toEqual({
      publisher: "Lyra",
      componentKinds: ["core", "runtime", "app", "resource", "extension"],
      componentIdPrefixes: ["lyra."],
      executionClasses: [
        "first-party-shared-renderer",
        "sandboxed-web",
        "sandboxed-web-wasi"
      ]
    });
  });

  test("removes revoked release keys from the active verifier set", async () => {
    const systemRoot = await makeTempRoot();
    const root = generateKeyPairSync("ed25519");
    const release = generateKeyPairSync("ed25519");
    await persistKeyring(systemRoot, createKeyring({
      sequence: 7,
      rootPrivateKey: root.privateKey,
      releasePublicKey: release.publicKey,
      revokedKeyIds: ["release-preview-1"]
    }));
    const roots = await readTrustedComponentRoots({
      filePath: path.join(systemRoot, "unused.json"),
      envJson: JSON.stringify({ schemaVersion: 1, roots: { "root-1": rawPublicKey(root.publicKey) } })
    });

    await expect(readVerifiedReleaseKeys({ systemRoot, roots })).resolves.toEqual({
      keyringSequence: 7,
      pem: {},
      scopes: {}
    });
  });

  test("rejects a keyring signed by a different root", async () => {
    const systemRoot = await makeTempRoot();
    const trustedRoot = generateKeyPairSync("ed25519");
    const attackerRoot = generateKeyPairSync("ed25519");
    const release = generateKeyPairSync("ed25519");
    await persistKeyring(systemRoot, createKeyring({
      sequence: 8,
      rootPrivateKey: attackerRoot.privateKey,
      releasePublicKey: release.publicKey
    }));
    const roots = await readTrustedComponentRoots({
      filePath: path.join(systemRoot, "unused.json"),
      envJson: JSON.stringify({
        schemaVersion: 1,
        roots: { "root-1": rawPublicKey(trustedRoot.publicKey) }
      })
    });

    await expect(readVerifiedReleaseKeys({ systemRoot, roots }))
      .rejects.toThrow("signature verification failed");
  });

  test("rejects duplicate files for the same keyring sequence", async () => {
    const systemRoot = await makeTempRoot();
    const root = generateKeyPairSync("ed25519");
    const release = generateKeyPairSync("ed25519");
    const keyring = createKeyring({
      sequence: 9,
      rootPrivateKey: root.privateKey,
      releasePublicKey: release.publicKey
    });
    await persistKeyring(systemRoot, keyring, "a".repeat(64));
    await persistKeyring(systemRoot, keyring, "b".repeat(64));
    const roots = await readTrustedComponentRoots({
      filePath: path.join(systemRoot, "unused.json"),
      envJson: JSON.stringify({ schemaVersion: 1, roots: { "root-1": rawPublicKey(root.publicKey) } })
    });

    await expect(readVerifiedReleaseKeys({ systemRoot, roots }))
      .rejects.toThrow("Multiple release keyrings have sequence 9");
  });

  test("rejects rollback below the sequence committed by bootstrap", async () => {
    const systemRoot = await makeTempRoot();
    const root = generateKeyPairSync("ed25519");
    const release = generateKeyPairSync("ed25519");
    await persistKeyring(systemRoot, createKeyring({
      sequence: 10,
      rootPrivateKey: root.privateKey,
      releasePublicKey: release.publicKey
    }));
    await persistBootstrapSequence(systemRoot, 11);
    const roots = await readTrustedComponentRoots({
      filePath: path.join(systemRoot, "unused.json"),
      envJson: JSON.stringify({ schemaVersion: 1, roots: { "root-1": rawPublicKey(root.publicKey) } })
    });

    await expect(readVerifiedReleaseKeys({ systemRoot, roots }))
      .rejects.toThrow("keyring downgrade rejected");
  });
});
