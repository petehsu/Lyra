import { describe, expect, test } from "vitest";

import { decodeNativeDownloadSegments } from "../native-planner";

describe("download native planner bridge", () => {
  test("decodes native segment plans", () => {
    expect(decodeNativeDownloadSegments({
      segments: [
        {
          index: 0,
          start: 0,
          endInclusive: 99
        },
        {
          index: 1,
          start: 100,
          endInclusive: null
        }
      ]
    })).toEqual([
      {
        index: 0,
        start: 0,
        end: 99
      },
      {
        index: 1,
        start: 100,
        end: null
      }
    ]);
  });

  test("rejects malformed native segment plans", () => {
    expect(decodeNativeDownloadSegments({ segments: [] })).toBeNull();
    expect(decodeNativeDownloadSegments({
      segments: [{ index: "0", start: 0, endInclusive: 1 }]
    })).toBeNull();
  });
});
