import { describe, expect, test } from "vitest";

import type { WorkbenchObservedTabDescriptor } from "../../shared/workbench-observation";
import { resolveVisualEvidenceTarget } from "./visual-evidence-target";

const browserTab = (overrides?: Partial<WorkbenchObservedTabDescriptor>): WorkbenchObservedTabDescriptor => ({
  tabId: "browser-tab-1",
  title: "Local site",
  pageKind: "page",
  active: true,
  visible: true,
  focusedPane: true,
  observable: true,
  observationKind: "page",
  ...overrides
});

const settingsTab = (): WorkbenchObservedTabDescriptor => ({
  tabId: "settings-1",
  title: "Settings",
  pageKind: "settings",
  active: true,
  visible: true,
  focusedPane: true,
  observable: false
});

describe("resolveVisualEvidenceTarget", () => {
  test("empty args capture the active browser page instead of the workspace shell", () => {
    expect(
      resolveVisualEvidenceTarget(
        {},
        {
          activeTabId: "browser-tab-1",
          visibleTabIds: ["browser-tab-1"],
          layout: { layoutMode: "single", splitGroupTabIds: [], focusedSplitTabId: null },
          tabs: [browserTab()]
        }
      )
    ).toEqual({ mode: "active_tab", tabId: "browser-tab-1" });
  });

  test("explicit workspace_window keeps the shell capture", () => {
    expect(
      resolveVisualEvidenceTarget(
        { scope: "workspace_window" },
        {
          activeTabId: "browser-tab-1",
          visibleTabIds: ["browser-tab-1"],
          layout: { layoutMode: "single", splitGroupTabIds: [], focusedSplitTabId: null },
          tabs: [browserTab()]
        }
      )
    ).toEqual({ mode: "workspace_window" });
  });

  test("settings-only workspace falls back to the window capture", () => {
    expect(
      resolveVisualEvidenceTarget(
        {},
        {
          activeTabId: "settings-1",
          visibleTabIds: ["settings-1"],
          layout: { layoutMode: "single", splitGroupTabIds: [], focusedSplitTabId: null },
          tabs: [settingsTab()]
        }
      )
    ).toEqual({ mode: "workspace_window" });
  });
});
