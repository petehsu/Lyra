import { describe, expect, test } from "vitest";

import {
  createRealProfileSelectionQuestionError,
  resolveBrowserUseProfileSelection,
} from "../profiles";

describe("browser-use real profile prompting", () => {
  test("resolves human-readable profile selections back to the Chrome directory", () => {
    const resolved = resolveBrowserUseProfileSelection(
      [
        {
          id: "chrome:Default",
          browserId: "chrome",
          browserName: "Google Chrome",
          profileName: "Personal",
          profileDirectory: "Default",
          userDataDir: "/tmp/chrome",
          isDefault: true,
        },
      ],
      "Google Chrome · Personal",
    );

    expect(resolved?.profileDirectory).toBe("Default");
  });

  test("builds a structured in-task question for profile selection", () => {
    const error = createRealProfileSelectionQuestionError([
      {
        id: "chrome:Default",
        browserId: "chrome",
        browserName: "Google Chrome",
        profileName: "Personal",
        profileDirectory: "Default",
        userDataDir: "/tmp/chrome",
        isDefault: true,
      },
      {
        id: "edge:Profile 1",
        browserId: "edge",
        browserName: "Microsoft Edge",
        profileName: "Work",
        profileDirectory: "Profile 1",
        userDataDir: "/tmp/edge",
        isDefault: false,
      },
    ]);

    expect(error.code).toBe("AGENT_PLAN_QUESTION_REQUIRED");
    expect(error.details.questions).toHaveLength(1);
    expect(error.details.questions[0]?.id).toBe("profile_name");
    expect(error.details.questions[0]?.options[0]?.label).toContain("Google Chrome");
    expect(error.details.questions[0]?.options[0]?.preview).toContain("\"profileDirectory\": \"Default\"");
    expect(error.details.allowNote).toBe(false);
  });
});
