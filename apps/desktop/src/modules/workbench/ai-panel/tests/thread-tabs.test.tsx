import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { AiPanelThreadTabs } from "../thread-tabs";
import type { LyraThreadTab, LyraThreadTabStatus } from "../use-lyra-thread-runtime";

const createThreadTab = (
  tabId: string,
  title: string,
  status: LyraThreadTabStatus = "idle",
  threadId: string | null = tabId
): LyraThreadTab => ({
  tabId,
  threadId,
  title,
  openedAt: 1,
  updatedAt: 1,
  status
});

const createDataTransfer = (): DataTransfer => {
  const data = new Map<string, string>();
  return {
    dropEffect: "move",
    effectAllowed: "move",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: vi.fn((type?: string) => {
      if (type === undefined) {
        data.clear();
        return;
      }
      data.delete(type);
    }),
    getData: vi.fn((type: string) => data.get(type) ?? ""),
    setData: vi.fn((type: string, value: string) => {
      data.set(type, value);
    }),
    setDragImage: vi.fn()
  } as unknown as DataTransfer;
};

describe("AiPanelThreadTabs", () => {
  test("renders chrome-shaped tabs and dispatches thread tab actions", () => {
    const onActivateTab = vi.fn();
    const onCloseTab = vi.fn();
    const onCreateTab = vi.fn();
    const onReorderTab = vi.fn();

    const { container } = render(
      <AiPanelThreadTabs
        tabs={[
          createThreadTab("thread-a", "Planning", "running"),
          createThreadTab("draft-a", "Untitled", "draft", null)
        ]}
        activeTabId="thread-a"
        newThreadLabel="New conversation"
        closeThreadLabel="Close conversation"
        draftTitle="Draft conversation"
        tabProjectRootById={new Map([
          ["thread-a", "/repo"],
          ["draft-a", null]
        ])}
        onActivateTab={onActivateTab}
        onCloseTab={onCloseTab}
        onCreateTab={onCreateTab}
        onReorderTab={onReorderTab}
      />
    );

    expect(container.querySelectorAll(".lyra-chrome-tab-shape")).toHaveLength(2);
    expect(container.querySelector(".lyra-chrome-tab-dividers")).not.toBeNull();
    expect(container.querySelector(".lyra-chrome-tab-background-svg")).not.toBeNull();
    expect(container.querySelector(".lyra-ai-thread-tab-item[data-status='running']")).not.toBeNull();
    expect(container.querySelector(".lyra-ai-thread-tab-status")).toBeNull();
    expect(container.querySelector("[data-project-icon-kind='bound-project']")).not.toBeNull();
    const lyraIcon = container.querySelector("[data-project-icon-kind='lyra']");
    expect(lyraIcon).not.toBeNull();
    expect(lyraIcon?.querySelector(".lyra-project-identity-lyra-logo")).not.toBeNull();
    expect(lyraIcon?.querySelector("img")).toBeNull();

    expect(screen.getByRole("tab", { name: "Planning" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("tab", { name: "Draft conversation" })).toHaveAttribute(
      "aria-selected",
      "false"
    );

    fireEvent.click(screen.getByRole("tab", { name: "Draft conversation" }));
    fireEvent.click(screen.getByRole("button", { name: "Close conversation: Planning" }));
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));

    expect(onActivateTab).toHaveBeenCalledWith("draft-a");
    expect(onCloseTab).toHaveBeenCalledWith("thread-a");
    expect(onCreateTab).toHaveBeenCalledTimes(1);
  });

  test("supports drag reordering tabs", () => {
    const onReorderTab = vi.fn();

    const { container } = render(
      <AiPanelThreadTabs
        tabs={[
          createThreadTab("thread-a", "Planning"),
          createThreadTab("thread-b", "Build")
        ]}
        activeTabId="thread-a"
        newThreadLabel="New conversation"
        closeThreadLabel="Close conversation"
        draftTitle="Draft conversation"
        onActivateTab={vi.fn()}
        onCloseTab={vi.fn()}
        onCreateTab={vi.fn()}
        onReorderTab={onReorderTab}
      />
    );

    const tabItems = container.querySelectorAll<HTMLElement>(".lyra-ai-thread-tab-item");
    const firstTab = tabItems[0]!;
    const secondTab = tabItems[1]!;
    const dataTransfer = createDataTransfer();

    fireEvent.dragStart(secondTab, { dataTransfer });
    fireEvent.dragOver(firstTab, { dataTransfer });
    fireEvent.drop(firstTab, { dataTransfer });

    expect(onReorderTab).toHaveBeenCalledWith("thread-b", 0);
    expect(dataTransfer.setDragImage).toHaveBeenCalledWith(secondTab, 1, 1);
  });
});
