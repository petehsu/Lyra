import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const desktopPackage = JSON.parse(read("apps/desktop/package.json")) as { readonly version?: string };
const cargoToml = read("Cargo.toml");
const changelog = read("CHANGELOG.md");

const workspaceVersion = cargoToml.match(/\[workspace\.package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
const desktopVersion = desktopPackage.version;
const issues: string[] = [];

if (workspaceVersion === undefined || workspaceVersion === "0.0.0") {
  issues.push("Cargo workspace package version must be set and cannot be 0.0.0");
}
if (desktopVersion === undefined || desktopVersion === "0.0.0") {
  issues.push("apps/desktop package version must be set and cannot be 0.0.0");
}
if (desktopVersion !== undefined && !changelog.includes(`## ${desktopVersion}`)) {
  issues.push(`CHANGELOG.md must contain a ## ${desktopVersion} section`);
}

if (issues.length > 0) {
  console.error("[release-version] Found release version issues:");
  for (const issue of issues) {
    console.error(`  - ${issue}`);
  }
  process.exit(1);
}

console.log(`[release-version] OK — desktop=${desktopVersion} cargo-workspace=${workspaceVersion}`);
