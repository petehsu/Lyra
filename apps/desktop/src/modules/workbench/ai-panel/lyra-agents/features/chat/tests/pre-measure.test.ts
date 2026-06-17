import { describe, expect, test } from "vitest";

import type { ChatMessage } from "../../../core/types";
import { estimatePlainTextHeight } from "../pre-measure";

const plainMessage = (body: string): ChatMessage => ({
  id: "m1",
  author: "agent",
  blocks: [{ type: "text", id: "t1", body }]
});

const config = {
  font: '15px "Geist Sans", system-ui, sans-serif',
  contentWidth: 320,
  lineHeight: 22,
  verticalPadding: 48
} as const;

describe("estimatePlainTextHeight", () => {
  test("returns a positive height for plain text when canvas measurement works", () => {
    const canvas = document.createElement("canvas");
    const height = estimatePlainTextHeight(
      plainMessage("Hello from Lyra Agents."),
      config
    );
    if (canvas.getContext("2d") === null) {
      expect(height).toBeNull();
      return;
    }
    expect(height).not.toBeNull();
    expect(height!).toBeGreaterThan(config.verticalPadding);
  });

  test("returns null for markdown-shaped text", () => {
    expect(
      estimatePlainTextHeight(plainMessage("## Heading\n\n- item"), config)
    ).toBeNull();
  });

  test("returns null for mixed block types", () => {
    const message: ChatMessage = {
      id: "m2",
      author: "user",
      blocks: [
        { type: "text", id: "t1", body: "hello" },
        {
          type: "tools",
          id: "g1",
          group: {
            id: "g1",
            label: "Run",
            status: "done",
            calls: []
          }
        }
      ]
    };
    expect(estimatePlainTextHeight(message, config)).toBeNull();
  });

  test("returns null for empty plain text", () => {
    expect(estimatePlainTextHeight(plainMessage("   "), config)).toBeNull();
  });
});