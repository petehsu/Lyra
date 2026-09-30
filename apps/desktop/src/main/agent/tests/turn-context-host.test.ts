import { describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ persona: vi.fn(() => ({ timezone: "UTC" })), consent: vi.fn(() => ({ osintEnabled: false })) }));
vi.mock("../host-persona-context", () => ({ readHostPersonaContextPayload: mocks.persona }));
vi.mock("../../persona/consent-service", () => ({ readConsent: mocks.consent }));
import { createTurnContextHost } from "../turn-context-host";
import { createWorkbenchStateMock } from "./workbench-state-mock";

describe("turn context capture", () => {
  test("reads workspace once, uses the pushed catalog, and skips browser recovery for files", async () => {
    const listTabs = vi.fn(async () => ({ activeTabId: "file", tabs: [{ tabId: "file", title: "README.md", observationKind: "file-editor" }], visibleTabIds: ["file"], layout: { layoutMode: "single" } }));
    const readSessionSnapshot = vi.fn(() => ({ activeTabId: "browser" }));
    const snapshot = vi.fn(() => ({ software: [], hostCapabilityAvailable: true }));
    const capture = createTurnContextHost({
      getWindow: () => null,
      getWorkbenchObservationService: () => ({ listTabs }) as never,
      getBrowserBridge: () => ({ readSessionSnapshot }) as never,
      software: { snapshot } as never, workbenchState: createWorkbenchStateMock()
    });
    const result = await capture();
    expect(listTabs).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(readSessionSnapshot).not.toHaveBeenCalled();
    expect(result.workspace.activeTabTitle).toBe("README.md");
    expect(result.personaSignalsAllowed).toBe(false);
    expect(result.browserRecovery).toBeNull();
  });

  test("refreshes workspace between turns and only reads browser recovery when relevant", async () => {
    const listTabs = vi.fn().mockResolvedValueOnce({ tabs: [{ pageKind: "page" }], visibleTabIds: [], layout: {} }).mockRejectedValueOnce(new Error("window closed"));
    const readSessionSnapshot = vi.fn(() => ({ schemaVersion: 1 }));
    const capture = createTurnContextHost({ getWindow: () => null,
      getWorkbenchObservationService: () => ({ listTabs }) as never,
      getBrowserBridge: () => ({ readSessionSnapshot }) as never,
      software: { snapshot: () => ({ software: [], hostCapabilityAvailable: false }) } as never,
      workbenchState: createWorkbenchStateMock()
    });
    expect((await capture()).browserRecovery).toEqual({ schemaVersion: 1 });
    expect((await capture()).workbench).toEqual({ hostCapabilityAvailable: false, tabs: [] });
    expect(listTabs).toHaveBeenCalledTimes(2);
    expect(readSessionSnapshot).toHaveBeenCalledTimes(1);
  });
});
