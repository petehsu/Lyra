import { describe, expect, test } from "vitest";

import {
  resolveBundledRustAnalyzerCandidates,
  resolveCurrentRustAnalyzerTarget,
  RUST_ANALYZER_BUNDLE_TARGETS
} from "../runtime-paths";

describe("lsp runtime paths", () => {
  test("has stable bundle target list", () => {
    expect(RUST_ANALYZER_BUNDLE_TARGETS.length).toBe(6);
    expect(RUST_ANALYZER_BUNDLE_TARGETS.some((target) => target.id === "linux-x64")).toBe(true);
    expect(RUST_ANALYZER_BUNDLE_TARGETS.some((target) => target.id === "win32-arm64")).toBe(true);
  });

  test("resolves current rust-analyzer target by platform and arch", () => {
    expect(resolveCurrentRustAnalyzerTarget("linux", "x64")?.id).toBe("linux-x64");
    expect(resolveCurrentRustAnalyzerTarget("darwin", "arm64")?.id).toBe("darwin-arm64");
    expect(resolveCurrentRustAnalyzerTarget("linux", "ppc64" as NodeJS.Architecture)).toBeNull();
  });

  test("builds deduplicated candidate paths across roots", () => {
    const candidates = resolveBundledRustAnalyzerCandidates(
      ["/a", "/a", "/b"],
      "linux",
      "x64"
    );

    expect(candidates.length).toBe(new Set(candidates).size);
    expect(candidates.some((path) => path.endsWith("/lsp/linux-x64/rust-analyzer"))).toBe(true);
    expect(candidates.some((path) => path.endsWith("/resources/lsp/linux-x64/rust-analyzer"))).toBe(true);
    expect(candidates.some((path) => path.endsWith("/apps/desktop/resources/lsp/linux-x64/rust-analyzer"))).toBe(true);
  });

  test("returns empty candidates when target is unsupported", () => {
    expect(
      resolveBundledRustAnalyzerCandidates(
        ["/a"],
        "linux",
        "ppc64" as NodeJS.Architecture
      )
    ).toEqual([]);
  });
});
