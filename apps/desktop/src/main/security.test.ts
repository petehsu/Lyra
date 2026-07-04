import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  openExternalUrl,
  openInKnownEditor,
  revealPathInFolder
} from "./editor-actions";
import {
  createLyraFileAccessController,
  isPathInsideOrEqual,
  isSafeExternalUrl,
  parseLyraFileRequestPath
} from "./security";

const tempRoots: string[] = [];

const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "lyra-security-test-"));
  tempRoots.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("main process security helpers", () => {
  test("only treats web and mail links as safe external URLs", () => {
    expect(isSafeExternalUrl("https://example.com")).toBe(true);
    expect(isSafeExternalUrl("http://example.com")).toBe(true);
    expect(isSafeExternalUrl("mailto:hello@example.com")).toBe(true);
    expect(isSafeExternalUrl("file:///Users/tester/.ssh/id_rsa")).toBe(false);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
  });

  test("keeps path containment separator-safe", () => {
    expect(isPathInsideOrEqual("/tmp/project/file.png", "/tmp/project")).toBe(true);
    expect(isPathInsideOrEqual("/tmp/project", "/tmp/project")).toBe(true);
    expect(isPathInsideOrEqual("/tmp/project-copy/file.png", "/tmp/project")).toBe(false);
  });

  test("parses lyra-file query paths without accepting malformed URLs", () => {
    expect(parseLyraFileRequestPath("lyra-file://preview?path=%2Ftmp%2Fimage.png")).toBe("/tmp/image.png");
    expect(parseLyraFileRequestPath("not a url")).toBeNull();
  });

  test("allows only image files under allowed roots", async () => {
    const root = await makeTempDir();
    const allowedImage = path.join(root, "logo.png");
    const deniedText = path.join(root, "secret.txt");
    const outside = path.join(await makeTempDir(), "outside.png");
    await writeFile(allowedImage, "png");
    await writeFile(deniedText, "secret");
    await writeFile(outside, "png");

    const access = createLyraFileAccessController([root]);

    await expect(access.resolveRequest(`lyra-file://preview?path=${encodeURIComponent(allowedImage)}`))
      .resolves.toMatchObject({ path: allowedImage, contentType: "image/png" });
    await expect(access.resolveRequest(`lyra-file://preview?path=${encodeURIComponent(deniedText)}`))
      .resolves.toBeNull();
    await expect(access.resolveRequest(`lyra-file://preview?path=${encodeURIComponent(outside)}`))
      .resolves.toBeNull();
  });

  test.runIf(process.platform !== "win32")("rejects symlink escapes from allowed roots", async () => {
    const root = await makeTempDir();
    const outsideRoot = await makeTempDir();
    const outsideImage = path.join(outsideRoot, "outside.png");
    const linkedImage = path.join(root, "linked.png");
    await writeFile(outsideImage, "png");
    await symlink(outsideImage, linkedImage);

    const access = createLyraFileAccessController([root]);

    await expect(access.resolveRequest(`lyra-file://preview?path=${encodeURIComponent(linkedImage)}`))
      .resolves.toBeNull();
  });

  test("signed preview URLs can serve main-process-approved images outside roots", async () => {
    const root = await makeTempDir();
    const outside = path.join(await makeTempDir(), "outside.png");
    await writeFile(outside, "png");

    const access = createLyraFileAccessController([root]);
    const signedUrl = access.createPreviewUrl(outside, "image/png");

    await expect(access.resolveRequest(signedUrl))
      .resolves.toMatchObject({ path: outside, contentType: "image/png" });
  });

  test("openExternal allows only safe URL schemes", async () => {
    const openExternal = vi.fn<(url: string) => Promise<unknown>>()
      .mockResolvedValue(undefined);

    await expect(openExternalUrl("https://example.com", { openExternal })).resolves.toBe(true);
    await expect(openExternalUrl("file:///Users/tester/.ssh/id_rsa", { openExternal }))
      .resolves.toBe(false);
    await expect(openExternalUrl("javascript:alert(1)", { openExternal })).resolves.toBe(false);

    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
  });

  test("openInEditor passes malicious paths as execFile args, not shell text", async () => {
    const stat = vi.fn<(targetPath: string) => Promise<unknown>>().mockResolvedValue({});
    const execFile = vi.fn<(file: string, args: readonly string[]) => Promise<unknown>>().mockResolvedValue({});
    const injectedPath = `/tmp/project/file.txt"; touch /tmp/pwned; "`;

    await expect(openInKnownEditor(
      { editorId: "vscode", path: injectedPath },
      { execFile, platform: "linux", stat }
    )).resolves.toBe(true);

    expect(execFile).toHaveBeenCalledWith("code", [injectedPath]);
  });

  test("openInEditor uses macOS open -a without interpolating target path", async () => {
    const stat = vi.fn<(targetPath: string) => Promise<unknown>>().mockResolvedValue({});
    const execFile = vi.fn<(file: string, args: readonly string[]) => Promise<unknown>>().mockResolvedValue({});
    const targetPath = `/tmp/project/file.txt"; rm -rf /; "`;

    await expect(openInKnownEditor(
      { editorId: "vscode", path: targetPath },
      { execFile, platform: "darwin", stat }
    )).resolves.toBe(true);

    expect(execFile).toHaveBeenCalledWith("open", ["-a", "Visual Studio Code", targetPath]);
  });

  test("revealInFolder reveals the containing item without openPath", async () => {
    const stat = vi.fn<(targetPath: string) => Promise<unknown>>().mockResolvedValue({});
    const showItemInFolder = vi.fn<(targetPath: string) => void>();
    const targetPath = "/tmp/downloads/installer.dmg";

    await expect(revealPathInFolder(targetPath, { stat, showItemInFolder })).resolves.toBe(true);

    expect(showItemInFolder).toHaveBeenCalledWith(targetPath);
  });
});
