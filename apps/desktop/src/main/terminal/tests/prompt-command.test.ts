import { describe, expect, test } from "vitest";

import { createPromptReloadCommand } from "../fallback-prompt";

describe("terminal prompt reload command", () => {
  test("returns follow-app reset script for bash", () => {
    const command = createPromptReloadCommand("bash", "one-dark", "follow-app");

    expect(command).toContain("\\u@\\h:\\w\\$ '");
    expect(command).toContain("LyraPrompt");
    expect(command).toContain("trap - DEBUG");
    expect(command).toContain("bind '\"\\e[3~\":delete-char'");
    expect(command).not.toContain("\\033[2J");
  });

  test("builds lyra-minimal prompt for bash", () => {
    const command = createPromptReloadCommand("bash", "one-dark", "lyra-minimal");

    expect(command).toContain("\\w");
    expect(command).not.toContain("code:${exit_code}");
  });

  test("builds lyra-standard prompt for bash", () => {
    const command = createPromptReloadCommand("bash", "one-dark", "lyra-standard");

    expect(command).toContain("\\u");
    expect(command).not.toContain("code:${exit_code}");
  });

  test("builds lyra-rich prompt for bash", () => {
    const command = createPromptReloadCommand("bash", "one-dark", "lyra-rich");

    expect(command).toContain("\\t");
    expect(command).not.toContain("code:${exit_code}");
  });

  test("builds lyra-developer prompt with duration and exit code", () => {
    const command = createPromptReloadCommand("bash", "one-dark", "lyra-developer");

    expect(command).toContain("code:${exit_code}");
    expect(command).toContain("__lyra_prompt_duration");
  });

  test("does not emit legacy starship env injection", () => {
    const command = createPromptReloadCommand("bash", "one-dark", "lyra-rich");

    expect(command).not.toContain("STARSHIP_CONFIG");
    expect(command).not.toContain("LYRA_STARSHIP_BIN");
  });

  test("keeps delete/backspace bindings for zsh prompt scripts", () => {
    const command = createPromptReloadCommand("zsh", "one-dark", "lyra-rich");

    expect(command).toContain("bindkey -M emacs '^?' backward-delete-char");
    expect(command).toContain("bindkey -M viins '^[[3~' delete-char");
    expect(command).toContain("bindkey -M vicmd '^[[P' delete-char");
    expect(command).toContain("bindkey '^H' backward-delete-char");
    expect(command).toContain("KEYTIMEOUT=1");
    expect(command).toContain("local newline=$'\\n'");
    expect(command).toContain("printf '%s' '%F{");
    expect(command).toContain("LyraPrompt");
    expect(command).not.toContain("printf '%F{");
    expect(command).not.toContain("\\033[2J");
    expect(command).not.toContain("\\n${status_segment}");
    expect(command).not.toContain("git_segment=\\\"");
  });

  test("returns null for powershell", () => {
    const command = createPromptReloadCommand("powershell", "one-dark", "lyra-standard");

    expect(command).toBeNull();
  });
});
