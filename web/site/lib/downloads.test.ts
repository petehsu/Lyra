import assert from "node:assert/strict";
import test from "node:test";
import { detectDesktop, recommendedVariant, variantsFor } from "./downloads";

test("UA-CH selects Windows ARM64 before legacy UA markers", async () => {
  const detected = await detectDesktop({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    userAgentData: {
      getHighEntropyValues: async () => ({ platform: "Windows", architecture: "arm", bitness: "64", wow64: false })
    }
  });
  assert.deepEqual(detected, { platform: "windows", architecture: "arm64" });
  assert.equal(recommendedVariant(detected, "windows")?.format, "exe");
});

test("explicit UA architecture selects the Linux AppImage", async () => {
  const detected = await detectDesktop({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)" });
  assert.deepEqual(detected, { platform: "linux", architecture: "x64" });
  assert.equal(recommendedVariant(detected, "linux")?.format, "AppImage");
});

test("MacIntel identifies the OS but never guesses the architecture", async () => {
  const detected = await detectDesktop({
    platform: "MacIntel",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15"
  });
  assert.deepEqual(detected, { platform: "macos" });
  assert.equal(recommendedVariant(detected, "macos"), null);
});

test("unknown systems remain unselected and Linux exposes ten combinations", async () => {
  assert.equal(await detectDesktop({ userAgent: "Mozilla/5.0" }), null);
  assert.equal(variantsFor("linux").length, 10);
});

