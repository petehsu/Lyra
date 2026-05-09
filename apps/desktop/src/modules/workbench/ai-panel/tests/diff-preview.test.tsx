import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { LiveDiffPreview } from "../diff-preview";

describe("LiveDiffPreview", () => {
  test("renders live edit deltas and finalized state from runtime events", () => {
    render(
      <LiveDiffPreview
        events={[
          {
            sessionId: "session-1",
            turnId: "turn-1",
            phase: "follow_live_edit_delta",
            payload: {
              filePath: "src/app.ts",
              diffHunks: [{
                path: "src/app.ts",
                changeType: "modified",
                additions: 2,
                deletions: 1,
              }],
            },
            timestamp: 1,
          },
          {
            sessionId: "session-1",
            turnId: "turn-1",
            phase: "follow_live_edit_finalized",
            payload: {
              filePath: "src/app.ts",
            },
            timestamp: 2,
          },
        ]}
      />
    );

    expect(screen.getByLabelText("Live diff preview")).toBeDefined();
    expect(screen.getByText("src/app.ts")).toBeDefined();
    expect(screen.getByText("finalized · +2 -1")).toBeDefined();
  });
});
