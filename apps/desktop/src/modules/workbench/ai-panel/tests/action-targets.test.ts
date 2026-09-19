import { describe, expect, test } from "vitest";

import {
  classifyActionTarget,
  imagePreviewSourceFromSource,
  isFileOpenTarget,
  isImageFileReference,
  isLocalFileReference,
  splitActionText
} from "../lyra-agents/features/rich-text/ActionTargets";

describe("action target path detection", () => {
  test("does not turn ellipsized paths into file targets", () => {
    expect(classifyActionTarget(".../commands.jsonl")).toBeNull();
    expect(classifyActionTarget("/tmp/lyra/.../commands.jsonl")).toBeNull();
    expect(isLocalFileReference(".../commands.jsonl")).toBe(false);

    const segments = splitActionText("命令索引：.../commands.jsonl");
    expect(segments.some((segment) => segment.kind === "target")).toBe(false);
  });

  test("recognizes home-relative paths so the opener can expand them", () => {
    const target = classifyActionTarget("~/.lyra/terminal-memory/events.jsonl");
    expect(target).toMatchObject({
      kind: "file",
      value: "~/.lyra/terminal-memory/events.jsonl"
    });
  });

  test("distinguishes file-like targets from directory-like paths", () => {
    const fileTarget = classifyActionTarget("src/App.tsx:42");
    const directoryTarget = classifyActionTarget("/Users/petehsu/Documents/Lyra/src");

    expect(fileTarget).not.toBeNull();
    expect(directoryTarget).not.toBeNull();
    expect(isFileOpenTarget(fileTarget!)).toBe(true);
    expect(isFileOpenTarget(directoryTarget!)).toBe(false);
  });
});

describe("workspace-relative image preview sources", () => {
  const workingDir = "/home/xu-yuanhao/Documents/test";

  test("treats a bare image filename as a local file reference", () => {
    expect(isImageFileReference("pelican-bicycle.svg")).toBe(true);
    expect(isImageFileReference("./shot.png")).toBe(true);
    expect(isImageFileReference("https://example.com/shot.png")).toBe(false);
    expect(isLocalFileReference("pelican-bicycle.svg")).toBe(false);
  });

  test("resolves session-relative markdown dests against workingDir", () => {
    expect(
      imagePreviewSourceFromSource("pelican-bicycle.svg", "image/svg+xml", workingDir)
    ).toBe(
      `lyra-file://preview?path=${encodeURIComponent(`${workingDir}/pelican-bicycle.svg`)}&contentType=${encodeURIComponent("image/svg+xml")}`
    );
    expect(
      imagePreviewSourceFromSource("./shot.webp", "image/webp", workingDir)
    ).toBe(
      `lyra-file://preview?path=${encodeURIComponent(`${workingDir}/shot.webp`)}&contentType=${encodeURIComponent("image/webp")}`
    );
  });

  test("does not emit a non-absolute preview URL", () => {
    expect(imagePreviewSourceFromSource("pelican-bicycle.svg", "image/svg+xml")).toBeUndefined();
    expect(imagePreviewSourceFromSource("https://example.com/shot.png")).toBe(
      "https://example.com/shot.png"
    );
  });
});
