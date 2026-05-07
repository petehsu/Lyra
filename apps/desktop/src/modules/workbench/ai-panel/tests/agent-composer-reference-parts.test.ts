import { describe, expect, test } from "vitest";

import type { AgentComposerSubmitPayload } from "../agent-composer";
import { runtimeInputFromComposerReferenceParts } from "../agent-composer-reference-parts";

describe("agent composer reference parts", () => {
  test("preserves text and reference order in runtime input", () => {
    const payload: AgentComposerSubmitPayload = {
      text: "Check first and second",
      attachments: [
        {
          id: "file:first",
          name: "first.ts",
          path: "/repo/first.ts",
          kind: "file",
          source: "mention-panel",
        },
        {
          id: "file:second",
          name: "second.ts",
          path: "/repo/second.ts",
          kind: "file",
          source: "mention-panel",
        },
      ],
      parts: [
        { type: "text", text: "Check " },
        {
          type: "attachment",
          attachment: {
            id: "file:first",
            name: "first.ts",
            path: "/repo/first.ts",
            kind: "file",
            source: "mention-panel",
          },
        },
        { type: "text", text: " before " },
        {
          type: "attachment",
          attachment: {
            id: "file:second",
            name: "second.ts",
            path: "/repo/second.ts",
            kind: "file",
            source: "mention-panel",
          },
        },
      ],
    };

    expect(runtimeInputFromComposerReferenceParts(payload).parts).toEqual([
      { type: "text", text: "Check " },
      {
        type: "attachment",
        attachment: { name: "first.ts", path: "/repo/first.ts", kind: "file" },
      },
      { type: "text", text: " before " },
      {
        type: "attachment",
        attachment: { name: "second.ts", path: "/repo/second.ts", kind: "file" },
      },
    ]);
  });
});
