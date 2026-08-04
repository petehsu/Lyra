import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { useFilesFavoriteOpener } from "../use-files-favorite-opener";

describe("Files favorite opener", () => {
  test("routes web and agent-session favorites without treating path favorites as apps", () => {
    const openAgentSession = vi.fn();
    const openPage = vi.fn();
    const beginPanelAnimation = vi.fn();
    const toggleLeftPanel = vi.fn();
    const { result, rerender } = renderHook(
      ({ visible }) => useFilesFavoriteOpener({
        openAgentSession,
        openPage,
        isLeftPanelVisible: visible,
        beginPanelAnimation,
        toggleLeftPanel
      }),
      { initialProps: { visible: false } }
    );

    act(() => result.current({
      id: "web",
      title: "Lyra",
      path: "https://lyra.ltd",
      kind: "web"
    }));
    expect(openPage).toHaveBeenCalledWith("https://lyra.ltd", "Lyra");

    act(() => result.current({
      id: "session",
      title: "Session",
      path: "agent-session:session-1",
      kind: "agent-session"
    }));
    expect(openAgentSession).toHaveBeenCalledWith("session-1");
    expect(beginPanelAnimation).toHaveBeenCalledOnce();
    expect(toggleLeftPanel).toHaveBeenCalledOnce();

    rerender({ visible: true });
    act(() => result.current({
      id: "path",
      title: "Project",
      path: "/project",
      kind: "path"
    }));
    expect(openPage).toHaveBeenCalledOnce();
    expect(openAgentSession).toHaveBeenCalledOnce();
  });
});
