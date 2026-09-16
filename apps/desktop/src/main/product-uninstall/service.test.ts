import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { LyraStorageRoots } from "../storage";
import {
  listProductFileTargets,
  removeProductInstallation,
  resolvePackagedAppRoot
} from "./service";
import { buildWindowsUninstallString } from "./windows-arp";

const rootsFor = (root: string): LyraStorageRoots => {
  const dataRoot = path.join(root, "data");
  return {
    componentInstallRoot: root,
    lyraRoot: root,
    dataRoot,
    componentsRoot: path.join(root, "components"),
    systemRoot: path.join(root, "system"),
    electronRoot: path.join(root, "electron"),
    electronDesktopRoot: path.join(root, "electron", "desktop"),
    modules: {
      agent: path.join(dataRoot, "agent"),
      fileManager: path.join(dataRoot, "file-manager"),
      runtime: path.join(dataRoot, "runtime"),
      linuxCompat: path.join(dataRoot, "linux-compat"),
      terminal: path.join(dataRoot, "terminal"),
      workbenchState: path.join(dataRoot, "workbench-state"),
      uiuxPacks: path.join(dataRoot, "uiux-packs"),
      search: path.join(dataRoot, "search"),
      identity: path.join(dataRoot, "identity"),
      imageViewer: path.join(dataRoot, "image-viewer"),
      downloadManager: path.join(dataRoot, "download-manager"),
      loginManager: path.join(dataRoot, "login-manager")
    }
  };
};

const fixtures: string[] = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("product uninstall", () => {
  test("keeps user data unless that is requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lyra-uninstall-"));
    fixtures.push(root);
    const roots = rootsFor(root);
    const leftover = path.join(roots.componentsRoot, "lyra.runtime", "file.bin");
    const cache = path.join(roots.systemRoot, "cache-v1", "blob");
    const session = path.join(roots.electronDesktopRoot, "session.json");
    const notes = path.join(roots.dataRoot, "agent", "memory.sqlite");
    await mkdir(path.dirname(leftover), { recursive: true });
    await mkdir(path.dirname(cache), { recursive: true });
    await mkdir(path.dirname(session), { recursive: true });
    await mkdir(path.dirname(notes), { recursive: true });
    await writeFile(leftover, "component");
    await writeFile(cache, "cache");
    await writeFile(session, "{}");
    await writeFile(notes, "keep");

    expect(listProductFileTargets(roots, false)).toContain(roots.electronRoot);
    expect(listProductFileTargets(roots, false)).not.toContain(roots.dataRoot);

    await removeProductInstallation({
      roots,
      request: { removeUserData: false },
      platform: "linux",
      env: { HOME: root },
      onProgress: () => undefined
    });

    await expect(access(roots.componentsRoot)).rejects.toThrow();
    await expect(access(path.join(roots.systemRoot, "cache-v1"))).rejects.toThrow();
    await expect(access(roots.electronRoot)).rejects.toThrow();
    await expect(readFile(notes, "utf8")).resolves.toBe("keep");
  });

  test("removes user data when requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lyra-uninstall-data-"));
    fixtures.push(root);
    const roots = rootsFor(root);
    const notes = path.join(roots.dataRoot, "agent", "memory.sqlite");
    await mkdir(path.dirname(notes), { recursive: true });
    await writeFile(notes, "wipe");
    await removeProductInstallation({
      roots,
      request: { removeUserData: true },
      platform: "linux",
      env: { HOME: root },
      onProgress: () => undefined
    });
    await expect(access(notes)).rejects.toThrow();
  });

  test("resolves packaged app roots without deleting a generic parent folder", () => {
    expect(resolvePackagedAppRoot({
      execPath: "/repo/apps/desktop/out/main/index.cjs",
      platform: "linux",
      isPackaged: false
    })).toBeNull();
    expect(resolvePackagedAppRoot({
      execPath: "/Applications/Lyra.app/Contents/MacOS/Lyra",
      platform: "darwin",
      isPackaged: true
    })).toBe("/Applications/Lyra.app");
    expect(resolvePackagedAppRoot({
      execPath: "/tmp/.mount_Lyra/Lyra",
      platform: "linux",
      env: { APPIMAGE: "/home/user/Lyra-Online.AppImage" },
      isPackaged: true
    })).toBe("/home/user/Lyra-Online.AppImage");
    expect(buildWindowsUninstallString(String.raw`C:\Users\a\Lyra.exe`)).toBe(
      String.raw`"C:\Users\a\Lyra.exe" --uninstall`
    );
  });
});
