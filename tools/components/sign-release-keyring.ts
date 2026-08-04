import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalReleaseKeyringPayloadV1,
  validateSignedReleaseKeyringV1,
  type ComponentChannelV1,
  type ComponentExecutionClassV1,
  type ComponentKindV1,
  type SignedReleaseKeyringV1
} from "../../packages/app-runtime/src/index.ts";

const readArgument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
};

const EXECUTION_CLASSES = new Set<ComponentExecutionClassV1>([
  "first-party-shared-renderer",
  "sandboxed-web",
  "sandboxed-web-wasi"
]);
const COMPONENT_KINDS = new Set<ComponentKindV1>([
  "core",
  "runtime",
  "app",
  "resource",
  "extension"
]);
const COMPONENT_ID_PREFIX_PATTERN = /^[a-z0-9._-]{1,128}$/u;

const main = async (): Promise<void> => {
  const rootKeyId = readArgument("--root-key-id");
  const releaseKeyId = readArgument("--release-key-id");
  const channels = readArgument("--channels").split(",") as ComponentChannelV1[];
  const rawComponentKinds = readArgument("--component-kinds").split(",");
  const componentKinds = rawComponentKinds.filter(
    (value): value is ComponentKindV1 => COMPONENT_KINDS.has(value as ComponentKindV1)
  );
  if (
    componentKinds.length === 0
    || componentKinds.length !== rawComponentKinds.length
    || new Set(componentKinds).size !== componentKinds.length
  ) {
    throw new Error("Invalid or duplicate --component-kinds value.");
  }
  const componentIdPrefixes = readArgument("--component-id-prefixes").split(",");
  if (
    componentIdPrefixes.length === 0
    || componentIdPrefixes.some((prefix) => !COMPONENT_ID_PREFIX_PATTERN.test(prefix))
    || new Set(componentIdPrefixes).size !== componentIdPrefixes.length
  ) {
    throw new Error("Invalid or duplicate --component-id-prefixes value.");
  }
  const rawExecutionClasses = readArgument("--execution-classes").split(",");
  const executionClasses = rawExecutionClasses
    .filter((value): value is ComponentExecutionClassV1 =>
      EXECUTION_CLASSES.has(value as ComponentExecutionClassV1)
    );
  if (
    executionClasses.length !== rawExecutionClasses.length
    || new Set(executionClasses).size !== executionClasses.length
  ) {
    throw new Error("Invalid or duplicate --execution-classes value.");
  }
  const generatedAt = readArgument("--generated-at");
  const expiresAt = readArgument("--expires-at");
  const sequence = Number.parseInt(readArgument("--sequence"), 10);
  const rootPrivateKey = createPrivateKey(
    await readFile(path.resolve(readArgument("--root-private-key")))
  );
  const releasePublicKey = createPublicKey(
    await readFile(path.resolve(readArgument("--release-public-key")))
  );
  const publicDer = releasePublicKey.export({ type: "spki", format: "der" });
  const payload: SignedReleaseKeyringV1["payload"] = {
    sequence,
    generatedAt,
    expiresAt,
    keys: [{
      keyId: releaseKeyId,
      publicKey: publicDer.subarray(publicDer.length - 32).toString("base64"),
      publisher: readArgument("--publisher"),
      channels,
      componentKinds,
      componentIdPrefixes,
      executionClasses,
      validFrom: generatedAt,
      validUntil: expiresAt
    }],
    revokedKeyIds: []
  };
  const unsigned: SignedReleaseKeyringV1 = {
    schemaVersion: 1,
    payload,
    signature: { algorithm: "ed25519", keyId: rootKeyId, value: Buffer.alloc(64).toString("base64") }
  };
  const keyring: SignedReleaseKeyringV1 = {
    ...unsigned,
    signature: {
      ...unsigned.signature,
      value: sign(
        null,
        Buffer.from(canonicalReleaseKeyringPayloadV1(unsigned)),
        rootPrivateKey
      ).toString("base64")
    }
  };
  if (!validateSignedReleaseKeyringV1(keyring)) {
    throw new Error("Generated release keyring is invalid.");
  }
  const output = path.resolve(readArgument("--out"));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(keyring, null, 2)}\n`, { flag: "wx", mode: 0o644 });
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
