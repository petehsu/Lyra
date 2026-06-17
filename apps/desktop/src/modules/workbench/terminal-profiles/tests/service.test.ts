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

  test("default profile is a plain terminal shell", () => {
    const defaultProfile = resolveTerminalProfile(DEFAULT_TERMINAL_PROFILES, "default");

    expect(defaultProfile).toMatchObject({
      id: "default",
      name: "Terminal"
    });
    expect(createTerminalProfilePaneOptions(defaultProfile, 1)).toMatchObject({
      profileId: "default",
      title: "Terminal"
    });
    expect(createTerminalProfilePaneOptions(defaultProfile, 1)).not.toHaveProperty("command");
    expect(createTerminalProfilePaneOptions(defaultProfile, 1)).not.toHaveProperty("mode");
    expect(DEFAULT_TERMINAL_PROFILES).toHaveLength(1);
    expect(DEFAULT_TERMINAL_PROFILES[0]?.startupCommand).toBeUndefined();
    expect(DEFAULT_TERMINAL_PROFILES[0]?.name).toBe("Terminal");
  });

  test("creates pane options from startup command profile", () => {
    const options = createTerminalProfilePaneOptions(
      {
        id: "task",
        name: "Task",
        shell: "zsh",
        startupCommand: "npm test",
        mode: "command"
      },
      3
    );

    expect(options.title).toBe("Task");
    expect(options.profileId).toBe("task");
    expect(options.mode).toBe("command");
    expect(options.command).toBe("npm test");
    expect("themePresetId" in options).toBe(false);
  });
});
