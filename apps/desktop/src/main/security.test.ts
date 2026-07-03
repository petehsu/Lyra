import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

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

  test("signed preview URLs can serve main-process-approved images outside roots", async () => {
    const root = await makeTempDir();
    const outside = path.join(await makeTempDir(), "outside.png");
    await writeFile(outside, "png");

    const access = createLyraFileAccessController([root]);
    const signedUrl = access.createPreviewUrl(outside, "image/png");

    await expect(access.resolveRequest(signedUrl))
      .resolves.toMatchObject({ path: outside, contentType: "image/png" });
  });
});
