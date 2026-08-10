import os from "node:os";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  app: {
    setPath: vi.fn()
  }
}));

vi.mock("electron", () => ({
  app: electronMock.app
}));

import { applyElectronStoragePaths, resolveLyraStorageRoots } from "./roots";

describe("Lyra storage roots", () => {
  test("separates module data, component payloads and system state", () => {
    const homeSpy = vi.spyOn(os, "homedir").mockReturnValue("/Users/tester");

    const roots = resolveLyraStorageRoots({
      homeDirectory: "/Users/tester",
      platform: "darwin",
      executablePath: "/Users/tester/Applications/Lyra.app/Contents/MacOS/Lyra",
      isPackaged: true,
      env: {}
    });

    expect(roots.componentInstallRoot).toBe(path.join("/Users/tester", ".lyra"));
    expect(roots.lyraRoot).toBe(path.join("/Users/tester", ".lyra"));
    expect(roots.dataRoot).toBe(path.join("/Users/tester", ".lyra", "data"));
    expect(roots.componentsRoot).toBe(path.join("/Users/tester", ".lyra", "components"));
    expect(roots.systemRoot).toBe(path.join("/Users/tester", ".lyra", "system"));
    expect(roots.modules.agent).toBe(
      path.join("/Users/tester", ".lyra", "data", "agent")
    );
    expect(roots.modules.runtime).toBe(
      path.join("/Users/tester", ".lyra", "data", "runtime")
    );
    expect(roots.modules.loginManager).toBe(
      path.join("/Users/tester", ".lyra", "data", "login-manager")
    );

    homeSpy.mockRestore();
  });

  test("resolves a packaged macOS system installation to the shared component scope", () => {
    const roots = resolveLyraStorageRoots({
      homeDirectory: "/Users/tester",
      platform: "darwin",
      executablePath: "/Applications/Lyra.app/Contents/MacOS/Lyra",
      isPackaged: true,
      systemRootWritableOverride: true,
      env: {}
    });

    expect(roots.componentInstallRoot).toBe("/Library/Application Support/Lyra");
    expect(roots.componentsRoot).toBe("/Library/Application Support/Lyra/components");
    expect(roots.systemRoot).toBe("/Library/Application Support/Lyra/system");
    expect(roots.dataRoot).toBe("/Users/tester/.lyra/data");
    expect(roots.electronRoot).toBe("/Users/tester/.lyra/electron");
  });

  test("falls back to user root when system component root is not writable (DMG install)", () => {
    // systemRootWritableOverride: false simulates a DMG install at /Applications
    // without a PKG installer pre-creating the system root with write permissions.
    const roots = resolveLyraStorageRoots({
      homeDirectory: "/Users/tester",
      platform: "darwin",
      executablePath: "/Applications/Lyra.app/Contents/MacOS/Lyra",
      isPackaged: true,
      systemRootWritableOverride: false,
      env: {}
    });

    expect(roots.componentInstallRoot).toBe("/Users/tester/.lyra");
    expect(roots.componentsRoot).toBe("/Users/tester/.lyra/components");
    expect(roots.systemRoot).toBe("/Users/tester/.lyra/system");
  });

  test("ignores component root environment overrides in packaged builds", () => {
    const roots = resolveLyraStorageRoots({
      homeDirectory: "/Users/tester",
      platform: "darwin",
      executablePath: "/Users/tester/Applications/Lyra.app/Contents/MacOS/Lyra",
      isPackaged: true,
      env: {
        LYRA_COMPONENT_INSTALL_ROOT: "/tmp/untrusted-components",
        LYRA_COMPONENT_STATE_ROOT: "/tmp/untrusted-state"
      }
    });

    expect(roots.componentInstallRoot).toBe("/Users/tester/.lyra");
    expect(roots.systemRoot).toBe("/Users/tester/.lyra/system");
  });

  test("keeps Electron user data inside the unified Lyra root", () => {
    electronMock.app.setPath.mockClear();
    const roots = {
      componentInstallRoot: "/Users/tester/.lyra",
      lyraRoot: "/Users/tester/.lyra",
      dataRoot: "/Users/tester/.lyra/data",
      componentsRoot: "/Users/tester/.lyra/components",
      systemRoot: "/Users/tester/.lyra/system",
      electronRoot: "/Users/tester/.lyra/electron",
      electronDesktopRoot: "/Users/tester/.lyra/electron/desktop",
      modules: {
        agent: "/Users/tester/.lyra/data/agent",
        fileManager: "/Users/tester/.lyra/data/file-manager",
        runtime: "/Users/tester/.lyra/data/runtime",
        linuxCompat: "/Users/tester/.lyra/data/linux-compat",
        terminal: "/Users/tester/.lyra/data/terminal",
        workbenchState: "/Users/tester/.lyra/data/workbench-state",
        uiuxPacks: "/Users/tester/.lyra/data/uiux-packs",
        search: "/Users/tester/.lyra/data/search",
        imageViewer: "/Users/tester/.lyra/data/image-viewer",
        downloadManager: "/Users/tester/.lyra/data/download-manager",
        identity: "/Users/tester/.lyra/data/identity",
        loginManager: "/Users/tester/.lyra/data/login-manager"
      }
    };

    applyElectronStoragePaths(roots);

    expect(electronMock.app.setPath).toHaveBeenCalledWith(
      "userData",
      "/Users/tester/.lyra/electron/desktop"
    );
    expect(electronMock.app.setPath).toHaveBeenCalledWith(
      "sessionData",
      path.join("/Users/tester/.lyra/electron/desktop", "session")
    );
  });
});
