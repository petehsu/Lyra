import path from "node:path";
import { readFile } from "node:fs/promises";

import type { SignedReleaseKeyringV1 } from "../../packages/app-runtime/src/index.ts";

import { packageRelease, readReleasePrivateKey } from "./release-package.ts";

const readArgument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
};

const readOptionalArgument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
};

const main = async (): Promise<void> => {
  const specPath = path.resolve(readArgument("--spec"));
  const outputRoot = path.resolve(readArgument("--out"));
  const releasePrivateKeyPath = path.resolve(readArgument("--release-private-key"));
  const keyring = JSON.parse(
    await readFile(path.resolve(readArgument("--keyring")), "utf8")
  ) as SignedReleaseKeyringV1;
  const trustStore = JSON.parse(
    await readFile(path.resolve(readArgument("--trust-store")), "utf8")
  ) as { readonly roots?: Readonly<Record<string, string>> };
  if (trustStore.roots === undefined) {
    throw new Error("Component trust store has no roots.");
  }
  const report = await packageRelease({
    specPath,
    outputRoot,
    baseUrl: readArgument("--base-url"),
    releasePrivateKey: await readReleasePrivateKey(releasePrivateKeyPath),
    keyring,
    trustedRoots: trustStore.roots,
    assetLayout: (() => {
      const value = readOptionalArgument("--asset-layout") ?? "directory";
      if (value !== "directory" && value !== "flat") {
        throw new Error("--asset-layout must be directory or flat");
      }
      return value;
    })()
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(`lyra-component-release: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
