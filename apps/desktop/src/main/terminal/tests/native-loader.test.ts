import path from "node:path";

import { describe, expect, test } from "vitest";

import { resolveNativeCandidates } from "../native-loader";

describe("terminal native loader", () => {
  test("includes default candidate paths", () => {
    const candidates = resolveNativeCandidates("/tmp/lyra-workspace");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((entry) => entry.includes("target"))).toBe(true);
  });

  test("prefers explicit env path when provided", () => {
    const previousValue = process.env.LYRA_TERMINAL_NATIVE_LIB;
    process.env.LYRA_TERMINAL_NATIVE_LIB = "./custom/native-addon";

    const candidates = resolveNativeCandidates("/repo");

    process.env.LYRA_TERMINAL_NATIVE_LIB = previousValue;

    expect(candidates[0]).toBe(path.resolve("/repo", "./custom/native-addon"));
  });
});
