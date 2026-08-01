import { generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const readArgument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
};

const main = async (): Promise<void> => {
  const keyId = readArgument("--key-id");
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(keyId)) {
    throw new Error("Key ID is invalid.");
  }
  const privateKeyPath = path.resolve(readArgument("--private-key"));
  const trustStorePath = path.resolve(readArgument("--trust-store"));
  const rawPublicKeyPath = path.resolve(readArgument("--raw-public-key"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const rawPublicKey = publicDer.subarray(publicDer.length - 32).toString("base64");
  await Promise.all([
    mkdir(path.dirname(privateKeyPath), { recursive: true }),
    mkdir(path.dirname(trustStorePath), { recursive: true }),
    mkdir(path.dirname(rawPublicKeyPath), { recursive: true })
  ]);
  await writeFile(privateKeyPath, privatePem, { flag: "wx", mode: 0o600 });
  await writeFile(trustStorePath, `${JSON.stringify({
    schemaVersion: 1,
    roots: { [keyId]: rawPublicKey }
  }, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  await writeFile(rawPublicKeyPath, `${rawPublicKey}\n`, { flag: "wx", mode: 0o644 });
  process.stdout.write(`Generated ${keyId}. Keep ${privateKeyPath} outside source control.\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(`lyra-signing-key: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
