import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { AiTower } from "../index";

describe("ai tower", () => {
  test("switches mode and sends message", () => {
    const onModeChange = vi.fn();
    const onSendMessage = vi.fn();

    render(
      <AiTower
        mode="agent"
        plan={[{ id: "p1", label: "计划", state: "running" }]}
        actions={[{ id: "a1", action: "read_file", status: "running", timestamp: "09:00:00" }]}
        approvals={[{ id: "ap1", summary: "修改配置", status: "pending" }]}
        thread={[{ id: "m1", role: "assistant", content: "ready" }]}
        onModeChange={onModeChange}
        onSendMessage={onSendMessage}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Assist" }));
    fireEvent.change(screen.getByPlaceholderText("给 AI 发送消息（Enter）"), {
      target: { value: "继续执行" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(onModeChange).toHaveBeenCalledWith("assist");
    expect(onSendMessage).toHaveBeenCalledWith("继续执行");
  });
});
