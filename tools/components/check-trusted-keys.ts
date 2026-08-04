import { createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const main = async (): Promise<void> => {
  const trustStorePath = path.resolve(
    process.cwd(),
    "apps/desktop/resources/component-trust/trusted-keys.json"
  );
  const parsed = JSON.parse(await readFile(trustStorePath, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Component trust store must be an object.");
  }
  const value = parsed as Record<string, unknown>;
  if (
    value.schemaVersion !== 1
    || typeof value.roots !== "object"
    || value.roots === null
    || Array.isArray(value.roots)
  ) {
    throw new Error("Component trust store schema is invalid.");
  }

  const entries = Object.entries(value.roots as Record<string, unknown>);
  if (entries.length === 0) {
    throw new Error(
      "No offline component root public key is configured. Generate the root key outside the repository, commit only its public key, and rerun this release gate."
    );
  }
  for (const [keyId, publicKey] of entries) {
    if (!/^[A-Za-z0-9._-]{1,64}$/u.test(keyId) || typeof publicKey !== "string") {
      throw new Error(`Invalid component release key entry: ${keyId}`);
    }
    const bytes = Buffer.from(publicKey, "base64");
    if (bytes.length !== 32) {
      throw new Error(`Component root public key must contain 32 bytes: ${keyId}`);
    }
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const key = createPublicKey({ key: Buffer.concat([spkiPrefix, bytes]), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error(`Component release key must be Ed25519: ${keyId}`);
    }
  }

  console.info(`Validated ${entries.length} offline component root public key(s).`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
