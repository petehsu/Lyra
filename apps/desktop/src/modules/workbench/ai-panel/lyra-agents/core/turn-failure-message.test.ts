import { describe, expect, test } from "vitest";

import { isInternalRuntimeFallbackText } from "./turn-failure-message";

describe("isInternalRuntimeFallbackText", () => {
  test("detects legacy runtime fallback assistant bubbles", () => {
    expect(
      isInternalRuntimeFallbackText(
        "Lyra native agent runtime is active, but the model call could not run: boom."
      )
    ).toBe(true);
    expect(isInternalRuntimeFallbackText("This turn did not complete. You can send your message again.")).toBe(true);
    expect(isInternalRuntimeFallbackText("provider returned no assistant text or tool call")).toBe(false);
    expect(isInternalRuntimeFallbackText("Here is the answer you asked for.")).toBe(false);
  });
});
