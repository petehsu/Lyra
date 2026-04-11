import { describe, expect, test, vi } from "vitest";

import { resolveWorkbenchNavigationInput } from "../navigation-input";
import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";

const createDesktopApi = (
  implementation: LyraDesktopApi["files"]["statFile"]
): Pick<LyraDesktopApi, "files"> => ({
  files: {
    statFile: implementation
  }
} as Pick<LyraDesktopApi, "files">);

describe("resolveWorkbenchNavigationInput", () => {
  test("resolves https urls", async () => {
    const result = await resolveWorkbenchNavigationInput(
      "https://openai.com",
      createDesktopApi(vi.fn())
    );

    expect(result).toEqual({
      kind: "url",
      address: "https://openai.com/"
    });
  });

  test("normalizes bare domains into urls", async () => {
    const result = await resolveWorkbenchNavigationInput(
      "openai.com",
      createDesktopApi(vi.fn())
    );

    expect(result).toEqual({
      kind: "url",
      address: "https://openai.com/"
    });
  });

  test("resolves directories from absolute paths", async () => {
    const statFile = vi.fn().mockResolvedValue({
      path: "/Users/me/project",
      exists: true,
      isDirectory: true,
      readOnly: false,
      sizeBytes: 0
    });

    const result = await resolveWorkbenchNavigationInput(
      "/Users/me/project",
      createDesktopApi(statFile)
    );

    expect(statFile).toHaveBeenCalledWith({ path: "/Users/me/project" });
    expect(result).toEqual({
      kind: "directory",
      path: "/Users/me/project"
    });
  });

  test("resolves files from absolute paths", async () => {
    const statFile = vi.fn().mockResolvedValue({
      path: "/Users/me/project/file.ts",
      exists: true,
      isDirectory: false,
      readOnly: false,
      sizeBytes: 64
    });

    const result = await resolveWorkbenchNavigationInput(
      "/Users/me/project/file.ts",
      createDesktopApi(statFile)
    );

    expect(result).toEqual({
      kind: "file",
      path: "/Users/me/project/file.ts"
    });
  });

  test("resolves file urls before search fallback", async () => {
    const statFile = vi.fn().mockResolvedValue({
      path: "/Users/me/project/file.ts",
      exists: true,
      isDirectory: false,
      readOnly: false,
      sizeBytes: 64
    });

    const result = await resolveWorkbenchNavigationInput(
      "file:///Users/me/project/file.ts",
      createDesktopApi(statFile)
    );

    expect(result).toEqual({
      kind: "file",
      path: "/Users/me/project/file.ts"
    });
  });

  test("falls back to standard search for free-form queries", async () => {
    const result = await resolveWorkbenchNavigationInput(
      "some random question",
      createDesktopApi(vi.fn())
    );

    expect(result).toEqual({
      kind: "search",
      query: "some random question",
      mode: "standard"
    });
  });

  test("falls back to standard search when an absolute path does not exist", async () => {
    const result = await resolveWorkbenchNavigationInput(
      "/Users/me/missing",
      createDesktopApi(
        vi.fn().mockResolvedValue({
          path: "/Users/me/missing",
          exists: false,
          isDirectory: false,
          readOnly: false,
          sizeBytes: 0
        })
      )
    );

    expect(result).toEqual({
      kind: "search",
      query: "/Users/me/missing",
      mode: "standard"
    });
  });

  test("returns empty for blank input", async () => {
    const result = await resolveWorkbenchNavigationInput(
      "   ",
      createDesktopApi(vi.fn())
    );

    expect(result).toEqual({ kind: "empty" });
  });
});
