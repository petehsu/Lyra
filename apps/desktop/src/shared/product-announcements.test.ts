import { describe, expect, test } from "vitest";

import {
  isPublicHttpsUrl,
  parseProductAnnouncement,
  parseProductAnnouncementList
} from "./product-announcements";

describe("product announcements", () => {
  test("accepts published supabase rows and https assets", () => {
    const parsed = parseProductAnnouncement({
      id: "11111111-1111-4111-8111-111111111111",
      title: "Notice",
      preview: "Hello",
      body: "**Hi**",
      body_kind: "markdown",
      page_url: "https://lyra.ltd/blog",
      image_url: "https://lyra.ltd/og.png",
      level: "info",
      published_at: "2026-09-18T10:00:00.000Z"
    });

    expect(parsed).toMatchObject({
      title: "Notice",
      bodyKind: "markdown",
      pageUrl: "https://lyra.ltd/blog",
      imageUrl: "https://lyra.ltd/og.png",
      publishedAtMs: Date.parse("2026-09-18T10:00:00.000Z")
    });
    expect(isPublicHttpsUrl("https://lyra.ltd")).toBe(true);
    expect(isPublicHttpsUrl("http://lyra.ltd")).toBe(false);
    expect(isPublicHttpsUrl("file:///tmp/a")).toBe(false);
  });

  test("drops incomplete rows and javascript urls", () => {
    expect(parseProductAnnouncement({ title: "Nope" })).toBeNull();
    const parsed = parseProductAnnouncementList([
      {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Keep",
        preview: "ok",
        published_at: "2026-09-18T10:00:00.000Z",
        page_url: "javascript:alert(1)"
      },
      { id: "bad" }
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      title: "Keep",
      bodyKind: "plain"
    });
    expect(parsed[0]?.pageUrl).toBeUndefined();
  });
});
