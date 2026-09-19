import { describe, expect, test } from "vitest";

import type { ProductAnnouncement } from "../../../shared/desktop-bridge";
import {
  announcementToPublishRequest,
  officialNotificationId,
  officialNotificationUnchanged
} from "./use-workbench-product-announcements";

const announcement = (
  overrides: Partial<ProductAnnouncement> = {}
): ProductAnnouncement => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Notice",
  preview: "Hello",
  body: "**Hi**",
  bodyKind: "markdown",
  level: "info",
  publishedAtMs: 1_726_000_000_000,
  ...overrides
});

describe("official product announcement ingest", () => {
  test("maps a published row onto the existing inbox with a stable id", () => {
    const request = announcementToPublishRequest(
      announcement({
        pageUrl: "https://lyra.ltd/blog",
        imageUrl: "https://lyra.ltd/og.png"
      }),
      undefined,
      "Lyra",
      false
    );

    expect(request).toMatchObject({
      id: officialNotificationId("11111111-1111-4111-8111-111111111111"),
      bodyKind: "markdown",
      previewBehavior: "show",
      source: { id: "lyra-official", title: "Lyra", iconKey: "system" },
      target: {
        kind: "page-tab",
        address: "https://lyra.ltd/blog",
        title: "Notice"
      }
    });
    expect(request.readAt).toBeUndefined();
  });

  test("keeps readAt and stays silent when the same official id is seen again", () => {
    const existing = {
      id: officialNotificationId("11111111-1111-4111-8111-111111111111"),
      readAt: 99
    };

    const request = announcementToPublishRequest(
      announcement({ bodyKind: "plain" }),
      existing,
      "Lyra",
      true
    );

    expect(request.readAt).toBe(99);
    expect(request.previewBehavior).toBe("silent");
    expect(request.target).toEqual({ kind: "none" });
  });

  test("treats an unchanged official row as already in the inbox", () => {
    const request = announcementToPublishRequest(
      announcement({ pageUrl: "https://lyra.ltd/blog" }),
      undefined,
      "Lyra",
      true
    );
    const existing = {
      id: request.id ?? "",
      title: request.title,
      preview: request.preview,
      ...(request.body === undefined ? {} : { body: request.body }),
      ...(request.bodyKind === undefined ? {} : { bodyKind: request.bodyKind }),
      ...(request.imageUrl === undefined ? {} : { imageUrl: request.imageUrl }),
      level: request.level,
      source: request.source,
      target: request.target,
      createdAt: request.createdAt ?? 0
    };

    expect(officialNotificationUnchanged(existing, request)).toBe(true);
    expect(officialNotificationUnchanged(
      { ...existing, preview: "changed" },
      request
    )).toBe(false);
  });
});
