import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { I18nKey } from "../../i18n";
import type { WorkbenchPreferences } from "../../preferences";
import type { SettingsAiModel } from "../../settings-ai";
import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import { useWorkbenchSidebarAiSurfaceProps } from "../use-workbench-sidebar-ai-surface-props";

const preferences = {
  locale: "en-US",
  aiStopBehavior: "turn_only"
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
    const onFollowOpenFilePath = vi.fn();
    const { result } = renderHook(() =>
      useWorkbenchSidebarAiSurfaceProps({
        desktopApi: desktop.api,
        preferences,
        settingsAiModel,
        aiPanelSide: "right",
        fileMentionFallbackRoots: [],
        workbenchTabMentions: [],
        onFollowOpenFilePath,
        onToggleAiPanelSide: vi.fn(),
        openAppTab,
        onRequestProjectBind,
        t
      })
    );

    expect(result.current).toMatchObject({
      variant: "sidebar",
      locale: "en-US",
      title: "ai.tabTitle",
      aiPanelSide: "right",
      defaultProfileId: "profile-1"
    });

    act(() => {
      result.current.onOpenHistory!();
      result.current.onOpenMcp!();
      result.current.onOpenSkills!();
    });

    expect(openAppTab).toHaveBeenCalledWith(expect.objectContaining({
      appId: "ai-mcp",
      title: "ai.mcpTabTitle"
    }));
    expect(openAppTab).toHaveBeenCalledWith(expect.objectContaining({
      appId: "ai-skills",
      title: "ai.skillsTabTitle"
    }));
    expect(openAppTab).not.toHaveBeenCalledWith(expect.objectContaining({
      appId: "ai-history"
    }));
    expect(result.current.onFollowOpenFilePath).toBe(onFollowOpenFilePath);
    expect(result.current.onRequestProjectBind).toBe(onRequestProjectBind);
    expect(result.current.onDefaultProfileSelect).toBe(settingsAiModel.setDefaultProfile);
  });

  test("does not open history when there are no history sessions", async () => {
    const desktop = createDesktopApi(false);
    const openAppTab = vi.fn();
    const { result } = renderHook(() =>
      useWorkbenchSidebarAiSurfaceProps({
        desktopApi: desktop.api,
        preferences,
        settingsAiModel,
        aiPanelSide: "right",
        fileMentionFallbackRoots: [],
        workbenchTabMentions: [],
        onToggleAiPanelSide: vi.fn(),
        openAppTab,
        onRequestProjectBind: vi.fn().mockResolvedValue("/workspace"),
        t
      })
    );

    act(() => {
      result.current.onOpenHistory!();
    });

    await waitFor(() => {
      expect(desktop.request).not.toHaveBeenCalled();
    });
    expect(openAppTab).not.toHaveBeenCalled();
  });
});
