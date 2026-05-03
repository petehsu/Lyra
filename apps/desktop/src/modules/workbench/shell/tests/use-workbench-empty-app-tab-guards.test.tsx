import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { WorkspaceTab, WorkspaceTabsModel } from "../../workspace-tabs";
import { useWorkbenchEmptyAppTabGuards } from "../use-workbench-empty-app-tab-guards";

const createTab = (overrides: Partial<WorkspaceTab>): WorkspaceTab => ({
  id: "tab-1",
  title: "Tab",
  pageKind: "app",
  inputValue: "",
  displayAddress: "",
  faviconUrl: undefined,
  query: undefined,
  ...overrides
});

describe("useWorkbenchEmptyAppTabGuards", () => {
  test("closes empty notification center tabs and empty history tabs", async () => {
    const closeTab = vi.fn();
    const tabsModel = {
      tabs: [
        createTab({
          id: "notification-a",
          appId: "notification-center",
          appInstanceId: "notification-center"
        }),
        createTab({
          id: "notification-b",
          appId: "notification-center",
          appInstanceId: "legacy-notification-center"
        }),
        createTab({
          id: "history-a",
          appId: "ai-history",
          appInstanceId: "ai-history-center"
        }),
        createTab({
          id: "file-manager-a",
          appId: "file-manager",
          appInstanceId: "file-manager-home"
        })
      ],
      closeTab
    } as unknown as WorkspaceTabsModel;

    const { result } = renderHook(() =>
      useWorkbenchEmptyAppTabGuards({
        tabsModel,
        notificationCount: 0
      })
    );

    await waitFor(() => {
      expect(closeTab).toHaveBeenCalledWith("notification-a");
      expect(closeTab).toHaveBeenCalledWith("notification-b");
    });
    expect(closeTab).not.toHaveBeenCalledWith("history-a");
    expect(closeTab).not.toHaveBeenCalledWith("file-manager-a");

    closeTab.mockClear();
    result.current.onHistoryEmptied();

    expect(closeTab).toHaveBeenCalledWith("history-a");
    expect(closeTab).not.toHaveBeenCalledWith("notification-a");
    expect(closeTab).not.toHaveBeenCalledWith("file-manager-a");
  });
});
