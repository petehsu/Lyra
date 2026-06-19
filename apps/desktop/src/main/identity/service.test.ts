import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn()
  }
}));

vi.mock("electron", () => ({
  ipcMain: electronMock.ipcMain
}));

import { createIdentityIpcBridge } from "./service";

const SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\"><path fill=\"currentColor\" /></svg>";

describe("identity service", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lyra-identity-test-"));
    electronMock.ipcMain.handle.mockClear();
    electronMock.ipcMain.removeHandler.mockClear();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("prefers explicit Lyra marks over generic renderer logos", async () => {
    const projectRoot = path.join(root, "Lyra", "apps", "desktop");
    const assetsRoot = path.join(projectRoot, "src", "renderer", "assets");
    mkdirSync(path.join(assetsRoot, "brand"), { recursive: true });
    writeFileSync(path.join(projectRoot, "package.json"), "{}");
    writeFileSync(path.join(assetsRoot, "logo.svg"), SVG);
    writeFileSync(path.join(assetsRoot, "brand", "lyra-mark.svg"), SVG);

    const bridge = createIdentityIpcBridge(path.join(root, "identity"));
    const identity = await bridge.resolveProjectIdentity({ path: projectRoot });
    bridge.dispose();

    expect(identity?.logo?.path).toBe(path.join(assetsRoot, "brand", "lyra-mark.svg"));
  });
});
