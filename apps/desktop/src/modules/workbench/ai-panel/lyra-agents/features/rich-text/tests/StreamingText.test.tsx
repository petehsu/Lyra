import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionMeta } from "../../../core/types";
import { createDataProviderValue } from "../../../data/createDataProviderValue";
import { DataContextProvider } from "../../../data/DataProvider";
import { getStreamStore, resetStreamStore } from "../../../../../agent-session-view-model/stream-store";
import { StreamingText } from "../StreamingText";
import {
  useSmoothStreamingText,
  useStreamingMessageReasoning,
  useStreamingMessageText
} from "../use-streaming-message-text";

const session: SessionMeta = {
  title: "Test",
  project: "Lyra",
  workingDir: "/tmp",
  projectBound: true,
  workingDirIsHome: false,
  totalAdditions: 0,
  totalDeletions: 0
};

const StreamingSnapshot = ({ messageId, blockId, fallback }: {
  readonly messageId: string;
  readonly blockId: string | null;
  readonly fallback: string;
}) => <span>{useStreamingMessageText(messageId, blockId, fallback, true)}</span>;

const ReasoningSnapshot = ({ messageId }: { readonly messageId: string }) => (
  <span>{useStreamingMessageReasoning(messageId, true)}</span>
);

describe("StreamingText", () => {
  beforeEach(() => resetStreamStore());

  it("renders streamdown content while streaming when rich mode is enabled", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    const { container } = render(
      <DataContextProvider value={data}>
        <StreamingText
          content={"# Title\n\nBody"}
          streaming
          messageId="test-msg-1"
          blockId="text-1"
        />
      </DataContextProvider>
    );

    expect(container.querySelector(".lyra-agents-rich-text")).not.toBeNull();
    expect(container.querySelector(".lyra-agents-streamdown")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Title" })).toBeTruthy();
    expect(container.textContent).toContain("Body");
  });

  it("renders math content while streaming", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    const { container } = render(
      <DataContextProvider value={data}>
        <StreamingText
          content={"$x^2$\n\n```mermaid\nflowchart LR\n  A-->B"}
          streaming
          messageId="test-msg-2"
          blockId="text-2"
        />
      </DataContextProvider>
    );

    // Math and mermaid are now rendered by streamdown plugins in both
    // streaming and final modes (unified renderer). The content should
    // be present in the DOM.
    expect(container.textContent).toContain("x^2");
  });

  it("shows partial fenced code before the closing fence arrives", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    const { container } = render(
      <DataContextProvider value={data}>
        <StreamingText content={"Here\n```ts\nconst x = 1"} streaming messageId="test-msg-3" blockId="text-3" />
      </DataContextProvider>
    );

    const codeBlock = container.querySelector('[data-streamdown="code-block"]');
    expect(codeBlock).not.toBeNull();
    expect(codeBlock?.getAttribute("data-language")).toBe("ts");
    expect(codeBlock?.textContent).toContain("const x = 1");
  });

  it("keeps plain typewriter output while streaming when rich mode is disabled", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: false
    });

    const { container } = render(
      <DataContextProvider value={data}>
        <StreamingText content={"# Title\n\nBody"} streaming messageId="test-msg-4" blockId="text-4" />
      </DataContextProvider>
    );

    expect(container.querySelector(".lyra-agents-rich-text")).toBeNull();
    expect(container.querySelector(".lyra-agents-streaming-text")).not.toBeNull();
    expect(container.querySelector(".lyra-agents-plain-text")).not.toBeNull();
    expect(screen.queryByText("Rendering…")).toBeNull();
  });

  it("uses the same streamdown renderer after streaming completes (no reflow)", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    const view = render(
      <DataContextProvider value={data}>
        <StreamingText content={"# Done\n\nBody"} streaming messageId="test-msg-5" blockId="text-5" />
      </DataContextProvider>
    );

    // While streaming: streamdown renders the content.
    const streamingHeading = screen.getByRole("heading", { name: "Done" });
    expect(streamingHeading).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
    expect(view.container.querySelector(".lyra-agents-streamdown")).not.toBeNull();

    view.rerender(
      <DataContextProvider value={data}>
        <StreamingText content={"# Done\n\nBody"} streaming={false} messageId="test-msg-5" blockId="text-5" />
      </DataContextProvider>
    );

    // After streaming: still streamdown (unified renderer), no switch to
    // a different renderer. The streamdown class should persist.
    expect(view.container.querySelector(".lyra-agents-streamdown")).not.toBeNull();
    // The old markdown-it document class should NOT appear.
    expect(view.container.querySelector(".lyra-agents-markdown-document")).toBeNull();
    expect(screen.getByRole("heading", { name: "Done" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Done" })).toBe(streamingHeading);
    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.queryByText("Rendering…")).toBeNull();
  });

  it("continues from an already committed block without dropping its prefix", async () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    render(
      <DataContextProvider value={data}>
        <StreamingText
          content="Existing"
          streaming
          messageId="test-msg-prefix"
          blockId="text-prefix"
        />
      </DataContextProvider>
    );

    await act(async () => {
      getStreamStore().appendDelta("test-msg-prefix", "text-prefix", " continuation");
      getStreamStore().flush();
    });

    expect(screen.getByText("Existing continuation")).toBeTruthy();
  });

  it("renders deltas for a native block created after the pending UI shell", async () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    render(
      <DataContextProvider value={data}>
        <StreamingText
          content=""
          streaming
          messageId="test-msg-emerging"
          blockId={null}
        />
      </DataContextProvider>
    );

    await act(async () => {
      getStreamStore().appendDelta("test-msg-emerging", "text-2", "Real-time output");
      getStreamStore().flush();
    });

    expect(screen.getByText("Real-time output")).toBeTruthy();
  });

  it("does not prepend stale fallback text to a replacement delta", async () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    render(
      <DataContextProvider value={data}>
        <StreamingText
          content="Stale"
          streaming
          messageId="test-msg-replace"
          blockId="text-replace"
        />
      </DataContextProvider>
    );

    await act(async () => {
      getStreamStore().appendDelta("test-msg-replace", "text-replace", "Fresh", true);
      getStreamStore().flush();
    });

    expect(getStreamStore().getBlockText("test-msg-replace", "text-replace")).toBe("Fresh");
    expect(getStreamStore().blockReplacesFallback("test-msg-replace", "text-replace")).toBe(true);
    expect(await screen.findByText("Fresh")).toBeTruthy();
    expect(screen.queryByText(/StaleFresh/u)).toBeNull();
  });

  it("publishes replacement snapshots to subscribers", async () => {
    render(
      <StreamingSnapshot
        messageId="snapshot-replace"
        blockId="snapshot-block"
        fallback="Stale"
      />
    );

    await act(async () => {
      getStreamStore().appendDelta("snapshot-replace", "snapshot-block", "Fresh", true);
      getStreamStore().flush();
    });

    expect(screen.getByText("Fresh")).toBeTruthy();
  });

  it("publishes live reasoning without rebuilding the session snapshot", async () => {
    render(<ReasoningSnapshot messageId="reasoning-message" />);

    await act(async () => {
      getStreamStore().appendReasoningDelta("reasoning-message", "Inspecting live output");
      getStreamStore().flush();
    });

    expect(screen.getByText("Inspecting live output")).toBeTruthy();
  });

  it("paces a coarse provider burst across frames, including finalization", () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const burst = "x".repeat(900);
    const hook = renderHook(
      ({ text, streaming }) => useSmoothStreamingText(text, streaming),
      { initialProps: { text: "", streaming: true } }
    );

    hook.rerender({ text: burst, streaming: false });
    expect(hook.result.current.catchingUp).toBe(true);
    expect(hook.result.current.text).toBe("");

    const firstFrame = frames.shift();
    expect(firstFrame).toBeDefined();
    act(() => firstFrame?.(16));
    expect(hook.result.current.text.length).toBeGreaterThan(0);
    expect(hook.result.current.text.length).toBeLessThan(burst.length);

    hook.unmount();
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
  });
});
