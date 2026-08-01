import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import * as React from "react";
import * as ReactDomClient from "react-dom/client";
import * as ReactJsxRuntime from "react/jsx-runtime";

import { validateLyraAppModule } from "../../packages/app-runtime/src/index.ts";
import { installFirstPartyUiRuntime } from "../../packages/workbench-ui-runtime/src/host.ts";

const APPS = [
  ["lyra-agent", "lyra.agent"],
  ["lyra-browser", "lyra.browser"],
  ["lyra-credentials", "lyra.credentials"],
  ["lyra-downloads", "lyra.downloads"],
  ["lyra-editor", "lyra.editor"],
  ["lyra-files", "lyra.files"],
  ["lyra-images", "lyra.images"],
  ["lyra-notifications", "lyra.notifications"],
  ["lyra-terminal", "lyra.terminal"]
] as const;

const MAX_APP_BUNDLE_BYTES = 8 * 1024 * 1024;

const main = async (): Promise<void> => {
  installFirstPartyUiRuntime({
    react: React,
    reactDomClient: ReactDomClient,
    jsxRuntime: ReactJsxRuntime
  });
  for (const [directory, componentId] of APPS) {
    const dist = path.resolve("apps", directory, "dist");
    const files = await readdir(dist);
    if (files.some((file) => file.endsWith(".map"))) {
      throw new Error(`${directory} release bundle contains a source map.`);
    }
    if (files.length !== 1 || files[0] !== "index.mjs") {
      throw new Error(`${directory} release bundle must contain only index.mjs.`);
    }
    const entry = path.join(dist, "index.mjs");
    const metadata = await stat(entry);
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_APP_BUNDLE_BYTES) {
      throw new Error(`${directory} release entry has an invalid size (${metadata.size} bytes).`);
    }
    const source = await readFile(entry, "utf8");
    if (
      source.includes("sourceMappingURL")
      || source.includes("sourcesContent")
      || /\b(?:src|test|tests)\//u.test(source)
    ) {
      throw new Error(`${directory} release entry contains source or test metadata.`);
    }
    if (
      source.includes("@workbench/")
      || source.includes("@renderer/")
      || source.includes("apps/desktop/src")
      || source.includes("monaco-editor/esm")
    ) {
      throw new Error(
        `${directory} release entry contains a Desktop or Monaco implementation dependency.`
      );
    }
    const packageDocument = JSON.parse(
      await readFile(path.resolve("apps", directory, "package.json"), "utf8")
    ) as { readonly private?: unknown; readonly version?: unknown };
    if (packageDocument.private !== true || typeof packageDocument.version !== "string") {
      throw new Error(`${directory} package has invalid private version metadata.`);
    }
    const namespace = await import(
      `${pathToFileURL(entry).href}?release-check=${encodeURIComponent(componentId)}`
    ) as { readonly default?: unknown; readonly lyraAppModule?: unknown };
    const module = namespace.lyraAppModule ?? namespace.default;
    if (!validateLyraAppModule(module)) {
      throw new Error(`${directory} release entry does not export a valid Lyra application.`);
    }
    if (module.id !== componentId || module.version !== packageDocument.version) {
      throw new Error(
        `${directory} release identity ${module.id}@${module.version} does not match `
        + `${componentId}@${String(packageDocument.version)}.`
      );
    }
  }
  process.stdout.write(
    `Verified ${APPS.length} source-free, version-matched first-party app bundles.\n`
  );
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
