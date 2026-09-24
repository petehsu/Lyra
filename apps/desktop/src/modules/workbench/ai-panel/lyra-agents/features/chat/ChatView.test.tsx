import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useState } from "react";

import type { ChatMessage, SessionMeta } from "../../core/types";
import type { AgentSessionSnapshot } from "../../../../../../shared/agent";
import { normalizeAgentSessionSnapshot } from "../../../../agent-session-view-model";
import {
  getStreamStore,
  resetStreamStore
} from "../../../../agent-session-view-model/stream-store";
import { createDataProviderValue } from "../../data/createDataProviderValue";
import { DataContextProvider } from "../../data/DataProvider";
import { APP_CONFIG } from "../../core/config";
import { ChatView, syncComposerStackHeight } from "./ChatView";

const session: SessionMeta = {
  id: "test-session",
  title: "新会话",
  project: "Lyra",
  workingDir: "/Users/petehsu/Documents/Lyra",
  projectBound: true,
  workingDirIsHome: false,
  totalAdditions: 0,
  totalDeletions: 0
};

const SLOT_HEIGHT_PX = 20;

const makeMessage = (index: number): ChatMessage => ({
  id: `message-${index}`,
  author: index % 2 === 0 ? "agent" : "user",
  blocks: [
    {
      type: "text",
      id: `message-${index}-text`,
      body: `Message ${index}`
    }
  ]
});

const allMessages = Array.from({ length: 30 }, (_, index) => makeMessage(index + 1));
const longThreadMessages = Array.from({ length: 200 }, (_, index) => makeMessage(index + 1));

function RenderBudgetChatHarness({
  initialBudget = 12,
  onLoadEarlier
}: {
  readonly initialBudget?: number;
  readonly onLoadEarlier?: () => void;
}) {
  const [budget, setBudget] = useState(initialBudget);
  const resolvedBudget = Math.min(allMessages.length, budget);
  const messages = allMessages.slice(allMessages.length - resolvedBudget);
  const hiddenBefore = Math.max(0, allMessages.length - resolvedBudget);
  const data = createDataProviderValue({
    session,
    messages,
    messageWindow: {
      visibleCount: resolvedBudget,
      hiddenBefore,
      totalCount: allMessages.length,
      canLoadEarlier: hiddenBefore > 0
    },
    loadEarlierMessages: async () => {
      onLoadEarlier?.();
      setBudget((current) =>
        Math.min(allMessages.length, current + APP_CONFIG.messageWindow.loadBatchSize)
      );
    }
  });

  return (
    <DataContextProvider value={data}>
      <ChatView showDecisions={false} showPermission={false} />
    </DataContextProvider>
  );
}

function DecisionChatHarness() {
  const data = createDataProviderValue({
    session,
    messages: allMessages.slice(-3),
    decisions: [{
      id: "decision-1",
      question: "选择下一步？",
      options: [{ value: "continue", label: "继续" }],
      sessionId: "test-session"
    }]
  });

  return (
    <DataContextProvider value={data}>
      <ChatView showDecisions={true} showPermission={false} />
    </DataContextProvider>
  );
}

/**
 * Stamps each `[data-chat-message-id]` slot with sequential offsetTop/offsetHeight
 * so the DOM-based sticky anchor logic can resolve positions without a real layout engine.
 */
const layoutMessageSlots = (container: HTMLElement, slotHeight = SLOT_HEIGHT_PX): void => {
  const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
  const slots = container.querySelectorAll<HTMLElement>("[data-chat-message-id]");
  slots.forEach((slot, index) => {
    Object.defineProperty(slot, "offsetTop", {
      configurable: true,
      value: index * slotHeight
    });
    Object.defineProperty(slot, "offsetHeight", {
      configurable: true,
      value: slotHeight
    });
    Object.defineProperty(slot, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: (index + 1) * slotHeight - scroll.scrollTop,
        height: slotHeight,
        left: 0,
        right: 0,
        top: index * slotHeight - scroll.scrollTop,
        width: 0,
        x: 0,
        y: index * slotHeight - scroll.scrollTop,
        toJSON: () => undefined
      })
    });
  });
};

