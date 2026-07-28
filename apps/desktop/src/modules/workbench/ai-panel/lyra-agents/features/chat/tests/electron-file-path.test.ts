import { afterEach, describe, expect, test, vi } from "vitest";

import { resolveElectronFilePath } from "../electron-file-path";
import * as shellService from "../../../../../shell/service";

describe("electron-file-path", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("prefers desktop bridge path resolution over legacy file.path", () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(file, "path", { value: "/legacy/path/notes.txt" });
    vi.spyOn(shellService, "getDesktopApi").mockReturnValue({
      files: {
        getPathForFile: () => "/bridge/path/notes.txt"
      }
    } as unknown as ReturnType<typeof shellService.getDesktopApi>);

    expect(resolveElectronFilePath(file)).toBe("/bridge/path/notes.txt");
  });

  test("falls back to legacy file.path when bridge is unavailable", () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(file, "path", { value: "/legacy/path/notes.txt" });
    vi.spyOn(shellService, "getDesktopApi").mockReturnValue(null);

    expect(resolveElectronFilePath(file)).toBe("/legacy/path/notes.txt");
  });
});
