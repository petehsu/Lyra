import { describe, expect, test } from "vitest";

import {
  AREA_RETINT_CANDIDATE_SELECTOR,
  AREA_RETINT_MARK_ATTR,
  buildAreaRetintDisableScript,
  buildAreaRetintScript,
  buildAreaRetintUpdateScript,
  classifyAreaAction,
  DEFAULT_AREA_RETINT_THRESHOLDS
} from "../area-retint";
import { buildWebThemeSnapshot } from "../theme-bridge";

describe("classifyAreaAction", () => {
  const { largeRatio, midRatio } = DEFAULT_AREA_RETINT_THRESHOLDS;

  test("below mid threshold is always a no-op", () => {
    expect(classifyAreaAction(midRatio - 0.01, true, true)).toBe("none");
    expect(classifyAreaAction(0, true, true)).toBe("none");
  });

  test("mid <= ratio < large with gradient strips the image only", () => {
    const ratio = (midRatio + largeRatio) / 2;
    expect(classifyAreaAction(ratio, true, false)).toBe("remove-image");
  });

  test("mid <= ratio < large without gradient stays none", () => {
    const ratio = (midRatio + largeRatio) / 2;
    expect(classifyAreaAction(ratio, false, true)).toBe("none");
    expect(classifyAreaAction(ratio, false, false)).toBe("none");
  });

  test("ratio >= large with gradient triggers recolor + remove-image", () => {
    expect(classifyAreaAction(largeRatio, true, false)).toBe(
      "recolor-and-remove-image"
    );
    expect(classifyAreaAction(1, true, false)).toBe("recolor-and-remove-image");
  });

  test("ratio >= large with light bg triggers recolor even without gradient", () => {
    expect(classifyAreaAction(largeRatio, false, true)).toBe(
      "recolor-and-remove-image"
    );
  });

  test("ratio >= large with dark bg and no gradient stays none", () => {
    expect(classifyAreaAction(1, false, false)).toBe("none");
  });

  test("custom thresholds are honored", () => {
    expect(
      classifyAreaAction(0.25, true, false, { largeRatio: 0.2, midRatio: 0.1 })
    ).toBe("recolor-and-remove-image");
    expect(
      classifyAreaAction(0.25, true, false, { largeRatio: 0.5, midRatio: 0.3 })
    ).toBe("none");
  });
});

const enabledSnapshot = () =>
  buildWebThemeSnapshot({
    vars: {
      "--lyra-bg-app": "#131416",
      "--lyra-text-primary": "#ededed"
    },
    enabled: true,
    previousRevision: 0
  });

describe("buildAreaRetintScript", () => {
  test("embeds snapshot, thresholds, and selector as valid JSON literals", () => {
    const snapshot = enabledSnapshot();
    const script = buildAreaRetintScript({ snapshot });
    expect(script).toContain(JSON.stringify(snapshot));
    expect(script).toContain(JSON.stringify(AREA_RETINT_CANDIDATE_SELECTOR));
    expect(script).toContain(JSON.stringify(AREA_RETINT_MARK_ATTR));
    expect(script).toContain(String(DEFAULT_AREA_RETINT_THRESHOLDS.largeRatio));
    expect(script).toContain(String(DEFAULT_AREA_RETINT_THRESHOLDS.midRatio));
  });

  test("exposes the hot-swap hook and a guard against double-install", () => {
    const script = buildAreaRetintScript({ snapshot: enabledSnapshot() });
    expect(script).toContain("window.__lyraAreaRetintUpdate");
    expect(script).toContain("window.__lyraAreaRetintInstalled");
  });

  test("respects custom thresholds + candidate cap", () => {
    const script = buildAreaRetintScript({
      snapshot: enabledSnapshot(),
      thresholds: { largeRatio: 0.33, midRatio: 0.11 },
      candidateCap: 80
    });
    expect(script).toContain("0.33");
    expect(script).toContain("0.11");
    expect(script).toContain("80");
  });

  test("clamps candidate cap into a safe range", () => {
    const tiny = buildAreaRetintScript({
      snapshot: enabledSnapshot(),
      candidateCap: 1
    });
    expect(tiny).toContain("10");
    const giant = buildAreaRetintScript({
      snapshot: enabledSnapshot(),
      candidateCap: 100_000
    });
    expect(giant).toContain("2000");
  });
});

describe("buildAreaRetintUpdateScript", () => {
  test("sends the snapshot through the hot-swap hook", () => {
    const snapshot = enabledSnapshot();
    const script = buildAreaRetintUpdateScript(snapshot);
    expect(script).toContain("window.__lyraAreaRetintUpdate");
    expect(script).toContain(JSON.stringify(snapshot));
  });
});

describe("buildAreaRetintDisableScript", () => {
  test("flips the stage off via the hot-swap hook", () => {
    const script = buildAreaRetintDisableScript();
    expect(script).toContain("window.__lyraAreaRetintUpdate");
    expect(script).toContain("enabled: false");
  });
});
