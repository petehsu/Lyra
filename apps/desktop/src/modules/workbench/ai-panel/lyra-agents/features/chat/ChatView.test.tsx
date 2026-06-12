import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useState } from "react";

import type { ChatMessage, SessionMeta } from "../../core/types";
import { createDataProviderValue } from "../../data/createDataProviderValue";
import { DataContextProvider } from "../../data/DataProvider";
import { ChatView } from "./ChatView";

const session: SessionMeta = {
  title: "新会话",
  project: "Lyra",
  workingDir: "/Users/petehsu/Documents/Lyra",
  projectBound: true,
  totalAdditions: 0,
  totalDeletions: 0
};

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

const rectAt = (top: number): DOMRect => ({
  bottom: top + 20,
  height: 20,
  left: 0,
  right: 300,
  top,
  width: 300,
  x: 0,
  y: top,
  toJSON: () => ({})
});

function ProgressiveChatHarness({
  onLoadEarlier
}: {
  readonly onLoadEarlier?: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(12);
  const resolvedVisibleCount = Math.min(allMessages.length, visibleCount);
  const messages = allMessages.slice(allMessages.length - resolvedVisibleCount);
  const data = createDataProviderValue({
    session,
    messages,
    messageWindow: {
      visibleCount: resolvedVisibleCount,
      hiddenBefore: Math.max(0, allMessages.length - resolvedVisibleCount),
      totalCount: allMessages.length,
      canLoadEarlier: resolvedVisibleCount < allMessages.length
    },
    loadEarlierMessages: async () => {
      onLoadEarlier?.();
      setVisibleCount((current) => Math.min(allMessages.length, current + 16));
    }
  });

  return (
    <DataContextProvider value={data}>
      <ChatView showDecisions={false} showPermission={false} />
    </DataContextProvider>
  );
}

describe("ChatView progressive message window", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("renders only the latest message window on long threads", () => {
    render(<ProgressiveChatHarness />);

    expect(screen.queryByText("Message 18")).not.toBeInTheDocument();
    expect(screen.getByText("Message 19")).toBeInTheDocument();
    expect(screen.getByText("Message 30")).toBeInTheDocument();
  });

  test("loads earlier messages when the user reaches the top", async () => {
    let scrollHeight = 800;
    const { container } = render(
      <ProgressiveChatHarness
        onLoadEarlier={() => {
          scrollHeight = 1200;
        }}
      />
    );
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight
    });
    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      value: 300
    });

    scroll.scrollTop = 0;
    fireEvent.scroll(scroll);

    await waitFor(() => {
      expect(screen.getByText("Message 3")).toBeInTheDocument();
    });
    expect(screen.queryByText("Message 2")).not.toBeInTheDocument();
    expect(scroll.scrollTop).toBe(400);
  });

  test("shows a sticky previous user message anchor while scrolling history", async () => {
    const { container } = render(<ProgressiveChatHarness />);
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    const message19 = container.querySelector(
      '[data-chat-message-id="message-19"]'
    ) as HTMLDivElement;
    const message21 = container.querySelector(
      '[data-chat-message-id="message-21"]'
    ) as HTMLDivElement;
    const scrollIntoView = vi.fn();

    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      value: 1000
    });
    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      value: 300
    });
    vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue(rectAt(100));
    container
      .querySelectorAll<HTMLElement>("[data-chat-message-author='user']")
      .forEach((slot) => {
        if (slot === message19 || slot === message21) {
          return;
        }
        vi.spyOn(slot, "getBoundingClientRect").mockReturnValue(rectAt(260));
      });
    vi.spyOn(message19, "getBoundingClientRect").mockReturnValue(rectAt(70));
    vi.spyOn(message21, "getBoundingClientRect").mockReturnValue(rectAt(160));
    Object.defineProperty(message19, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });

    scroll.scrollTop = 200;
    fireEvent.scroll(scroll);

    await waitFor(() => {
      expect(container.querySelector(".lyra-agents-chat-thread-anchor-text")).toHaveTextContent("Message 19");
    });

    fireEvent.click(container.querySelector(".lyra-agents-chat-thread-anchor-button") as HTMLButtonElement);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  test("keeps the sticky previous user message anchor near the bottom of a long answer", async () => {
    const { container } = render(<ProgressiveChatHarness />);
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    const message19 = container.querySelector(
      '[data-chat-message-id="message-19"]'
    ) as HTMLDivElement;

    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      value: 1000
    });
    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      value: 300
    });
    vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue(rectAt(100));
    container
      .querySelectorAll<HTMLElement>("[data-chat-message-author='user']")
      .forEach((slot) => {
        if (slot === message19) {
          return;
        }
        vi.spyOn(slot, "getBoundingClientRect").mockReturnValue(rectAt(260));
      });
    vi.spyOn(message19, "getBoundingClientRect").mockReturnValue(rectAt(70));

    scroll.scrollTop = 699;
    fireEvent.scroll(scroll);

    await waitFor(() => {
      expect(container.querySelector(".lyra-agents-chat-thread-anchor-text")).toHaveTextContent("Message 19");
    });
  });

  test("hides the sticky anchor once its message is visible at the top", async () => {
    const { container } = render(<ProgressiveChatHarness />);
    const scroll = container.querySelector(".lyra-agents-chat-scroll") as HTMLDivElement;
    const message19 = container.querySelector(
      '[data-chat-message-id="message-19"]'
    ) as HTMLDivElement;
    let message19Top = 70;

    Object.defineProperty(scroll, "scrollHeight", {
      configurable: true,
      value: 1000
    });
    Object.defineProperty(scroll, "clientHeight", {
      configurable: true,
      value: 300
    });
    vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue(rectAt(100));
    container
      .querySelectorAll<HTMLElement>("[data-chat-message-author='user']")
      .forEach((slot) => {
        if (slot === message19) {
          return;
        }
        vi.spyOn(slot, "getBoundingClientRect").mockReturnValue(rectAt(260));
      });
    vi.spyOn(message19, "getBoundingClientRect").mockImplementation(() => rectAt(message19Top));

    scroll.scrollTop = 200;
    fireEvent.scroll(scroll);

    await waitFor(() => {
      expect(container.querySelector(".lyra-agents-chat-thread-anchor-text")).toHaveTextContent("Message 19");
    });

    message19Top = 100;
    fireEvent.scroll(scroll);

    await waitFor(() => {
      expect(container.querySelector(".lyra-agents-chat-thread-anchor-text")).not.toBeInTheDocument();
    });
  });
});
