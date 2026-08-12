import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FIRST_PARTY_APP_PACKAGES_V1,
  loadIndependentComponentVersions,
  requireIndependentComponentVersion
} from "./component-versions.ts";

const repositoryRoot = process.cwd();

test("loads app, UIUX, language, and resource versions independently", async () => {
  const versions = await loadIndependentComponentVersions(repositoryRoot);
  assert.equal(versions.size, 17);
  assert.equal(versions.get("lyra.core"), "0.1.0-preview.8");
  assert.equal(versions.get("lyra.runtime"), "0.1.0");
  for (const componentId of Object.keys(FIRST_PARTY_APP_PACKAGES_V1)) {
    assert.equal(versions.get(componentId), "1.0.0");
  }
  assert.equal(versions.get("lyra.uiux.classic"), "1.0.0");
  assert.equal(versions.get("lyra.resource.playwright"), "1.0.0");
  assert.throws(
    () => requireIndependentComponentVersion(versions, "lyra.unknown"),
    /No independent version metadata/u
  );
});

test("changing one app package version changes only that component", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-component-versions-"));
  try {
    await mkdir(path.join(root, "apps", "desktop"), { recursive: true });
    await cp(
      path.join(repositoryRoot, "apps", "desktop", "package.json"),
      path.join(root, "apps", "desktop", "package.json")
    );
    for (const directory of Object.values(FIRST_PARTY_APP_PACKAGES_V1)) {
      const destination = path.join(root, "apps", directory);
      await mkdir(destination, { recursive: true });
      await cp(
        path.join(repositoryRoot, "apps", directory, "package.json"),
        path.join(destination, "package.json")
      );
    }
    await mkdir(path.join(root, "components", "first-party"), { recursive: true });
    await cp(
      path.join(repositoryRoot, "components", "first-party", "resource-versions.v1.json"),
      path.join(root, "components", "first-party", "resource-versions.v1.json")
    );
    await mkdir(
      path.join(root, "components", "first-party", "uiux-classic"),
      { recursive: true }
    );
    await cp(
      path.join(
        repositoryRoot,
        "components",
        "first-party",
        "uiux-classic",
        "uiux-manifest.json"
      ),
      path.join(
        root,
        "components",
        "first-party",
        "uiux-classic",
        "uiux-manifest.json"
      )
    );

    const baseline = await loadIndependentComponentVersions(root);
    const browserPackagePath = path.join(root, "apps", "lyra-browser", "package.json");
    const browserPackage = JSON.parse(await readFile(browserPackagePath, "utf8")) as {
      version: string;
    };
    await writeFile(
      browserPackagePath,
      `${JSON.stringify({ ...browserPackage, version: "1.1.0" }, null, 2)}\n`
    );
    const changed = await loadIndependentComponentVersions(root);
    const changedComponents = [...changed].filter(
      ([componentId, version]) => baseline.get(componentId) !== version
    );
    assert.deepEqual(changedComponents, [["lyra.browser", "1.1.0"]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects missing, unexpected, or invalid resource versions", async () => {
  const document = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "components", "first-party", "resource-versions.v1.json"),
      "utf8"
    )
  ) as { components: Record<string, string> };
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-resource-versions-"));
  try {
    await mkdir(path.join(root, "apps", "desktop"), { recursive: true });
    await cp(
      path.join(repositoryRoot, "apps", "desktop", "package.json"),
      path.join(root, "apps", "desktop", "package.json")
    );
    for (const directory of Object.values(FIRST_PARTY_APP_PACKAGES_V1)) {
      const destination = path.join(root, "apps", directory);
      await mkdir(destination, { recursive: true });
      await cp(
        path.join(repositoryRoot, "apps", directory, "package.json"),
        path.join(destination, "package.json")
      );
    }
    const uiuxDestination = path.join(root, "components", "first-party", "uiux-classic");
    await mkdir(uiuxDestination, { recursive: true });
    await cp(
      path.join(
        repositoryRoot,
        "components",
        "first-party",
        "uiux-classic",
        "uiux-manifest.json"
      ),
      path.join(uiuxDestination, "uiux-manifest.json")
    );
    const metadataPath = path.join(
      root,
      "components",
      "first-party",
      "resource-versions.v1.json"
    );
    await writeFile(
      metadataPath,
      `${JSON.stringify({
        schemaVersion: 1,
        components: { ...document.components, unexpected: "1.0.0" }
      })}\n`
    );
    await assert.rejects(
      loadIndependentComponentVersions(root),
      /Unexpected independently versioned component/u
    );
    const invalid = { ...document.components };
    invalid["lyra.resource.aria2"] = "aria2-1.37.0";
    await writeFile(
      metadataPath,
      `${JSON.stringify({ schemaVersion: 1, components: invalid })}\n`
    );
    await assert.rejects(
      loadIndependentComponentVersions(root),
      /lyra\.resource\.aria2 version must be a SemVer/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
