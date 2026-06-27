import { describe, expect, test } from "vitest";

import {
  RING_CIRCUMFERENCE,
  ringColorClass,
  ringDashOffset,
  type RingStatus,
} from "../context-ring-logic";

describe("ringColorClass", () => {
  test("ok below 0.6", () => {
    expect(ringColorClass(0, "idle")).toBe("lyra-context-ring--ok");
    expect(ringColorClass(0.39, "idle")).toBe("lyra-context-ring--ok");
    expect(ringColorClass(0.59, "idle")).toBe("lyra-context-ring--ok");
  });

  test("warn from 0.6 to 0.82", () => {
    expect(ringColorClass(0.6, "idle")).toBe("lyra-context-ring--warn");
    expect(ringColorClass(0.81, "idle")).toBe("lyra-context-ring--warn");
  });

  test("danger at 0.82 and above", () => {
    expect(ringColorClass(0.82, "idle")).toBe("lyra-context-ring--danger");
    expect(ringColorClass(0.99, "idle")).toBe("lyra-context-ring--danger");
    expect(ringColorClass(1, "idle")).toBe("lyra-context-ring--danger");
  });

  test("compressing overrides rate-based color", () => {
    expect(ringColorClass(0.1, "compressing")).toBe("lyra-context-ring--compressing");
    expect(ringColorClass(0.95, "compressing")).toBe("lyra-context-ring--compressing");
  });

  test("failed overrides rate-based color", () => {
    expect(ringColorClass(0.1, "failed")).toBe("lyra-context-ring--failed");
    expect(ringColorClass(0.95, "failed")).toBe("lyra-context-ring--failed");
  });
});

describe("ringDashOffset", () => {
  test("full offset at rate 0 (empty ring)", () => {
    expect(ringDashOffset(0)).toBeCloseTo(RING_CIRCUMFERENCE, 5);
  });

  test("zero offset at rate 1 (full ring)", () => {
    expect(ringDashOffset(1)).toBeCloseTo(0, 5);
  });

  test("half offset at rate 0.5", () => {
    expect(ringDashOffset(0.5)).toBeCloseTo(RING_CIRCUMFERENCE * 0.5, 5);
  });

  test("clamps negative overshoot to 0", () => {
    expect(ringDashOffset(1.5)).toBeCloseTo(0, 5);
  });

  test("clamps negative rate to full offset", () => {
    expect(ringDashOffset(-0.3)).toBeCloseTo(RING_CIRCUMFERENCE, 5);
  });
});