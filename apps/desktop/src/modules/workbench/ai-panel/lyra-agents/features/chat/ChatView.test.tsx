import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useState } from "react";

import type { ChatMessage, SessionMeta } from "../../core/types";
import { createDataProviderValue } from "../../data/createDataProviderValue";
import { DataContextProvider } from "../../data/DataProvider";
import { APP_CONFIG } from "../../core/config";
import { ChatView } from "./ChatView";
import { CHAT_MESSAGE_GAP_PX } from "./chat-layout-constants";
import {
  createMessageWindowPlanConfig,
  planAdditionalRevealCount,
  planRevealCountFromEnd
} from "./message-window-plan";

const session: SessionMeta = {
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

let resizeObserverCallback: ResizeObserverCallback | null = null;

const installResizeObserverMock = (): void => {
  resizeObserverCallback = null;
  class ResizeObserverMock {
    constructor(callback: ResizeObserverCallback) {
      resizeObserverCallback = callback;
    }
    observe(element: Element): void {
      if (!(element instanceof HTMLElement)) return;
      Object.defineProperty(element, "getBoundingClientRect", {
        configurable: true,
        value: () => ({
          bottom: SLOT_HEIGHT_PX,
          height: SLOT_HEIGHT_PX,
          left: 0,
          right: 300,
          top: 0,
          width: 300,
          x: 0,
          y: 0,
          toJSON: () => ({})
        })
      });
      resizeObserverCallback?.(
        [{ target: element } as unknown as ResizeObserverEntry],
        {} as ResizeObserver
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
};

const planConfigFor = (contentWidthPx: number) =>
  createMessageWindowPlanConfig(contentWidthPx, {
    minRevealCount: APP_CONFIG.messageWindow.minRevealCount,
    maxRevealCount: APP_CONFIG.messageWindow.maxRevealCount,
    messageGapPx: CHAT_MESSAGE_GAP_PX,
    fallbackHeightPx: 80
  });

function ProgressiveChatHarness({
  onLoadEarlier,
  fixedVisibleCount
}: {
  readonly onLoadEarlier?: (request: {
    readonly heightBudgetPx: number;
    readonly contentWidthPx: number;
  }) => void;
  /** Pins the progressive window for sticky/scroll tests that assume a fixed slice. */
  readonly fixedVisibleCount?: number;
}) {
  const [visibleCount, setVisibleCount] = useState<number>(() =>
    fixedVisibleCount ?? Math.min(allMessages.length, 12)
  );
  const resolvedVisibleCount = Math.min(allMessages.length, visibleCount);
  const messages = allMessages.slice(allMessages.length - resolvedVisibleCount);
  const data = createDataProviderValue({
    session,
    messages,
    messageWindow: {
      visibleCount: resolvedVisibleCount,
      hiddenBefore: Math.max(0, allMessages.length - resolvedVisibleCount),
      totalCount: allMessages.length,
      canLoadEarlier:
        fixedVisibleCount === undefined &&
        resolvedVisibleCount < allMessages.length
    },
    syncMessageWindowBudget: async (request) => {
      if (fixedVisibleCount !== undefined) return;
      const nextVisible = planRevealCountFromEnd(
        allMessages,
        request.heightBudgetPx,
        planConfigFor(request.contentWidthPx)
      );
      setVisibleCount(Math.min(allMessages.length, nextVisible));
    },
    loadEarlierMessages: async (request) => {
      if (fixedVisibleCount !== undefined) return;
      onLoadEarlier?.(request);
      setVisibleCount((current) => {
        const additional = planAdditionalRevealCount(
          allMessages,
          current,
          request.heightBudgetPx,
          planConfigFor(request.contentWidthPx)
        );
        return Math.min(allMessages.length, current + additional);
      });
    }
  });

  return (
    <DataContextProvider value={data}>
      <ChatView showDecisions={false} showPermission={false} />
    </DataContextProvider>
  );
};

describe("ChatView progressive message window", () => {
  beforeEach(() => {
    installResizeObserverMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const primeScrollViewport = (
    scroll: HTMLDivElement,
    options: { readonly clientHeight?: number; readonly scrollHeight?: number } = {}
  ): void => {
    const clientHeight = options.clientHeight ?? 1800;
    const scrollHeight = options.scrollHeight ?? 3000;
    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      value: clientHeight
    });
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      value: scrollHeight
    });
    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);
  };

  const primeStickyScrollViewport = async (
    container: HTMLElement,
    scroll: HTMLDivElement
  ): Promise<void> => {
    // Mount the full pinned window first so ResizeObserver can seed every slot height.
    primeScrollViewport(scroll, { clientHeight: 1800, scrollHeight: 3000 });
    await waitFor(() => {
      expect(screen.getByText("Message 30")).toBeInTheDocument();
      expect(screen.getByText("Message 19")).toBeInTheDocument();
      expect(screen.queryByText("Message 18")).not.toBeInTheDocument();
    });
    flushMeasuredHeights(container);

    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      value: 1000
    });
    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      value: 300
    });
    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);
  };

  const flushMeasuredHeights = (container: HTMLElement): void => {
    container.querySelectorAll("[data-chat-message-id]").forEach((slot) => {
      resizeObserverCallback?.(
        [{ target: slot } as unknown as ResizeObserverEntry],
        {} as ResizeObserver
      );
    });
  };

  test("renders only the latest message window on long threads", async () => {
    const { container } = render(<ProgressiveChatHarness />);
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    primeScrollViewport(scroll);

    await waitFor(() => {
      expect(screen.getByText("Message 30")).toBeInTheDocument();
      expect(screen.queryByText("Message 1")).not.toBeInTheDocument();
    });
    const mountedMessages = screen.getAllByText(/^Message \d+$/u);
    expect(mountedMessages.length).toBeLessThan(allMessages.length);
    expect(mountedMessages.length).toBeGreaterThan(APP_CONFIG.messageWindow.minRevealCount);
  });

  test("loads earlier messages when the user reaches the top", async () => {
    const onLoadEarlier = vi.fn();
    const { container } = render(<ProgressiveChatHarness onLoadEarlier={onLoadEarlier} />);
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    primeScrollViewport(scroll);
    await waitFor(() => {
      expect(screen.getByText("Message 30")).toBeInTheDocument();
      expect(screen.queryByText("Message 1")).not.toBeInTheDocument();
    });
    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      value: 300
    });

    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);

    await waitFor(() => {
      expect(onLoadEarlier).toHaveBeenCalled();
    });

    await waitFor(() => {
      const mounted = screen.getAllByText(/^Message \d+$/u).map((node) => node.textContent);
      const numbers = mounted
        .map((text) => Number.parseInt(text?.replace("Message ", "") ?? "", 10))
        .filter((value) => Number.isFinite(value));
      expect(numbers.length).toBeGreaterThan(0);
      expect(Math.min(...numbers)).toBeLessThan(Math.max(...numbers));
    });
    expect(screen.queryByText("Message 1")).not.toBeInTheDocument();
  });

  test("shows a sticky previous user message anchor while scrolling history", async () => {
    const { container } = render(<ProgressiveChatHarness fixedVisibleCount={12} />);
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    await primeStickyScrollViewport(container, scroll);

    const scrollTo = vi.fn();
    Object.defineProperty(scroll, "scrollTo", {
      configurable: true,
      value: scrollTo
    });

    scroll.scrollTop = 50;
    fireEvent.scroll(scroll);
    flushMeasuredHeights(container);

    await waitFor(() => {
      expect(container.querySelector(".lyra-agents-chat-thread-anchor-text")).toHaveTextContent("Message 19");
    });

    fireEvent.click(container.querySelector(".lyra-agents-chat-thread-anchor-button") as HTMLButtonElement);

    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" })
    );
  });

  test("keeps the sticky previous user message anchor near the bottom of a long answer", async () => {
    const { container } = render(<ProgressiveChatHarness fixedVisibleCount={12} />);
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    await primeStickyScrollViewport(container, scroll);

    scroll.scrollTop = 120;
    fireEvent.scroll(scroll);
    flushMeasuredHeights(container);

    await waitFor(() => {
      expect(container.querySelector(".lyra-agents-chat-thread-anchor-text")).toHaveTextContent("Message 21");
    });
  });

  test("virtualizes off-screen messages out of the DOM", () => {
    const { container } = render(<ProgressiveChatHarness />);
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 120 });
    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);

    const mountedSlots = container.querySelectorAll("[data-chat-message-id]").length;
    expect(mountedSlots).toBeLessThan(12);
  });

  test("hides the sticky anchor once its message is visible at the top", async () => {
    const { container } = render(<ProgressiveChatHarness fixedVisibleCount={12} />);
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    await primeStickyScrollViewport(container, scroll);

    scroll.scrollTop = 50;
    fireEvent.scroll(scroll);
    flushMeasuredHeights(container);

    await waitFor(() => {
      expect(container.querySelector(".lyra-agents-chat-thread-anchor-text")).toHaveTextContent("Message 19");
    });

    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);

    await waitFor(() => {
      expect(container.querySelector(".lyra-agents-chat-thread-anchor-text")).not.toBeInTheDocument();
    });
  });
});