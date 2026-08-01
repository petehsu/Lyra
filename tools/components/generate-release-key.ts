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
  const privateKeyPath = path.resolve(readArgument("--private-key"));
  const publicKeyPath = path.resolve(readArgument("--public-key"));
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  await Promise.all([
    mkdir(path.dirname(privateKeyPath), { recursive: true }),
    mkdir(path.dirname(publicKeyPath), { recursive: true })
  ]);
  await writeFile(
    privateKeyPath,
    privateKey.export({ type: "pkcs8", format: "pem" }),
    { flag: "wx", mode: 0o600 }
  );
  await writeFile(
    publicKeyPath,
    publicKey.export({ type: "spki", format: "pem" }),
    { flag: "wx", mode: 0o644 }
  );
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
