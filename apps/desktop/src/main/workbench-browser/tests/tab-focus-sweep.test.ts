import { describe, expect, test } from "vitest";

import { selectNewTabStops, type TabStop } from "../view-manager-runtime/tab-focus-sweep";

const stop = (token: string, rest: Partial<TabStop> = {}): TabStop => ({
  token,
  collected: false,
  tagName: "input",
  role: "textbox",
  label: token,
  editable: true,
  disabled: false,
  textSnippet: "",
  inputType: "text",
  selectorPreview: "input",
  xpath: "/html/body/input[1]",
  offscreen: false,
  bounds: { x: 10, y: 20, width: 200, height: 28 },
  ...rest
});

describe("selectNewTabStops", () => {
  test("skips stops the selector already collected", () => {
    const result = selectNewTabStops([
      stop("password", { collected: true, label: "Password" }),
      stop("account", { label: "Phone number / email address" })
    ], true);
    expect(result.added.map((entry) => entry.token)).toEqual(["account"]);
    expect(result.unfinished).toBe(false);
  });

  test("adds an unmarked input and reports an unfinished sweep", () => {
    const result = selectNewTabStops(
      Array.from({ length: 48 }, (_, index) => stop(`field-${index}`)),
      false
    );
    expect(result.added).toHaveLength(48);
    expect(result.added[0]?.editable).toBe(true);
    expect(result.unfinished).toBe(true);
  });
});
