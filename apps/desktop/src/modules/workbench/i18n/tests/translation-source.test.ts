import { describe, expect, test } from "vitest";

import { createPseudoLocaleSource } from "../translation-source";

describe("pseudo locale source", () => {
  test("expands visible text without corrupting interpolation variables", async () => {
    const source = createPseudoLocaleSource("pseudo", {
      greeting: "Welcome, {name}"
    });
    const value = (await source.loadBundle("pseudo")).greeting ?? "";

    expect(value).toContain("{name}");
    expect(value).not.toContain("{naame}");
    expect(value.length).toBeGreaterThan("Welcome, {name}".length);
  });
});
