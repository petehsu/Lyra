import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { I18nKey } from "../../i18n";
import type { WorkbenchPreferences } from "../../preferences";
import type { SettingsAiModel } from "../../settings-ai";
import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import { useWorkbenchSidebarAiSurfaceProps } from "../use-workbench-sidebar-ai-surface-props";

const preferences = {
  locale: "en-US",
  aiRichRenderingEnabled: true,
  aiStopBehavior: "turn_only",
  aiToolDisplayMode: "collapsed"
} as WorkbenchPreferences;

const settingsAiModel = {
  defaultProfileId: "profile-1",
  defaultProviderId: "provider-1",
  defaultProfileLabel: "Default",
  defaultModelNames: ["gpt-test"],
  profiles: [],
  setDefaultProfile: vi.fn()
} as unknown as SettingsAiModel;

const t = (key: I18nKey): string => key;

const createDesktopApi = (hasThreads: boolean) => {
  const request = vi.fn(async (payload: { readonly params?: { readonly archived?: boolean } }) => ({
    data: hasThreads && payload.params?.archived !== true ? [{ id: "thread-1" }] : []
  }));
  return {
    api: {
      lyra: {
        request
      }
    } as unknown as LyraDesktopApi,
    request
  };
};

describe("useWorkbenchSidebarAiSurfaceProps", () => {
  test("builds AI sidebar props and delegates app launch actions", async () => {
    const desktop = createDesktopApi(true);
    const openAppTab = vi.fn();
    const onRequestProjectBind = vi.fn().mockResolvedValue("/workspace");
    const onOpenPlanApprovalWorkspace = vi.fn();
    const openDialog = vi.fn();
    const { result } = renderHook(() =>
      useWorkbenchSidebarAiSurfaceProps({
        desktopApi: desktop.api,
        preferences,
        settingsAiModel,
        resolvedThemeId: "lyra-light",
        aiPanelSide: "right",
        fileMentionFallbackRoots: [],
        workbenchTabMentions: [],
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
      aiToolDisplayMode: "collapsed",
      defaultProfileId: "profile-1"
    });

    act(() => {
      result.current.onOpenHistory!();
      result.current.onOpenMcp!();
      result.current.onOpenSkills!();
    });

    await waitFor(() => {
      expect(openAppTab).toHaveBeenCalledWith(expect.objectContaining({
        appId: "ai-history",
        title: "ai.historyTitle"
      }));
    });
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
    expect(result.current.onDefaultProfileSelect).toBe(settingsAiModel.setDefaultProfile);
    expect(result.current.openDialog).toBe(openDialog);
  });

  test("does not open history when there are no history sessions", async () => {
    const desktop = createDesktopApi(false);
    const openAppTab = vi.fn();
    const { result } = renderHook(() =>
      useWorkbenchSidebarAiSurfaceProps({
        desktopApi: desktop.api,
        preferences,
        settingsAiModel,
        resolvedThemeId: "lyra-light",
        aiPanelSide: "right",
        fileMentionFallbackRoots: [],
        workbenchTabMentions: [],
        onToggleAiPanelSide: vi.fn(),
        openAppTab,
        onRequestProjectBind: vi.fn().mockResolvedValue("/workspace"),
        onOpenPlanApprovalWorkspace: vi.fn(),
        openDialog: vi.fn(),
        t
      })
    );

    act(() => {
      result.current.onOpenHistory!();
    });

    await waitFor(() => {
      expect(desktop.request).toHaveBeenCalledTimes(2);
    });
    expect(openAppTab).not.toHaveBeenCalled();
  });
});
