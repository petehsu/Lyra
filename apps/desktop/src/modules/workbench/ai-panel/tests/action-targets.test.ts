import { describe, expect, test } from "vitest";

import {
  classifyActionTarget,
  isFileOpenTarget,
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
