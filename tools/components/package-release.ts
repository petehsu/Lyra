import path from "node:path";
import { readFile } from "node:fs/promises";

import type { ComponentTargetV1, SignedReleaseKeyringV1 } from "../../packages/app-runtime/src/index.ts";

import { authenticatePreviousChannelRelease } from "./channel-promotion.ts";
import { packageRelease, readReleasePrivateKey } from "./release-package.ts";

const TARGETS = new Set<string>([
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
  "linux-x64",
  "linux-arm64"
]);

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
  const previousBomPath = readOptionalArgument("--previous-bom");
  const previousCatalogPath = readOptionalArgument("--previous-catalog");
  if ((previousBomPath === undefined) !== (previousCatalogPath === undefined)) {
    throw new Error("--previous-bom and --previous-catalog must be supplied together.");
  }
  const previous = previousBomPath === undefined || previousCatalogPath === undefined
    ? undefined
    : await (async () => {
      const specIdentity = JSON.parse(await readFile(specPath, "utf8")) as {
        readonly channel?: unknown;
        readonly target?: unknown;
      };
      if (specIdentity.channel !== "preview" && specIdentity.channel !== "stable") {
        throw new Error("Release package spec channel is invalid.");
      }
      if (typeof specIdentity.target !== "string" || !TARGETS.has(specIdentity.target)) {
        throw new Error("Release package spec target is invalid.");
      }
      return authenticatePreviousChannelRelease({
        catalogValue: JSON.parse(await readFile(path.resolve(previousCatalogPath), "utf8")),
        bomBytes: await readFile(path.resolve(previousBomPath)),
        channel: specIdentity.channel,
        target: specIdentity.target as ComponentTargetV1,
        trustedRoots: trustStore.roots
      });
    })();
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
    })(),
    ...(previous === undefined
      ? {}
      : {
        previousBom: previous.bom,
        previousSequence: previous.catalog.payload.sequence
      })
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

main().catch((error: unknown) => {
  process.stderr.write(`lyra-component-release: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
