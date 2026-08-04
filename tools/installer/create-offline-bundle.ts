import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { archiveDirectory } from "../components/release-package.ts";

const argument = (name: string): string => {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
};

const assertDirectory = async (directory: string, label: string): Promise<void> => {
  const metadata = await stat(directory);
  if (!metadata.isDirectory()) {
    throw new Error(`${label} is not a directory: ${directory}`);
  }
};

const main = async (): Promise<void> => {
  const releaseRoot = path.resolve(argument("--release-root"));
  const catalog = path.resolve(argument("--catalog"));
  const output = path.resolve(argument("--out"));
  await assertDirectory(path.join(releaseRoot, "boms"), "BOM root");
  await assertDirectory(path.join(releaseRoot, "components"), "component root");
  if (!(await stat(catalog)).isFile()) {
    throw new Error(`Catalog is not a file: ${catalog}`);
  }

  const temporary = await mkdtemp(path.join(os.tmpdir(), "lyra-offline-bundle-"));
  try {
    const staging = path.join(temporary, "bundle");
    await mkdir(staging);
    await cp(catalog, path.join(staging, "catalog.json"), {
      errorOnExist: true,
      force: false
    });
    await cp(path.join(releaseRoot, "boms"), path.join(staging, "boms"), {
      recursive: true,
      errorOnExist: true,
      force: false
    });
    await cp(path.join(releaseRoot, "components"), path.join(staging, "components"), {
      recursive: true,
      errorOnExist: true,
      force: false
    });
    await mkdir(path.dirname(output), { recursive: true });
    await archiveDirectory(staging, output);
    const bytes = await readFile(output);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      path: output,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex")
    }, null, 2)}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`lyra-offline-bundle: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
