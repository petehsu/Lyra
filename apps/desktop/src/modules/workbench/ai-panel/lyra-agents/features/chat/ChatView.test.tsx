import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useState } from "react";

import type { ChatMessage, OmaControls, SessionMeta } from "../../core/types";
import type { AgentSessionSnapshot } from "../../../../../../shared/agent";
import { normalizeAgentSessionSnapshot } from "../../../../agent-session-view-model";
import { createDataProviderValue } from "../../data/createDataProviderValue";
import { DataContextProvider } from "../../data/DataProvider";
import { APP_CONFIG } from "../../core/config";
import { ChatView } from "./ChatView";

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
let resizeObserverInstanceCount = 0;

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
      options: [{ label: "继续" }]
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
    vi.stubGlobal("ResizeObserver", class {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        resizeObserverInstanceCount += 1;
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
    resizeObserverInstanceCount = 0;
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

  test("renders a legacy Oma snapshot after omitted collections are normalized", () => {
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
    expect(legacySnapshot.oma).not.toBeNull();
    if (legacySnapshot.oma === null) return;

    const data = createDataProviderValue({
      session,
      messages: [],
      omaControls: {
        state: legacySnapshot.oma,
        agentMode: "oma",
        activeChannelId: legacySnapshot.oma.activeChannelId,
        setMode: async () => undefined,
        addAgent: async () => undefined,
        removeAgent: async () => undefined,
        setActiveChannel: async () => undefined
      }
    });

    const { container } = render(
      <DataContextProvider value={data}>
        <ChatView showDecisions={false} showPermission={false} />
      </DataContextProvider>
    );

    expect(container.querySelector(".lyra-agents-oma")).toBeInTheDocument();
  });

  test("manages Oma Agents with switches and closes the panel on an outside press", () => {
    const addAgent = vi.fn(async () => undefined);
    const removeAgent = vi.fn(async () => undefined);
    const lead = {
      id: "agent-lead",
      agentId: "did:lyra:agent:builtin:lead",
      name: "Lead",
      shortName: "Lead",
      role: "Coordinates the team",
      avatar: { kind: "text" as const, value: "L" },
      prompt: "Lead prompt",
      status: "idle" as const
    };
    const builder = {
      id: "agent-builder",
      agentId: "did:lyra:agent:builtin:builder",
      name: "Builder",
      shortName: "Builder",
      role: "Builds the implementation",
      avatar: { kind: "text" as const, value: "B" },
      prompt: "Builder prompt",
      status: "idle" as const
    };
    const omaControls: OmaControls = {
      state: {
        enabled: true,
        activeChannelId: "group:default",
        agents: [lead],
        availableAgents: [lead, builder],
        channels: [{
          id: "group:default",
          kind: "group",
          name: "Group",
          memberAgentIds: [lead.id],
          createdBy: "system",
          archived: false
        }]
      },
      agentMode: "oma",
      activeChannelId: "group:default",
      setMode: async () => undefined,
      addAgent,
      removeAgent,
      setActiveChannel: async () => undefined
    };
    const data = createDataProviderValue({
      session,
      messages: [],
      omaControls
    });
    const { container } = render(
      <DataContextProvider value={data}>
        <ChatView showDecisions={false} showPermission={false} />
      </DataContextProvider>
    );

    fireEvent.click(container.querySelector("button.lyra-agents-oma-add")!);
    expect(container.querySelector(".lyra-agents-oma-panel")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Add Builder" })).not.toBeChecked();
    expect(container.querySelector(".lyra-agents-oma-panel-subtitle")).toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "Add Builder" }));
    expect(addAgent).toHaveBeenCalledWith(builder.agentId);

    fireEvent.pointerDown(document.body);
    expect(container.querySelector(".lyra-agents-oma-panel")).toBeNull();
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

  test("bounds long-thread DOM and shares one resize observer", async () => {
    const data = createDataProviderValue({
      session,
      messages: longThreadMessages
    });
    const { container } = render(
      <DataContextProvider value={data}>
        <ChatView showDecisions={false} showPermission={false} />
      </DataContextProvider>
    );

    await waitFor(() => {
      const mountedSlots = container.querySelectorAll("[data-chat-message-id]").length;
      expect(mountedSlots).toBeGreaterThan(0);
      expect(mountedSlots).toBeLessThanOrEqual(30);
    });
    expect(resizeObserverInstanceCount).toBe(1);
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
});
