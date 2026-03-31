import { describe, expect, test } from "vitest";

import {
  createLocationPathKey,
  isSameLocationPath,
  resolveLocationTitle,
  withResolvedLocationTitle
} from "../location-utils";
import type { FileManagerSurfaceLabels } from "../types";

const labels: Pick<
  FileManagerSurfaceLabels,
  "locationHome" | "locationDesktop" | "locationDocuments" | "locationDownloads" | "locationTrash"
> = {
  locationHome: "Home",
  locationDesktop: "Desktop",
  locationDocuments: "Documents",
  locationDownloads: "Downloads",
  locationTrash: "Trash"
};

describe("file manager location utils", () => {
  test("normalizes path key by platform", () => {
    expect(createLocationPathKey("C:\\Users\\Lyra", "win32")).toBe("c:/users/lyra");
    expect(createLocationPathKey("/HOME/Lyra", "linux")).toBe("/HOME/Lyra");
    expect(createLocationPathKey("/Users/Lyra", "darwin")).toBe("/users/lyra");
  });

  test("compares same path with platform-aware normalization", () => {
    expect(isSameLocationPath("C:\\Users\\Lyra", "c:/users/lyra", "win32")).toBe(true);
    expect(isSameLocationPath("/home/lyra", "/HOME/lyra", "linux")).toBe(false);
    expect(isSameLocationPath(undefined, "/home/lyra", "linux")).toBe(false);
  });

  test("resolves special location titles from labels", () => {
    expect(resolveLocationTitle({ title: "x", specialId: "home" }, labels)).toBe("Home");
    expect(resolveLocationTitle({ title: "x", specialId: "downloads" }, labels)).toBe("Downloads");
    expect(resolveLocationTitle({ title: "Custom" }, labels)).toBe("Custom");
  });

  test("withResolvedLocationTitle keeps shape and replaces title", () => {
    const location = {
      id: "loc-1",
      title: "raw",
      specialId: "trash" as const,
      path: "/tmp"
    };

    expect(withResolvedLocationTitle(location, labels)).toEqual({
      ...location,
      title: "Trash"
    });
  });
});
