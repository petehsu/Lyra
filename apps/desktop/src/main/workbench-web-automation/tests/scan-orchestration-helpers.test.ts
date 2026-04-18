import { describe, expect, test } from "vitest";

import {
  adaptiveScanScopes,
  readMicroExecutorStepBudget,
} from "../service-modules/scan-orchestration-helpers";

describe("scan orchestration helpers", () => {
  test("maps micro executor budget config to step budget", () => {
    expect(readMicroExecutorStepBudget({
      readLyraDirectMicroExecutorBudget: () => "1-2"
    } as any)).toBe(2);
    expect(readMicroExecutorStepBudget({
      readLyraDirectMicroExecutorBudget: () => "6-8"
    } as any)).toBe(8);
    expect(readMicroExecutorStepBudget({
      readLyraDirectMicroExecutorBudget: () => "3-5"
    } as any)).toBe(5);
    expect(readMicroExecutorStepBudget({} as any)).toBe(5);
  });

  test("expands adaptive scan scopes by preferred scope", () => {
    expect(adaptiveScanScopes("visible")).toEqual(["visible", "nearby", "expanded"]);
    expect(adaptiveScanScopes("nearby")).toEqual(["nearby", "expanded"]);
    expect(adaptiveScanScopes("expanded")).toEqual(["expanded"]);
  });
});
