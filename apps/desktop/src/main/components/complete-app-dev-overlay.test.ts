import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  COMPLETE_APP_DEV_OVERLAYS,
  createCompleteAppDevOverlay,
  resolveCompleteAppDevOverlayRoot
} from "./complete-app-dev-overlay";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const createRepo = async (options: {
  readonly notificationsDist?: string;
  readonly downloadsDist?: string;
} = {}): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lyra-complete-app-overlay-"));
  roots.push(root);
  await mkdir(path.join(root, "apps", "desktop"), { recursive: true });
  await writeFile(path.join(root, "apps", "desktop", "package.json"), "{\"name\":\"@lyra/desktop\"}\n");
  await mkdir(path.join(root, "apps", "lyra-notifications", "dist"), { recursive: true });
  await writeFile(
    path.join(root, "apps", "lyra-notifications", "package.json"),
    "{\"name\":\"@lyra/app-notifications\",\"version\":\"1.0.0\"}\n"
  );
  if (options.notificationsDist !== undefined) {
    await writeFile(
      path.join(root, "apps", "lyra-notifications", "dist", "index.mjs"),
      options.notificationsDist
    );
  }
  await mkdir(path.join(root, "apps", "lyra-downloads", "dist"), { recursive: true });
  await writeFile(
    path.join(root, "apps", "lyra-downloads", "package.json"),
    "{\"name\":\"@lyra/app-downloads\",\"version\":\"1.0.0\"}\n"
  );
  if (options.downloadsDist !== undefined) {
    await writeFile(
      path.join(root, "apps", "lyra-downloads", "dist", "index.mjs"),
      options.downloadsDist
    );
  }
  return root;
};

describe("complete app dev overlay", () => {
  test("only overlays the complete notifications package", () => {
    expect(COMPLETE_APP_DEV_OVERLAYS.map(({ componentId }) => componentId)).toEqual([
      "lyra.notifications"
    ]);
  });

  test("finds the repo from apps/desktop or the workspace root", async () => {
    const root = await createRepo();
    expect(resolveCompleteAppDevOverlayRoot(root)).toBe(root);
    expect(resolveCompleteAppDevOverlayRoot(path.join(root, "apps", "desktop"))).toBe(root);
  });

  test("lists and resolves notifications dist, and ignores preview downloads dist", async () => {
    const source = "export default { id: 'lyra.notifications' };\n";
    const root = await createRepo({
      notificationsDist: source,
      downloadsDist: "export default { id: 'lyra.downloads' };\n"
    });
    const overlay = createCompleteAppDevOverlay(root);
    const listed = await overlay.mergeList([]);

    expect(listed.map(({ componentId }) => componentId)).toEqual(["lyra.notifications"]);
    expect(listed[0]).toMatchObject({
      kind: "app",
      active: "1.0.0"
    });

    const runtime = await overlay.resolve("lyra.notifications", "1.0.0");
    expect(runtime).toEqual({
      componentId: "lyra.notifications",
      version: "1.0.0",
      entryUrl: "lyra-app-module://component/lyra.notifications/1.0.0/index.mjs",
      permissions: ["notifications:read"]
    });
    expect(await overlay.resolve("lyra.downloads", "1.0.0")).toBeNull();

    const asset = await overlay.readAsset(runtime!.entryUrl);
    expect(Buffer.from(asset?.bytes ?? []).toString("utf8")).toBe(source);
    expect(asset?.contentType).toBe("text/javascript; charset=utf-8");
    expect(await overlay.readAsset(
      "lyra-app-module://component/lyra.notifications/1.0.0/index.mjs.map"
    )).toBeNull();
  });

  test("stays empty when notifications dist is missing", async () => {
    const root = await createRepo();
    const overlay = createCompleteAppDevOverlay(root);
    expect(await overlay.mergeList([])).toEqual([]);
    expect(await overlay.resolve("lyra.notifications", "1.0.0")).toBeNull();
  });

  test("does not overlay a component that is already signed-installed", async () => {
    const root = await createRepo({
      notificationsDist: "export default { id: 'lyra.notifications' };\n"
    });
    const overlay = createCompleteAppDevOverlay(root);
    const listed = await overlay.mergeList([{
      componentId: "lyra.notifications",
      kind: "app",
      active: "9.0.0",
      versions: [{
        version: "9.0.0",
        installedAt: "2026-07-30T00:00:00.000Z",
        target: "linux-x64"
      }]
    }]);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.active).toBe("9.0.0");
  });

  test("refuses a notifications entry that is a symlink", async () => {
    const root = await createRepo();
    const target = path.join(root, "apps", "lyra-notifications", "package.json");
    await symlink(target, path.join(root, "apps", "lyra-notifications", "dist", "index.mjs"));
    const overlay = createCompleteAppDevOverlay(root);
    expect(await overlay.mergeList([])).toEqual([]);
  });
});
