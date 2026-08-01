import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkBuiltCoreOutput,
  checkPackagedCoreArchive,
  validateBuilderConfiguration
} from "./core-payload.ts";

const repositoryRoot = process.cwd();
const requireFromDesktop = createRequire(
  path.join(repositoryRoot, "apps", "desktop", "package.json")
);
const { createPackage } = requireFromDesktop("@electron/asar") as {
  readonly createPackage: (source: string, destination: string) => Promise<void>;
};

const writeValidOutput = async (root: string): Promise<void> => {
  const files: Record<string, string> = {
    "main/index.cjs": "'use strict'; const electron = require('electron');\n",
    "main/shared-process.cjs": "'use strict'; const fs = require('node:fs');\n",
    "preload/browser-page-frame.cjs": "'use strict'; require('electron');\n",
    "preload/index.cjs": "'use strict'; require('electron');\n",
    "preload/third-party-app.cjs": "'use strict'; require('electron');\n",
    "renderer/index.html": "<!doctype html><title>Lyra</title>\n",
    "renderer/assets/chunk.js": "export const value = 1;\n",
    "renderer/assets/runtime.js": [
      "const url = new URL('./chunk.js', import.meta.url);",
      "void import('./chunk.js');",
      "void import(`${url}`);",
      ""
    ].join("\n")
  };
  for (const [relative, contents] of Object.entries(files)) {
    const destination = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
};

test("Desktop builder configuration keeps the Core archive allowlisted", async () => {
  await validateBuilderConfiguration(repositoryRoot);
});

test("built Core output allows only Electron, Node, and relative runtime imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-core-output-"));
  try {
    await writeValidOutput(root);
    const valid = await checkBuiltCoreOutput(root);
    assert.equal(valid.files, 8);

    await writeFile(
      path.join(root, "main", "index.cjs"),
      "'use strict'; require('@lyra/app-runtime');\n"
    );
    await assert.rejects(
      checkBuiltCoreOutput(root),
      /requires external runtime package @lyra\/app-runtime/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("built renderer rejects bare package imports while allowing URL-based modules", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-core-renderer-"));
  try {
    await writeValidOutput(root);
    await writeFile(
      path.join(root, "renderer", "assets", "chunk.js"),
      "import React from 'react'; export default React;\n"
    );
    await assert.rejects(
      checkBuiltCoreOutput(root),
      /imports external runtime package react/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("packaged Core archive contains only output and minimal metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-core-asar-"));
  try {
    const app = path.join(root, "app");
    await writeValidOutput(path.join(app, "out"));
    await writeFile(
      path.join(app, "package.json"),
      `${JSON.stringify({
        name: "@lyra/desktop",
        version: "0.1.0",
        main: "out/main/index.cjs",
        dependencies: {}
      })}\n`
    );
    const archive = path.join(root, "app.asar");
    await createPackage(app, archive);
    const valid = await checkPackagedCoreArchive(
      archive,
      repositoryRoot,
      { requireExtraResources: false }
    );
    assert.equal(valid.archive.files, 9);

    await mkdir(path.join(app, "node_modules", "bad"), { recursive: true });
    await writeFile(path.join(app, "node_modules", "bad", "index.js"), "module.exports = 1;\n");
    const invalidArchive = path.join(root, "invalid.asar");
    await createPackage(app, invalidArchive);
    await assert.rejects(
      checkPackagedCoreArchive(
        invalidArchive,
        repositoryRoot,
        { requireExtraResources: false }
      ),
      /forbidden top-level entry: node_modules/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
