/**
 * Maps component IDs to source path prefixes and detects which platforms
 * need to be rebuilt based on changed files.
 *
 * Platform-specific resources (aria2, rust-analyzer) live under per-platform
 * subdirectories. All other source paths are shared across platforms — a
 * change to any shared path requires rebuilding every platform.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// ponytail: Only platform-specific resource dirs are listed explicitly.
// Everything else is treated as shared (all platforms). This is conservative:
// a doc-only change triggers a full rebuild, but we never miss a needed build.

/** Platform-specific resource directories that only affect one platform. */
const PLATFORM_RESOURCE_DIRS: readonly {
  readonly prefix: string;
  readonly target: string;
}[] = [
  { prefix: "apps/desktop/resources/aria2/darwin-x64/", target: "darwin-x64" },
  { prefix: "apps/desktop/resources/aria2/darwin-arm64/", target: "darwin-arm64" },
  { prefix: "apps/desktop/resources/aria2/linux-x64/", target: "linux-x64" },
  { prefix: "apps/desktop/resources/aria2/linux-arm64/", target: "linux-arm64" },
  { prefix: "apps/desktop/resources/aria2/win32-x64/", target: "windows-x64" },
  { prefix: "apps/desktop/resources/aria2/win32-arm64/", target: "windows-arm64" },
  { prefix: "apps/desktop/resources/lsp/darwin-x64/", target: "darwin-x64" },
  { prefix: "apps/desktop/resources/lsp/darwin-arm64/", target: "darwin-arm64" },
  { prefix: "apps/desktop/resources/lsp/linux-x64/", target: "linux-x64" },
  { prefix: "apps/desktop/resources/lsp/linux-arm64/", target: "linux-arm64" },
  { prefix: "apps/desktop/resources/lsp/win32-x64/", target: "windows-x64" },
  { prefix: "apps/desktop/resources/lsp/win32-arm64/", target: "windows-arm64" },
];

/** Component ID → source path prefixes (reference; not used in detection). */
export const COMPONENT_SOURCE_MAP: Readonly<Record<string, readonly string[]>> = {
  "lyra.core": ["apps/desktop/src/", "apps/desktop/electron.vite.config.ts", "apps/desktop/package.json", "apps/desktop/build/"],
  "lyra.runtime": ["crates/lyrad/", "crates/lyra-runtime-protocol/", "crates/lyra-agent-runtime/", "crates/lyra-agent-core/", "crates/lyra-agent-reader/", "crates/lyra-terminal-core/", "crates/lyra-wasi-host/", "crates/lyra-tool-fs-core/"],
  "lyra.browser": ["apps/lyra-browser/src/", "apps/desktop/src/modules/workbench/browser-tabs/", "apps/desktop/src/modules/workbench/browser-search/", "apps/desktop/src/modules/workbench/browser-history/", "apps/desktop/src/main/workbench-browser/"],
  "lyra.files": ["apps/lyra-files/src/", "apps/desktop/src/modules/workbench/file-manager/", "apps/desktop/src/modules/workbench/file-editor/"],
  "lyra.editor": ["apps/lyra-editor/src/"],
  "lyra.images": ["apps/lyra-images/src/", "apps/desktop/src/modules/workbench/image-viewer/", "apps/desktop/src/main/image-viewer/"],
  "lyra.terminal": ["apps/lyra-terminal/src/", "apps/desktop/src/modules/workbench/terminal-dock/", "apps/desktop/src/modules/workbench/terminal-profiles/", "apps/desktop/src/main/terminal/"],
  "lyra.downloads": ["apps/lyra-downloads/src/", "apps/desktop/src/main/download-manager/"],
  "lyra.agent": ["apps/lyra-agent/src/", "apps/desktop/src/modules/workbench/ai-panel/", "apps/desktop/src/modules/workbench/agent-git/", "apps/desktop/src/modules/workbench/agent-plan-board/", "apps/desktop/src/modules/workbench/agent-project-tree/", "apps/desktop/src/modules/workbench/agent-session-history/", "apps/desktop/src/modules/workbench/agent-session-view-model/", "apps/desktop/src/main/agent/"],
  "lyra.credentials": ["apps/lyra-credentials/src/", "apps/desktop/src/main/auth/"],
  "lyra.notifications": ["apps/lyra-notifications/src/", "apps/desktop/src/modules/workbench/notifications/"],
  "lyra.language.en-us": ["apps/desktop/src/shared/i18n/en-US/"],
  "lyra.uiux.classic": ["components/first-party/uiux-classic/"],
  "lyra.resource.rust-analyzer": ["apps/desktop/resources/lsp/"],
  "lyra.resource.aria2": ["apps/desktop/resources/aria2/"],
  "lyra.resource.playwright": ["apps/desktop/resources/playwright-browsers/"],
};

export type AffectedPlatformsResult = {
  readonly affectedPlatforms: readonly string[];
  readonly allPlatforms: boolean;
};

/**
 * Given a list of changed file paths, determine which platforms need to be
 * rebuilt. If any changed file is not under a platform-specific resource
 * directory, all platforms are affected.
 */
export const detectAffectedPlatforms = (
  changedFiles: readonly string[],
  allPlatforms: readonly string[]
): AffectedPlatformsResult => {
  const platformSet = new Set<string>();
  let shared = false;

  for (const file of changedFiles) {
    const trimmed = file.trim();
    if (trimmed.length === 0) continue;
    let matched = false;
    for (const spec of PLATFORM_RESOURCE_DIRS) {
      if (trimmed.startsWith(spec.prefix)) {
        platformSet.add(spec.target);
        matched = true;
        break;
      }
    }
    if (!matched) {
      shared = true;
    }
  }

  if (shared) {
    return { affectedPlatforms: allPlatforms, allPlatforms: true };
  }
  return { affectedPlatforms: [...platformSet], allPlatforms: false };
};

const main = (): void => {
  const allPlatformsArg = process.argv.indexOf("--all-platforms");
  const allPlatforms = allPlatformsArg >= 0
    ? (process.argv[allPlatformsArg + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    : ["darwin-x64", "darwin-arm64", "windows-x64", "windows-arm64", "linux-x64", "linux-arm64"];

  const repoArg = process.argv.indexOf("--repo");
  const baseRefArg = process.argv.indexOf("--base-ref");

  let changedFiles: string[];

  if (baseRefArg >= 0 && repoArg >= 0) {
    const repo = process.argv[repoArg + 1]!;
    const baseRef = process.argv[baseRefArg + 1]!;
    const output = execFileSync("git", ["diff", "--name-only", `${baseRef}...HEAD`], {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    changedFiles = output.split("\n").filter((line) => line.trim().length > 0);
  } else {
    // Read from stdin (fd 0)
    const stdin = readFileSync(0, { encoding: "utf8" });
    changedFiles = stdin.split("\n").filter((line) => line.trim().length > 0);
  }

  const result = detectAffectedPlatforms(changedFiles, allPlatforms);
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

if (process.argv[1]?.endsWith("component-source-map.ts")) {
  main();
}