const primeScroll = (
  scroll: HTMLDivElement,
  options: { readonly clientHeight?: number; readonly scrollHeight?: number; readonly scrollTop?: number } = {}
): void => {
  const clientHeight = options.clientHeight ?? 600;
  const scrollHeight = options.scrollHeight ?? 600;
  Object.defineProperty(scroll, "clientHeight", { configurable: true, value: clientHeight });
  Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: scrollHeight });
  scroll.scrollTop = options.scrollTop ?? 0;
  fireEvent.scroll(scroll);
};

const waitForMessageMeasurements = (): Promise<void> =>
  new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

describe("ChatView render-budget message window", () => {
  beforeEach(() => {
    resetStreamStore();
    vi.stubGlobal("ResizeObserver", class {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(target: Element): void {
        this.callback([{
          target,
          contentRect: { height: SLOT_HEIGHT_PX },
          borderBoxSize: [{ blockSize: SLOT_HEIGHT_PX }]
        } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve(): void {}
      disconnect(): void {}
    });
  });

  test("shows reasoning deltas in the live thinking disclosure before commit", async () => {
    const pendingMessage: ChatMessage = {
      id: "assistant-live-reasoning",
      author: "agent",
      blocks: [{
        type: "text",
        id: "assistant-live-reasoning-text",
        body: "",
        sourceBlockId: null
      }]
    };
    const data = createDataProviderValue({
      session,
      messages: [pendingMessage],
      isTurnRunning: true,
      followActivity: "streaming_model"
    });

    const { container } = render(
      <DataContextProvider value={data}>
        <ChatView showDecisions={false} showPermission={false} />
      </DataContextProvider>
    );

    act(() => {
      getStreamStore().appendReasoningDelta(
        pendingMessage.id,
        "正在实时分析最新链路"
      );
    });

    await waitFor(() => {
      expect(container.querySelector(".lyra-agents-thinking-body")?.textContent)
        .toContain("正在实时分析最新链路");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("renders only the latest render-budget window on long threads", async () => {
    render(<RenderBudgetChatHarness initialBudget={12} />);
    await waitFor(() => {
      expect(screen.getByText("Message 30")).toBeInTheDocument();
      expect(screen.getByText("Message 19")).toBeInTheDocument();
      expect(screen.queryByText("Message 18")).not.toBeInTheDocument();
    });
  });

  test("does not render Oma channel or team UI", () => {
    const data = createDataProviderValue({
      session,
      messages: []
    });
    const { container } = render(
      <DataContextProvider value={data}>
        <ChatView showDecisions={false} showPermission={false} />
      </DataContextProvider>
    );

    expect(container.querySelector(".lyra-agents-oma")).toBeNull();
    expect(container.querySelector(".lyra-agents-oma-team-board")).toBeNull();
    expect(container.querySelector(".lyra-agents-oma-panel")).toBeNull();
  });

  test("renders a legacy Oma snapshot as an ordinary session", () => {
    const legacySnapshot = normalizeAgentSessionSnapshot({
      id: "legacy-oma-session",
      title: "Legacy Oma",
      sessionKind: "normal",
      agentMode: "oma",
      oma: {
        enabled: true,
        activeChannelId: "group:default",
        agents: [],
        channels: []
      },
      workingDir: "/Users/petehsu/Documents/Lyra",
      projectBound: true,
      messages: [],
      tools: [],
      todos: [],
      turnStatus: "idle",
      activeTurnId: null,
      follow: { running: false, activity: null },
      updatedAt: "2026-07-10T00:00:00.000Z"
    } as unknown as AgentSessionSnapshot);
    expect((legacySnapshot as Record<string, unknown>).oma).toBeUndefined();
    expect((legacySnapshot as Record<string, unknown>).agentMode).toBeUndefined();

    const data = createDataProviderValue({
      session,
      messages: []
    });
    const { container } = render(
      <DataContextProvider value={data}>
        <ChatView showDecisions={false} showPermission={false} />
      </DataContextProvider>
    );

    expect(container.querySelector(".lyra-agents-oma")).toBeNull();
  });

  test("shows Show earlier button when earlier messages exist", () => {
    const { container } = render(<RenderBudgetChatHarness initialBudget={12} />);
    const button = container.querySelector(".lyra-agents-chat-load-earlier button");
    expect(button).not.toBeNull();
  });

  test("hides Show earlier button when all messages are visible", () => {
    const { container } = render(<RenderBudgetChatHarness initialBudget={30} />);
    const button = container.querySelector(".lyra-agents-chat-load-earlier button");
    expect(button).toBeNull();
  });

  test("loads earlier messages on Show earlier button click", async () => {
    const onLoadEarlier = vi.fn();
    const { container } = render(
      <RenderBudgetChatHarness initialBudget={12} onLoadEarlier={onLoadEarlier} />
    );
    const button = container.querySelector(
      ".lyra-agents-chat-load-earlier button"
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    fireEvent.click(button);
    await waitFor(() => {
      expect(onLoadEarlier).toHaveBeenCalled();
      expect(screen.getByText("Message 1")).toBeInTheDocument();
    });
  });

  test("loads earlier messages when scrolled near the top", async () => {
    const onLoadEarlier = vi.fn();
    const { container } = render(
      <RenderBudgetChatHarness initialBudget={12} onLoadEarlier={onLoadEarlier} />
    );
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    expect(scroll).not.toBeNull();
    primeScroll(scroll, { clientHeight: 300, scrollHeight: 600, scrollTop: 600 });
    await waitFor(() => {
      expect(screen.getByText("Message 30")).toBeInTheDocument();
    });
    primeScroll(scroll, { clientHeight: 300, scrollHeight: 600, scrollTop: 0 });
    await waitFor(() => {
      expect(onLoadEarlier).toHaveBeenCalled();
    });
  });

  test("mounts every message in the current window", async () => {
    const { container } = render(<RenderBudgetChatHarness initialBudget={12} />);
    await waitFor(() => {
      expect(screen.getByText("Message 30")).toBeInTheDocument();
      expect(screen.getByText("Message 19")).toBeInTheDocument();
    });
    const mountedSlots = container.querySelectorAll("[data-chat-message-id]").length;
    expect(mountedSlots).toBe(12);
  });

  test("bounds long-thread DOM to the data-provider window", async () => {
    const visibleCount = Math.min(
      longThreadMessages.length,
      APP_CONFIG.messageWindow.initialRenderCount
    );
    const hiddenBefore = longThreadMessages.length - visibleCount;
    const data = createDataProviderValue({
      session,
      messages: longThreadMessages.slice(-visibleCount),
      messageWindow: {
        visibleCount,
        hiddenBefore,
        totalCount: longThreadMessages.length,
        canLoadEarlier: hiddenBefore > 0
      }
    });
    const { container } = render(
      <DataContextProvider value={data}>
        <ChatView showDecisions={false} showPermission={false} />
      </DataContextProvider>
    );

    await waitFor(() => {
      const mountedSlots = container.querySelectorAll("[data-chat-message-id]").length;
      expect(mountedSlots).toBeGreaterThan(0);
      expect(mountedSlots).toBe(visibleCount);
    });
  });

  test("shows sticky anchor for the last user message above the anchor line", async () => {
    const { container } = render(<RenderBudgetChatHarness initialBudget={12} />);
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    expect(scroll).not.toBeNull();
    layoutMessageSlots(container);
    await waitForMessageMeasurements();
    primeScroll(scroll, { clientHeight: 300, scrollHeight: 240, scrollTop: 50 });
    await waitFor(() => {
      // scrollTop=50, anchorLine=50+18=68.
      // message-19 (user): bottom=20  <= 68 → candidate
      // message-20 (agent): bottom=40 <= 68, not user
      // message-21 (user): bottom=60  <= 68 → candidate
      // message-22 (agent): top=60    <= 68, bottom=80 > 68 → continue
      // message-23 (user): top=80    > 68  → break
      expect(container.querySelector(".lyra-agents-chat-thread-anchor-text")).toHaveTextContent(
        "Message 21"
      );
    });
  });

  test("hides sticky anchor when scrolled to the very top", async () => {
    const { container } = render(<RenderBudgetChatHarness initialBudget={12} />);
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    expect(scroll).not.toBeNull();
    layoutMessageSlots(container);
    await waitForMessageMeasurements();
    primeScroll(scroll, { clientHeight: 300, scrollHeight: 240, scrollTop: 50 });
    await waitFor(() => {
      expect(container.querySelector(".lyra-agents-chat-thread-anchor-text")).toBeInTheDocument();
    });
    primeScroll(scroll, { clientHeight: 300, scrollHeight: 240, scrollTop: 0 });
    await waitFor(() => {
      expect(container.querySelector(".lyra-agents-chat-thread-anchor-text")).not.toBeInTheDocument();
    });
  });

  test("clicking the sticky anchor scrolls to the anchored message", async () => {
    const { container } = render(<RenderBudgetChatHarness initialBudget={12} />);
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    expect(scroll).not.toBeNull();
    layoutMessageSlots(container);
    await waitForMessageMeasurements();
    primeScroll(scroll, { clientHeight: 300, scrollHeight: 240, scrollTop: 50 });
    await waitFor(() => {
      expect(container.querySelector(".lyra-agents-chat-thread-anchor-text")).toHaveTextContent(
        "Message 21"
      );
    });

    const scrollTo = vi.fn();
    const targetSlot = container.querySelector<HTMLElement>(
      '[data-chat-message-id="message-21"]'
    );
    expect(targetSlot).not.toBeNull();
    Object.defineProperty(targetSlot, "scrollIntoView", {
      configurable: true,
      value: scrollTo
    });

    const anchorButton = container.querySelector(
      ".lyra-agents-chat-thread-anchor-button"
    ) as HTMLButtonElement;
    expect(anchorButton).not.toBeNull();
    fireEvent.click(anchorButton);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth" });
  });

  test("keeps the decision panel expanded while scrolling", async () => {
    const { container } = render(<DecisionChatHarness />);
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    const panelBody = container.querySelector(".lyra-agents-decision-body") as HTMLElement;
    expect(scroll).not.toBeNull();
    expect(panelBody).not.toBeNull();

    primeScroll(scroll, { clientHeight: 300, scrollHeight: 900, scrollTop: 600 });
    primeScroll(scroll, { clientHeight: 300, scrollHeight: 900, scrollTop: 0 });
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    expect(panelBody.style.maxHeight).toBe("520px");
    expect(panelBody.style.opacity).toBe("1");
  });

  test("keeps Changes and Plan on the composer rail above the input", async () => {
    const openProjectGit = vi.fn(async () => undefined);
    const openProjectPlanManager = vi.fn(async () => undefined);
    const data = createDataProviderValue({
      session,
      messages: [],
      todos: [{ id: "1", title: "Ship it", status: "running" }],
      openProjectGit,
      openProjectPlanManager
    });
    const desktopApi = {
      agent: {
        listProjectPlans: vi.fn(async () => ({
          projectKey: "lyra",
          workingDir: session.workingDir,
          plans: [{
            planId: "plan-1",
            title: "Ship",
            status: "active",
            createdAtIso: "2026-09-13T00:00:00.000Z",
            updatedAtIso: "2026-09-13T00:00:00.000Z"
          }]
        })),
        readGitStatus: vi.fn(async () => ({
          workingDir: session.workingDir,
          isRepository: true,
          ahead: 0,
          behind: 0,
          entries: [],
          summary: {
            changed: 1,
            staged: 0,
            unstaged: 1,
            untracked: 0,
            conflicts: 0,
            additions: 4,
            deletions: 2
          },
          updatedAt: "2026-09-13T00:00:00.000Z"
        }))
      }
    } as never;

    const { container } = render(
      <DataContextProvider value={data}>
        <ChatView showDecisions={false} showPermission={false} desktopApi={desktopApi} />
      </DataContextProvider>
    );

    const rail = container.querySelector(".lyra-agents-composer-toprow");
    expect(rail).not.toBeNull();
    await waitFor(() => {
      expect(rail).toHaveTextContent("Plan");
    });
    expect(container.querySelector(".lyra-agents-todo-capsule")).toHaveTextContent("1|1");
    expect(rail).not.toHaveTextContent("Todos");
    await waitFor(() => {
      expect(rail).toHaveTextContent("Changes");
      expect(rail).toHaveTextContent("+4");
      expect(rail).toHaveTextContent("-2");
    });
    expect(container.querySelector(".lyra-agents-project-meta-row")).not.toHaveTextContent("Plan");
  });

  test("hides Plan when the current project has no plan", async () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      openProjectPlanManager: async () => undefined
    });
    const desktopApi = {
      agent: {
        listProjectPlans: vi.fn(async () => ({
          projectKey: "lyra",
          workingDir: session.workingDir,
          plans: []
        }))
      }
    } as never;

    const { container } = render(
      <DataContextProvider value={data}>
        <ChatView showDecisions={false} showPermission={false} desktopApi={desktopApi} />
      </DataContextProvider>
    );

    await waitFor(() => {
      expect(desktopApi.agent.listProjectPlans).toHaveBeenCalled();
    });
    expect(container.querySelector(".lyra-agents-composer-toprow")).not.toHaveTextContent("Plan");
  });

  test("hides the todo capsule when every item is done", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      todos: [{ id: "1", title: "Ship it", status: "done" }],
      openProjectPlanManager: async () => undefined
    });
    const { container } = render(
      <DataContextProvider value={data}>
        <ChatView showDecisions={false} showPermission={false} />
      </DataContextProvider>
    );
    expect(container.querySelector(".lyra-agents-todo-capsule")).toBeNull();
  });

  test("raises transcript padding to the measured composer stack", () => {
    const scroll = document.createElement("div");
    const wrap = document.createElement("div");
    Object.defineProperty(wrap, "offsetHeight", { configurable: true, value: 240 });
    Object.defineProperty(wrap, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        height: 240,
        width: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 240,
        x: 0,
        y: 0,
        toJSON: () => undefined
      })
    });

    expect(syncComposerStackHeight(scroll, wrap)).toBe(240);
    expect(scroll.style.getPropertyValue("--lyra-agents-composer-scroll-bottom-padding")).toBe("240px");
  });

  test("does not render a Follow Agent control", () => {
    const data = createDataProviderValue({ session, messages: [] });
    const { container } = render(
      <DataContextProvider value={data}>
        <ChatView showDecisions={false} showPermission={false} />
      </DataContextProvider>
    );
    expect(screen.queryByLabelText("Follow Agent")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Unfollow Agent")).not.toBeInTheDocument();
    expect(container.querySelector(".lyra-agents-composer-rail")).not.toBeNull();
    expect(container.querySelector(".lyra-agents-composer-stage")).toBeNull();
    expect(container.querySelector(".lyra-agents-composer-browser-preview")).toBeNull();
  });

  test("opens a live browser preview into the current workspace tab", async () => {
    const setActiveBrowserTab = vi.fn(() => true);
    const openUrlInWorkbench = vi.fn(async () => undefined);
    const data = createDataProviderValue({
      session,
      messages: [],
      isTurnRunning: true,
      setActiveBrowserTab,
      openUrlInWorkbench
    });
    const desktopApi = {
      agent: {
        readAgentBrowserPreview: vi.fn(async () => [{
          tabId: "tab-live",
          targetMode: "live" as const,
          url: "https://example.com",
          title: "Example",
          mimeType: "image/png",
          imageBase64: "AAAA",
          width: 80,
          height: 50
        }])
      }
    };
    render(
      <DataContextProvider value={data}>
        <ChatView
          showDecisions={false}
          showPermission={false}
          desktopApi={desktopApi as never}
        />
      </DataContextProvider>
    );
    const preview = await screen.findByRole("button", { name: "Open in workspace" });
    expect(preview).toHaveClass("lyra-agents-composer-browser-preview");
    fireEvent.click(preview);
    expect(setActiveBrowserTab).toHaveBeenCalledWith("tab-live");
    expect(openUrlInWorkbench).not.toHaveBeenCalled();
  });

  test("opens an isolated browser preview as a workspace URL", async () => {
    const setActiveBrowserTab = vi.fn(() => false);
    const openUrlInWorkbench = vi.fn(async () => undefined);
    const data = createDataProviderValue({
      session,
      messages: [],
      isTurnRunning: true,
      setActiveBrowserTab,
      openUrlInWorkbench
    });
    const desktopApi = {
      agent: {
        readAgentBrowserPreview: vi.fn(async () => [{
          tabId: "tab-isolated",
          targetMode: "isolated" as const,
          url: "https://example.com/app",
          title: "App",
          mimeType: "image/png",
          imageBase64: "AAAA",
          width: 80,
          height: 50
        }])
      }
    };
    render(
      <DataContextProvider value={data}>
        <ChatView
          showDecisions={false}
          showPermission={false}
          desktopApi={desktopApi as never}
        />
      </DataContextProvider>
    );
    const preview = await screen.findByRole("button", { name: "Open in workspace" });
    expect(preview).toHaveClass("lyra-agents-composer-browser-preview");
    fireEvent.click(preview);
    expect(setActiveBrowserTab).not.toHaveBeenCalled();
    expect(openUrlInWorkbench).toHaveBeenCalledWith("https://example.com/app", "App");
  });

  test("idle browser capsule shows the last site icon and name", async () => {
    const Harness = ({
      title,
      url,
      faviconUrl
    }: {
      readonly title: string;
      readonly url: string;
      readonly faviconUrl?: string;
    }) => {
      const [isTurnRunning, setIsTurnRunning] = useState(true);
      const data = createDataProviderValue({
        session,
        messages: [],
        isTurnRunning,
        setActiveBrowserTab: () => true,
        openUrlInWorkbench: async () => undefined
      });
      return (
        <>
          <button type="button" onClick={() => setIsTurnRunning(false)}>stop-turn</button>
          <DataContextProvider value={data}>
            <ChatView
              showDecisions={false}
              showPermission={false}
              desktopApi={{
                agent: {
                  readAgentBrowserPreview: async () => [{
                    tabId: "tab-live",
                    targetMode: "live" as const,
                    url,
                    title,
                    ...(faviconUrl === undefined ? {} : { faviconUrl }),
                    mimeType: "image/png" as const,
                    imageBase64: "AAAA",
                    width: 80,
                    height: 50
                  }]
                }
              } as never}
            />
          </DataContextProvider>
        </>
      );
    };

    const { rerender } = render(
      <Harness title="Example Domain" url="https://example.com" faviconUrl="https://example.com/favicon.ico" />
    );
    await screen.findByRole("button", { name: "Open in workspace" });
    fireEvent.click(screen.getByRole("button", { name: "stop-turn" }));
    const capsule = await screen.findByRole("button", { name: "Open in workspace" });
    expect(capsule).toHaveClass("lyra-agents-composer-browser-capsule");
    expect(capsule).toHaveTextContent("Example Domain");
    expect(capsule.querySelector("img")).toHaveAttribute("src", "https://example.com/favicon.ico");

    rerender(<Harness key="blank" title="" url="about:blank" />);
    await screen.findByRole("button", { name: "Open in workspace" });
    fireEvent.click(screen.getByRole("button", { name: "stop-turn" }));
    const fallback = await screen.findByRole("button", { name: "Open in workspace" });
    expect(fallback).toHaveTextContent("Browser");
    expect(fallback.querySelector("img")).toBeNull();
    expect(fallback.querySelector(".lyra-agents-composer-browser-capsule-logo")).not.toBeNull();

    rerender(
      <Harness
        key="not-found"
        title="Not Found"
        url="https://gitlab.com/api/v4/projects/819/repository/files/README.md/raw?ref=main"
      />
    );
    await screen.findByRole("button", { name: "Open in workspace" });
    fireEvent.click(screen.getByRole("button", { name: "stop-turn" }));
    const errorPage = await screen.findByRole("button", { name: "Open in workspace" });
    expect(errorPage).toHaveTextContent("gitlab");
    expect(errorPage).not.toHaveTextContent("Not Found");
  });
});
