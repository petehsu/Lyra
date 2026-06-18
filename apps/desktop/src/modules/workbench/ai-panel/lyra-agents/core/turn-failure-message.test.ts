import { describe, expect, test } from "vitest";

import {
  isInternalRuntimeFallbackText,
  isInternalTurnFailureDetail,
  mapTurnFailureMessage
} from "./turn-failure-message";

describe("mapTurnFailureMessage", () => {
  test("maps provider empty-response internals to a friendly empty-response message", () => {
    expect(
      mapTurnFailureMessage("provider returned no assistant text or tool call")
    ).toBe("The model returned no usable response. Try again or switch models.");
  });

  test("maps timeout failures without exposing raw provider text", () => {
    expect(mapTurnFailureMessage("provider request timed out")).toBe(
      "The model timed out. Try again in a moment."
    );
  });

  test("maps blank failures to the empty-response message", () => {
    expect(mapTurnFailureMessage("")).toBe(
      "The model returned no usable response. Try again or switch models."
    );
  });

  test("maps unknown failures to the generic message", () => {
    expect(mapTurnFailureMessage("something unexpected happened")).toBe(
      "This turn did not complete. You can send your message again."
    );
  });
});

describe("isInternalRuntimeFallbackText", () => {
  test("detects legacy runtime fallback assistant bubbles", () => {
    expect(
      isInternalRuntimeFallbackText(
        "Lyra native agent runtime is active, but the model call could not run: boom."
      )
    ).toBe(true);
    expect(isInternalTurnFailureDetail("provider returned no assistant text or tool call")).toBe(
      true
    );
    expect(isInternalRuntimeFallbackText("Here is the answer you asked for.")).toBe(false);
  });
});