import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage, SessionMeta } from "../../../core/types";
import { createDataProviderValue } from "../../../data/createDataProviderValue";
import { DataContextProvider } from "../../../data/DataProvider";
import { getStreamStore, resetStreamStore } from "../../../../../agent-session-view-model/stream-store";
import { Message } from "../Message";
import { withStreamingReasoning } from "../message-activity-blocks";

const session: SessionMeta = {
  id: "reasoning-session", title: "Test", project: "", workingDir: "/tmp",
  projectBound: true, workingDirIsHome: false, totalAdditions: 0, totalDeletions: 0
};
const snapshot = (): ChatMessage => ({
  id: "reasoning-message", author: "agent", blocks: [
    { type: "thinking", id: "thinking-1", body: "已读取快照。", status: "running" },
    { type: "text", id: "text-1", body: "" }
  ]
});

describe("reasoning after loading a running session", () => {
  beforeEach(() => resetStreamStore());

  it("keeps an expanded snapshot thinking row live without resetting its disclosure", () => {
    const message = snapshot();
    const data = createDataProviderValue({ session, messages: [message], isTurnRunning: true, followActivity: "streaming_model" });
    const { container } = render(<DataContextProvider value={data}><Message message={message} /></DataContextProvider>);
    fireEvent.click(container.querySelector(".lyra-agents-tool-group-head") as HTMLButtonElement);
    fireEvent.click(container.querySelector(".lyra-agents-tool-call-twist") as HTMLButtonElement);
    const body = container.querySelector(".lyra-agents-thinking-body");
    expect(body?.textContent).toBe("已读取快照。");
    act(() => { getStreamStore().appendReasoningDelta(message.id, "新的思考正在到达。"); getStreamStore().flush(); });
    expect(container.querySelector(".lyra-agents-thinking-body")).toBe(body);
    expect(body?.textContent).toBe("已读取快照。新的思考正在到达。");
    act(() => { getStreamStore().appendReasoningDelta(message.id, "继续更新。"); getStreamStore().flush(); });
    expect(body?.textContent).toBe("已读取快照。新的思考正在到达。继续更新。");
  });

  it("does not duplicate a snapshot prefix already in the stream", () => {
    expect(withStreamingReasoning(snapshot(), "已读取快照。新的思考。", true)[0]).toMatchObject({
      id: "thinking-1", body: "已读取快照。新的思考。", status: "running"
    });
  });

  it("preserves completed thoughts from earlier model responses", () => {
    const message: ChatMessage = {
      ...snapshot(), streamingMessageId: "current-response", blocks: [
        { type: "thinking", id: "old-thought", sourceMessageId: "old-response", body: "此前的思考。", status: "done" },
        { type: "thinking", id: "current-thought", sourceMessageId: "current-response", body: "当前快照。", status: "running" },
        { type: "text", id: "text", sourceMessageId: "current-response", body: "" }
      ]
    };
    const blocks = withStreamingReasoning(message, "新的内容。", true);
    expect(blocks[0]).toBe(message.blocks[0]);
    expect(blocks[1]).toMatchObject({ id: "current-thought", body: "当前快照。新的内容。" });
  });

  it("keeps completed persisted reasoning authoritative", () => {
    const message: ChatMessage = { ...snapshot(), blocks: [
      { type: "thinking", id: "thinking-1", body: "完整的思考。", status: "done" }
    ] };
    expect(withStreamingReasoning(message, "旧的增量。", false)).toBe(message.blocks);
  });

  it("does not roll a newer snapshot back to an older stream prefix", () => {
    const message = snapshot();
    expect(withStreamingReasoning(message, "已读取", true)).toBe(message.blocks);
  });

  it("retains the received tail when the reasoning channel closes", () => {
    expect(withStreamingReasoning(snapshot(), "最后的思考。", false)[0]).toMatchObject({
      id: "thinking-1", body: "已读取快照。最后的思考。", status: "done"
    });
  });
});
