import { beforeEach, describe, expect, test } from "vitest";

import { createApprovalRequest, createThreadMessage, useAiStore } from "../service";

describe("ai store", () => {
  beforeEach(() => {
    useAiStore.setState(useAiStore.getInitialState());
  });

  test("switches mode and appends message", () => {
    useAiStore.getState().setMode("assist");
    useAiStore.getState().addThreadMessage(createThreadMessage("user", "hello"));

    const state = useAiStore.getState();
    expect(state.mode).toBe("assist");
    expect(state.thread[state.thread.length - 1]?.content).toBe("hello");
  });

  test("approves pending request", () => {
    const request = createApprovalRequest("修改系统代理配置");
    useAiStore.getState().requestApproval(request);
    useAiStore.getState().setApprovalStatus(request.id, "approved");

    const item = useAiStore.getState().approvals.find((approval) => approval.id === request.id);
    expect(item?.status).toBe("approved");
  });
});
