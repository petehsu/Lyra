import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  cwd: ROOT,
  encoding: "utf8",
}).split("\0").filter(Boolean);

const forbiddenTracked = [
  { label: "npm lockfile", pattern: /(^|\/)package-lock\.json$/u },
  { label: "desktop temp directory", pattern: /^apps\/desktop\/\.tmp\//u },
  { label: "desktop win node import temp directory", pattern: /^apps\/desktop\/\.tmp-win-node-import\//u },
  { label: "lumen evidence", pattern: /(^|\/)lumen-evidence\//u },
  { label: "screenshot artifact", pattern: /(^|\/)screenshot[^/]*\.png$/u },
];

const issues: string[] = [];
for (const file of trackedFiles) {
  for (const rule of forbiddenTracked) {
    if (rule.pattern.test(file)) {
      issues.push(`${rule.label}: ${file}`);
    }
  }
}

const packageJsonFiles = trackedFiles.filter((file) => file.endsWith("package.json"));
for (const file of packageJsonFiles) {
  const absolutePath = path.join(ROOT, file);
  // `git ls-files` includes intentional deletions until the change is
  // committed. Do not treat a removed package as a malformed package.
  if (!fs.existsSync(absolutePath)) {
    continue;
  }
  const json = JSON.parse(fs.readFileSync(absolutePath, "utf8")) as {
    readonly scripts?: Record<string, string>;
  };
  for (const [name, command] of Object.entries(json.scripts ?? {})) {
    if (command.includes("scaffold ready")) {
      issues.push(`scaffold script: ${file}#${name}`);
    }
    if (command.includes("web/site")) {
      issues.push(`stale web/site script: ${file}#${name}`);
    }
  }
}

if (issues.length > 0) {
  console.error("[repo-hygiene] Found repository hygiene issues:");
  for (const issue of issues) {
    console.error(`  - ${issue}`);
  }
  process.exit(1);
}

console.log("[repo-hygiene] OK — no tracked temp artifacts, npm lockfiles, or stale scaffold scripts.");
