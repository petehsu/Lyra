import { describe, expect, test } from "vitest";

import { resolveLocalIdentity } from "./local-identity";

describe("resolveLocalIdentity", () => {
  test("recognizes the last signed-in account without a network lookup", () => {
    expect(resolveLocalIdentity({
      displayName: "Local User",
      gitEmail: "Pete@Example.com",
      cached: {
        email: "pete@example.com",
        displayName: "Pete Hsu",
        avatarUrl: "https://example.com/avatar.png"
      }
    })).toEqual({
      displayName: "Local User",
      gitEmail: "Pete@Example.com",
      registered: true,
      registeredDisplayName: "Pete Hsu",
      registeredAvatarUrl: "https://example.com/avatar.png"
    });
  });

  test("does not expose a cached account for a different git email", () => {
    expect(resolveLocalIdentity({
      displayName: "Local User",
      gitEmail: "other@example.com",
      cached: {
        email: "pete@example.com",
        displayName: "Pete Hsu",
        avatarUrl: "https://example.com/avatar.png"
      }
    })).toEqual({
      displayName: "Local User",
      gitEmail: "other@example.com",
      registered: false
    });
  });
});
