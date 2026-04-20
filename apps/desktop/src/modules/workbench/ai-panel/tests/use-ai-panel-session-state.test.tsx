import { renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import { useAiPanelSessionState } from "../use-ai-panel-session-state";

describe("useAiPanelSessionState", () => {
  test("builds composer model options and backfills selected model", async () => {
    const setPlanModeArmedBySession = vi.fn();

    const { result } = renderHook(() => {
      const [selectedModelBySession, setSelectedModelBySession] =
        useState<Readonly<Record<string, string>>>({});

      const session = useAiPanelSessionState({
        profiles: [
          {
            id: "p-default",
            model: "gpt-5",
            customModels: [{ id: "gpt-5-mini" }],
            isDefault: true
          },
          {
            id: "p-alt",
            model: "claude-3.7",
            customModels: [],
            isDefault: false
          }
        ] as any,
        activeDetail: {
          session: {
            id: "s-1",
            profileId: "p-alt",
            collaborationMode: "default"
          }
        } as any,
        defaultProfileId: "p-default",
        defaultModelNames: ["fallback-a", "fallback-b"],
        selectedModelBySession,
        setSelectedModelBySession,
        activeSessionId: "s-1",
        planModeArmedBySession: {},
        setPlanModeArmedBySession,
      });

      return {
        session,
        selectedModelBySession,
      };
    });

    await waitFor(() => {
      expect(result.current.selectedModelBySession["s-1"]).toBe("gpt-5");
    });

    expect(result.current.session.composerModelNames).toEqual(["gpt-5", "gpt-5-mini", "claude-3.7"]);
    expect(result.current.session.activeComposerModel).toBe("gpt-5");
    expect(result.current.session.selectedComposerProfileId).toBe("p-default");
  });
});
