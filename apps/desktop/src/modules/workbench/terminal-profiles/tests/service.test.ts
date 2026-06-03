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
