import { describe, expect, test } from "vitest";

import { loginMapNote } from "../login-map-note";

const password = [{ inputType: "password" }];

describe("loginMapNote", () => {
  test("stays quiet when the page has no password field", () => {
    expect(loginMapNote("https://chat.example/sign_in", [{ inputType: "text" }], [
      { origin: "https://chat.example", username: "ada" }
    ])).toBe("");
  });

  test("names the saved account and leaves the password out", () => {
    const note = loginMapNote("https://chat.example/sign_in", password, [
      { origin: "https://chat.example", username: "ada" },
      { origin: "https://other.example", username: "secret-other" }
    ]);
    expect(note).toBe("Saved sign-in for this site: ada");
    expect(note).not.toContain("secret");
  });

  test("says when this site has no saved sign-in", () => {
    expect(loginMapNote("https://chat.example/sign_in", password, [])).toBe(
      "No saved sign-in for this site."
    );
  });
});
