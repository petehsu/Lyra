import { createPublicKey, verify } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  canonicalReleaseKeyringPayloadV1,
  validateSignedReleaseKeyringV1,
  type ComponentExecutionClassV1,
  type ComponentKindV1,
  type SignedReleaseKeyringV1
} from "@lyra/app-runtime";
import { readBootstrapKeyringSequence } from "./registry";

export type TrustedComponentRoots = {
  readonly rawBase64: Readonly<Record<string, string>>;
  readonly pem: Readonly<Record<string, string>>;
};

export type VerifiedReleaseKeys = {
  readonly keyringSequence: number;
  readonly pem: Readonly<Record<string, string>>;
  readonly scopes: Readonly<Record<string, {
    readonly publisher: string;
    readonly componentKinds: readonly ComponentKindV1[];
    readonly componentIdPrefixes: readonly string[];
    readonly executionClasses: readonly ComponentExecutionClassV1[];
  }>>;
};

const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/u;
const KEYRING_FILE_PATTERN = /^keyring-(\d{20})-[a-f0-9]{64}\.json$/u;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const rawEd25519ToPem = (value: string): string => {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32) {
    throw new Error("An Ed25519 public key must contain 32 bytes.");
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, bytes]),
    format: "der",
    type: "spki"
  }).export({ format: "pem", type: "spki" }).toString();
};

const normalizeRoots = (value: unknown): TrustedComponentRoots => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Component trust store must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== 1
    || typeof raw.roots !== "object"
    || raw.roots === null
    || Array.isArray(raw.roots)
  ) {
    throw new Error("Component trust store schema is invalid.");
  }
  const rawBase64: Record<string, string> = {};
  const pem: Record<string, string> = {};
  for (const [keyId, publicKey] of Object.entries(raw.roots)) {
    if (!KEY_ID_PATTERN.test(keyId) || typeof publicKey !== "string") {
      throw new Error(`Invalid component root public key: ${keyId}`);
    }
    rawBase64[keyId] = publicKey;
    pem[keyId] = rawEd25519ToPem(publicKey);
  }
  return { rawBase64, pem };
};

export const readTrustedComponentRoots = async ({
  filePath,
  envJson
}: {
  readonly filePath: string;
  readonly envJson?: string;
}): Promise<TrustedComponentRoots> => {
  if (envJson !== undefined && envJson.trim().length > 0) {
    return normalizeRoots(JSON.parse(envJson) as unknown);
  }
  try {
    return normalizeRoots(JSON.parse(await readFile(filePath, "utf8")) as unknown);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      console.warn(`[lyra-components] no trusted component roots at ${filePath}; installs are disabled`);
      return { rawBase64: {}, pem: {} };
    }
    throw error;
  }
};

const verifyKeyring = (
  keyring: SignedReleaseKeyringV1,
  roots: TrustedComponentRoots
): VerifiedReleaseKeys => {
  const root = roots.pem[keyring.signature.keyId];
  if (root === undefined) {
    throw new Error(`Untrusted component root key: ${keyring.signature.keyId}`);
  }
  if (!verify(
    null,
    Buffer.from(canonicalReleaseKeyringPayloadV1(keyring), "utf8"),
    root,
    Buffer.from(keyring.signature.value, "base64")
  )) {
    throw new Error("Release keyring signature verification failed.");
  }
  const revoked = new Set(keyring.payload.revokedKeyIds);
  const pem: Record<string, string> = {};
  const scopes: Record<string, {
    readonly publisher: string;
    readonly componentKinds: readonly ComponentKindV1[];
    readonly componentIdPrefixes: readonly string[];
    readonly executionClasses: readonly ComponentExecutionClassV1[];
  }> = {};
  for (const key of keyring.payload.keys) {
    if (!revoked.has(key.keyId)) {
      pem[key.keyId] = rawEd25519ToPem(key.publicKey);
      scopes[key.keyId] = Object.freeze({
        publisher: key.publisher,
        componentKinds: Object.freeze([...key.componentKinds]),
        componentIdPrefixes: Object.freeze([...key.componentIdPrefixes]),
        executionClasses: Object.freeze([...key.executionClasses])
      });
    }
  }
  return { keyringSequence: keyring.payload.sequence, pem, scopes };
};

export const readVerifiedReleaseKeys = async ({
  systemRoot,
  roots
}: {
  readonly systemRoot: string;
  readonly roots: TrustedComponentRoots;
}): Promise<VerifiedReleaseKeys> => {
  const minimumSequence = await readBootstrapKeyringSequence(systemRoot);
  const directory = path.join(systemRoot, "trust-v1");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (minimumSequence > 0) {
        throw new Error(
          `Persisted release keyring is missing; sequence ${minimumSequence} is required.`
        );
      }
      return { keyringSequence: 0, pem: {}, scopes: {} };
    }
    throw error;
  }
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const match = KEYRING_FILE_PATTERN.exec(entry.name);
      return match === null
        ? null
        : { sequence: Number.parseInt(match[1] ?? "", 10), path: path.join(directory, entry.name) };
    })
    .filter((entry): entry is { readonly sequence: number; readonly path: string } => entry !== null)
    .sort((left, right) => right.sequence - left.sequence);
  const latest = candidates[0];
  if (latest === undefined) {
    if (minimumSequence > 0) {
      throw new Error(
        `Persisted release keyring is missing; sequence ${minimumSequence} is required.`
      );
    }
    return { keyringSequence: 0, pem: {}, scopes: {} };
  }
  if (candidates[1]?.sequence === latest.sequence) {
    throw new Error(`Multiple release keyrings have sequence ${latest.sequence}.`);
  }
  if (latest.sequence < minimumSequence) {
    throw new Error(
      `Persisted release keyring downgrade rejected: sequence ${latest.sequence} is below ${minimumSequence}.`
    );
  }
  const metadata = await lstat(latest.path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 2 * 1024 * 1024) {
    throw new Error("Persisted release keyring must be a bounded regular file.");
  }
  const parsed = JSON.parse(await readFile(latest.path, "utf8")) as unknown;
  if (!validateSignedReleaseKeyringV1(parsed)) {
    throw new Error("Persisted release keyring is invalid.");
  }
  if (parsed.payload.sequence !== latest.sequence) {
    throw new Error("Persisted release keyring sequence does not match its filename.");
  }
  return verifyKeyring(parsed, roots);
};
