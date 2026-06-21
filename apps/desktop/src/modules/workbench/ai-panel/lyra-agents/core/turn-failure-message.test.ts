import { describe, expect, test } from "vitest";

import {
  isInternalRuntimeFallbackText,
  isTurnFailureCode,
  mapTurnFailureMessage,
  TURN_FAILURE_CODES
} from "./turn-failure-message";

describe("mapTurnFailureMessage", () => {
  test("maps structured empty-response failure codes", () => {
    expect(
      mapTurnFailureMessage("provider returned no assistant text or tool call", TURN_FAILURE_CODES.emptyResponse)
    ).toBe("The model returned no usable response. Try again or switch models.");
  });

  test("maps structured timeout failure codes", () => {
    expect(
      mapTurnFailureMessage("provider request timed out", TURN_FAILURE_CODES.timeout)
    ).toBe("The model timed out. Try again in a moment.");
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

  test("maps browser blocked failure codes to a dedicated message", () => {
    expect(mapTurnFailureMessage("ignored", TURN_FAILURE_CODES.browserBlocked)).toBe(
      "An upload or permission dialog is blocking browser automation. Close it and try again."
    );
  });
});

describe("isTurnFailureCode", () => {
  test("accepts runtime failure codes", () => {
    expect(isTurnFailureCode(TURN_FAILURE_CODES.emptyResponse)).toBe(true);
    expect(isTurnFailureCode("provider returned no assistant text or tool call")).toBe(false);
  });
});

describe("isInternalRuntimeFallbackText", () => {
  test("detects legacy runtime fallback assistant bubbles", () => {
    expect(
      isInternalRuntimeFallbackText(
        "Lyra native agent runtime is active, but the model call could not run: boom."
      )
    ).toBe(true);
    expect(isInternalRuntimeFallbackText(TURN_FAILURE_CODES.emptyResponse)).toBe(true);
    expect(isInternalRuntimeFallbackText("Here is the answer you asked for.")).toBe(false);
  });
});