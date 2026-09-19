import { afterEach, describe, expect, test } from "vitest";

import { resolveElectronFilePath } from "../electron-file-path";

describe("electron-file-path", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "lyraElectron");
  });

  test("prefers Electron shell path resolution over legacy file.path", () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(file, "path", { value: "/legacy/path/notes.txt" });
    window.lyraElectron = {
      getPathForFile: () => "/bridge/path/notes.txt"
    };

    expect(resolveElectronFilePath(file)).toBe("/bridge/path/notes.txt");
  });

  test("falls back to legacy file.path when Electron shell helper is unavailable", () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(file, "path", { value: "/legacy/path/notes.txt" });

    expect(resolveElectronFilePath(file)).toBe("/legacy/path/notes.txt");
  });
});
