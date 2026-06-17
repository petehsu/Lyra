import { describe, expect, test } from "vitest";

import type { AgentImageAttachment } from "../../../core/types";
import { inlineImageMarkerIds, validateImageTurnCommit } from "../composer-image";

describe("composer-image commit validation", () => {
  test("extracts inline image marker ids", () => {
    expect(inlineImageMarkerIds("⟦image:img-a⟧ hello ⟦image:img-b⟧"))
      .toEqual(["img-a", "img-b"]);
  });

  test("rejects text markers without synced attachments", () => {
    expect(validateImageTurnCommit("⟦image:img-1⟧这是什么", []))
      .toMatch(/did not sync/i);
  });

  test("accepts path-only attachments for markers", () => {
    const images: AgentImageAttachment[] = [{
      id: "img-1",
      mediaType: "image/png",
      data: "",
      source: "/Users/test/Desktop/shot.png",
      label: "shot.png"
    }];
    expect(validateImageTurnCommit("⟦image:img-1⟧这是什么", images)).toBeNull();
  });
});