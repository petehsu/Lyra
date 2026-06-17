import { describe, expect, test } from "vitest";

import type { LocationCandidate } from "../../../../shared/desktop-bridge";
import {
  LOCATION_CACHE_TTL_MS,
  createLocationFix,
  formatCoordinateDisplayName,
  normalizeLocationState,
  selectBestLocationCandidate,
  selectBestPhysicalLocationCandidate
} from "../model";
import type { LocationResolvedCandidate } from "../../../../shared/desktop-bridge";

const baseCandidate = (
  id: string,
  source: LocationResolvedCandidate["source"],
  options: Partial<LocationResolvedCandidate> = {}
): LocationResolvedCandidate => ({
  id,
  source,
  status: "ok",
  latitude: 31.2304,
  longitude: 121.4737,
  accuracyMeters: 100,
  capturedAt: "2026-06-17T00:00:00.000Z",
  ...options
});

const rawCandidate = (
  id: string,
  source: LocationCandidate["source"],
  options: Partial<LocationCandidate> = {}
): LocationCandidate => ({
  id,
  source,
  status: "ok",
  latitude: 31.2304,
  longitude: 121.4737,
  accuracyMeters: 100,
  capturedAt: "2026-06-17T00:00:00.000Z",
  ...options
});

describe("workbench location model", () => {
  test("normalizes empty and expired state", () => {
    expect(normalizeLocationState(null)).toEqual({
      consent: "unknown",
      startupPromptAnswered: false
    });

    const expired = JSON.stringify({
      consent: "granted",
      startupPromptAnswered: true,
      fix: {
        displayName: "Shanghai",
        latitude: 31.2304,
        longitude: 121.4737,
        source: "browser",
        capturedAt: "2026-06-16T00:00:00.000Z",
        expiresAt: "2026-06-16T01:00:00.000Z"
      }
    });

    expect(normalizeLocationState(expired, Date.parse("2026-06-17T00:00:00.000Z"))).toEqual({
      consent: "granted",
      startupPromptAnswered: true
    });
  });

  test("preserves valid cached fix before TTL expiry", () => {
    const raw = JSON.stringify({
      consent: "granted",
      startupPromptAnswered: true,
      fix: {
        displayName: "上海市黄浦区",
        latitude: 31.2304,
        longitude: 121.4737,
        accuracyMeters: 50,
        source: "os",
        capturedAt: "2026-06-17T00:00:00.000Z",
        expiresAt: "2026-06-18T00:00:00.000Z"
      }
    });

    expect(normalizeLocationState(raw, Date.parse("2026-06-17T12:00:00.000Z")).fix?.displayName)
      .toBe("上海市黄浦区");
  });

  test("selectBestPhysicalLocationCandidate prefers lower accuracy and OS source", () => {
    const selected = selectBestPhysicalLocationCandidate([
      rawCandidate("browser", "browser", { accuracyMeters: 120 }),
      rawCandidate("os", "os", { accuracyMeters: 30 })
    ]);

    expect(selected?.id).toBe("os");
  });

  test("ignores IP candidates for physical selection", () => {
    const selected = selectBestPhysicalLocationCandidate([
      rawCandidate("ip", "ip", { accuracyMeters: 50_000, label: "Shanghai" })
    ]);

    expect(selected).toBeNull();
  });

  test("selects precise physical address over coarse browser coordinates", () => {
    const selected = selectBestLocationCandidate([
      baseCandidate("browser", "browser", {
        accuracyMeters: 80,
        resolvedAddress: {
          displayName: "南京东路 1 号",
          precision: "house"
        }
      })
    ]);

    expect(selected?.candidate.id).toBe("browser");
    expect(selected?.displayName).toBe("南京东路 1 号");
  });

  test("uses accuracy as tie-breaker at same precision", () => {
    const selected = selectBestLocationCandidate([
      baseCandidate("browser", "browser", {
        accuracyMeters: 120,
        resolvedAddress: {
          displayName: "上海市",
          precision: "city"
        }
      }),
      baseCandidate("os", "os", {
        accuracyMeters: 30,
        resolvedAddress: {
          displayName: "上海市",
          precision: "city"
        }
      })
    ]);

    expect(selected?.candidate.id).toBe("os");
  });

  test("ignores IP candidates after reverse geocode", () => {
    const selected = selectBestLocationCandidate([
      baseCandidate("ip", "ip", {
        accuracyMeters: 50_000,
        label: "Shanghai, China"
      }),
      baseCandidate("browser", "browser", {
        latitude: 31.234567,
        longitude: 121.456789,
        accuracyMeters: 40
      })
    ]);

    expect(selected?.candidate.id).toBe("browser");
    expect(selected?.displayName).toBe(formatCoordinateDisplayName(31.234567, 121.456789));
  });

  test("falls back to coordinates when no name is available", () => {
    const selected = selectBestLocationCandidate([
      baseCandidate("browser", "browser", {
        latitude: 31.234567,
        longitude: 121.456789,
        accuracyMeters: 40
      })
    ]);

    expect(selected?.displayName).toBe(formatCoordinateDisplayName(31.234567, 121.456789));
  });

  test("creates fix with fixed 24 hour TTL", () => {
    const selected = selectBestLocationCandidate([
      baseCandidate("browser", "browser", {
        resolvedAddress: {
          displayName: "上海",
          precision: "city"
        }
      })
    ]);
    expect(selected).not.toBeNull();

    const now = new Date("2026-06-17T00:00:00.000Z");
    const fix = createLocationFix(selected!, now);

    expect(Date.parse(fix!.expiresAt) - now.getTime()).toBe(LOCATION_CACHE_TTL_MS);
  });
});