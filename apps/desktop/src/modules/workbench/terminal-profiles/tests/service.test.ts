import { describe, expect, test } from "vitest";

import {
  DEFAULT_TERMINAL_PROFILES,
  createTerminalProfilePaneOptions,
  resolveTerminalProfile
} from "../service";

describe("terminal profiles service", () => {
  test("resolves unknown profiles to default", () => {
    expect(resolveTerminalProfile(DEFAULT_TERMINAL_PROFILES, "missing").id).toBe("default");
  });

  test("default profile starts the Lyra Agent CLI and keeps shell escape hatch", () => {
    const defaultProfile = resolveTerminalProfile(DEFAULT_TERMINAL_PROFILES, "default");
    const shellProfile = resolveTerminalProfile(DEFAULT_TERMINAL_PROFILES, "shell");

    expect(defaultProfile).toMatchObject({
      id: "default",
      name: "Lyra",
      startupCommand: "__lyra_agent_cli__",
      mode: "command"
    });
    expect(createTerminalProfilePaneOptions(defaultProfile, 1)).toMatchObject({
      profileId: "default",
      command: "__lyra_agent_cli__",
      mode: "command"
    });
    expect(shellProfile).toMatchObject({
      id: "shell",
      name: "Shell"
    });
    expect(createTerminalProfilePaneOptions(shellProfile, 2)).not.toHaveProperty("command");
  });

  test("creates pane options from startup command profile", () => {
    const profile = resolveTerminalProfile(DEFAULT_TERMINAL_PROFILES, "task");
    const options = createTerminalProfilePaneOptions(profile, 3);

    expect(options.title).toBe("Task");
    expect(options.profileId).toBe("task");
    expect(options.mode).toBe("command");
    expect(options.command).toBe("npm test");
    expect("themePresetId" in options).toBe(false);
  });
});
