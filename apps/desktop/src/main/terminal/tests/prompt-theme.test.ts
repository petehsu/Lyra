import { describe, expect, test } from "vitest";

import {
  resolvePromptGlyphs,
  resolvePromptPalette,
  resolvePromptStyle
} from "../prompt-theme";
import type { TerminalThemePresetId } from "../../../shared/terminal-theme";

const PRESETS: readonly TerminalThemePresetId[] = [
  "glacier-blocks",
  "ocean-matrix",
  "amber-forge",
  "mono-signal"
];

describe("prompt theme format safety", () => {
  test.each(PRESETS)("does not emit ${...} placeholders for %s", (presetId) => {
    const palette = resolvePromptPalette("one-dark");
    const glyphs = resolvePromptGlyphs(presetId);
    const style = resolvePromptStyle(presetId, palette, glyphs);

    const composed = [
      style.format,
      style.rightFormat ?? "",
      style.osFormat,
      style.usernameFormat,
      style.directoryFormat,
      style.gitBranchFormat,
      style.gitStatusFormat,
      style.cmdDurationFormat,
      style.timeFormat
    ].join("\n");

    expect(composed).not.toContain("${");
  });
});

