import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(siteRoot, "../..");
const sourcePath = path.join(
  repositoryRoot,
  "legal/generated/THIRD-PARTY-NOTICES.md"
);
const targetPath = path.join(
  siteRoot,
  "public/legal/third-party-notices.txt"
);
const checkOnly = process.argv.includes("--check");
const checkBuilt = process.argv.includes("--check-built");
const builtAssetPath = path.join(
  siteRoot,
  ".open-next/assets/legal/third-party-notices.txt"
);
const source = await readFile(sourcePath);

if (checkOnly || checkBuilt) {
  const target = await readFile(targetPath).catch(() => null);
  if (target === null || !source.equals(target)) {
    console.error(
      "[legal] public third-party notice asset is missing or stale; run the site prebuild"
    );
    process.exitCode = 1;
  } else {
    console.log("[legal] public third-party notice asset is current");
  }
  if (checkBuilt) {
    const builtAsset = await readFile(builtAssetPath).catch(() => null);
    if (builtAsset === null || !source.equals(builtAsset)) {
      console.error(
        "[legal] built third-party notice asset is missing or stale; run cf:build before deploying"
      );
      process.exitCode = 1;
    } else {
      console.log("[legal] built third-party notice asset is current");
    }
  }
} else {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const target = await readFile(targetPath).catch(() => null);
  if (target === null || !source.equals(target)) {
    await writeFile(targetPath, source);
    console.log("[legal] synchronized public third-party notice asset");
  }
}
