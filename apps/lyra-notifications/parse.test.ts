import assert from "node:assert/strict";
import test from "node:test";

import { parseNotificationSnapshot } from "./src/parse.ts";

test("keeps markdown, image, and page fields from Core", () => {
  const snapshot = parseNotificationSnapshot({
    notifications: [{
      id: "lyra-official-1",
      title: "Notice",
      preview: "Hello",
      body: "**Hi**",
      bodyKind: "markdown",
      imageUrl: "https://lyra.ltd/og.png",
      level: "info",
      source: { title: "Lyra", iconKey: "system" },
      target: { kind: "page-tab", address: "https://lyra.ltd/blog" },
      createdAt: 1
    }],
    selectedNotificationId: "lyra-official-1",
    unreadCount: 1
  });

  assert.equal(snapshot.notifications[0]?.bodyKind, "markdown");
  assert.equal(snapshot.notifications[0]?.imageUrl, "https://lyra.ltd/og.png");
  assert.equal(snapshot.notifications[0]?.target.kind, "page-tab");
});

test("drops javascript image urls", () => {
  const snapshot = parseNotificationSnapshot({
    notifications: [{
      id: "notice-1",
      title: "Notice",
      preview: "Hello",
      bodyKind: "image",
      imageUrl: "javascript:alert(1)",
      level: "info",
      source: { title: "Lyra" },
      target: { kind: "none" },
      createdAt: 1
    }],
    selectedNotificationId: null,
    unreadCount: 1
  });

  assert.equal(snapshot.notifications[0]?.bodyKind, "image");
  assert.equal(snapshot.notifications[0]?.imageUrl, undefined);
});
