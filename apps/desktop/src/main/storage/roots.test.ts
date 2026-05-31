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
  test("keeps Agent data under the unified Lyra modules root", () => {
    const homeSpy = vi.spyOn(os, "homedir").mockReturnValue("/Users/tester");

    const roots = resolveLyraStorageRoots();

    expect(roots.lyraRoot).toBe(path.join("/Users/tester", ".lyra"));
    expect(roots.modulesRoot).toBe(path.join("/Users/tester", ".lyra", "modules"));
    expect(roots.modules.agent).toBe(
      path.join("/Users/tester", ".lyra", "modules", "agent")
    );
    expect(roots.modules.runtime).toBe(
      path.join("/Users/tester", ".lyra", "modules", "runtime")
    );
    expect(roots.modules.loginManager).toBe(
      path.join("/Users/tester", ".lyra", "modules", "login-manager")
    );

    homeSpy.mockRestore();
  });

  test("keeps Electron user data inside the unified Lyra root", () => {
    electronMock.app.setPath.mockClear();
    const roots = {
      lyraRoot: "/Users/tester/.lyra",
      modulesRoot: "/Users/tester/.lyra/modules",
      electronRoot: "/Users/tester/.lyra/electron",
      electronDesktopRoot: "/Users/tester/.lyra/electron/desktop",
      modules: {
        agent: "/Users/tester/.lyra/modules/agent",
        fileManager: "/Users/tester/.lyra/modules/file-manager",
        runtime: "/Users/tester/.lyra/modules/runtime",
        linuxCompat: "/Users/tester/.lyra/modules/linux-compat",
        terminal: "/Users/tester/.lyra/modules/terminal",
        workbenchState: "/Users/tester/.lyra/modules/workbench-state",
        uiuxPacks: "/Users/tester/.lyra/modules/uiux-packs",
        search: "/Users/tester/.lyra/modules/search",
        imageViewer: "/Users/tester/.lyra/modules/image-viewer",
        downloadManager: "/Users/tester/.lyra/modules/download-manager",
        loginManager: "/Users/tester/.lyra/modules/login-manager"
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
