import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { I18nKey } from "../../i18n";
import type { WorkbenchPreferences } from "../../preferences";
import type { SettingsAiModel } from "../../settings-ai";
import { useWorkbenchSidebarAiSurfaceProps } from "../use-workbench-sidebar-ai-surface-props";

const preferences = {
  locale: "en-US",
  aiRichRenderingEnabled: true,
  aiStopBehavior: "turn_only"
} as WorkbenchPreferences;

const settingsAiModel = {
  defaultProfileId: "profile-1",
  defaultProviderId: "provider-1",
  defaultProfileLabel: "Default",
  defaultModelNames: ["gpt-test"],
  profiles: []
} as unknown as SettingsAiModel;

const t = (key: I18nKey): string => key;

describe("useWorkbenchSidebarAiSurfaceProps", () => {
  test("builds AI sidebar props and delegates app launch actions", () => {
    const openAppTab = vi.fn();
    const onRequestProjectBind = vi.fn().mockResolvedValue("/workspace");
    const onOpenPlanApprovalWorkspace = vi.fn();
    const openDialog = vi.fn();
    const { result } = renderHook(() =>
      useWorkbenchSidebarAiSurfaceProps({
        desktopApi: null,
        preferences,
        settingsAiModel,
        resolvedThemeId: "lyra-light",
        aiPanelSide: "right",
        fileMentionFallbackRoots: [],
        onToggleAiPanelSide: vi.fn(),
        openAppTab,
        onRequestProjectBind,
        onOpenPlanApprovalWorkspace,
        openDialog,
        t
      })
    );

    expect(result.current).toMatchObject({
      locale: "en-US",
      title: "ai.tabTitle",
      themeSignature: "lyra-light",
      aiPanelSide: "right",
      defaultProfileId: "profile-1"
    });

    act(() => {
      result.current.onOpenHistory!();
      result.current.onOpenMcp!();
      result.current.onOpenSkills!();
    });

    expect(openAppTab).toHaveBeenCalledWith(expect.objectContaining({
      appId: "ai-history",
      title: "ai.historyTitle"
    }));
    expect(openAppTab).toHaveBeenCalledWith(expect.objectContaining({
      appId: "ai-mcp",
      title: "ai.mcpTabTitle"
    }));
    expect(openAppTab).toHaveBeenCalledWith(expect.objectContaining({
      appId: "ai-skills",
      title: "ai.skillsTabTitle"
    }));
    expect(result.current.onRequestProjectBind).toBe(onRequestProjectBind);
    expect(result.current.onOpenPlanApprovalWorkspace).toBe(onOpenPlanApprovalWorkspace);
    expect(result.current.openDialog).toBe(openDialog);
  });
});
