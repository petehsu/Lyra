import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";

import {
  AiComputerViewStateProvider,
  useAiComputerBrowserViewState
} from "../browser-view-state";

describe("ai computer browser view state", () => {
  test("keeps state inside the same provider scope", () => {
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <AiComputerViewStateProvider sessionId="session-a">
        {children}
      </AiComputerViewStateProvider>
    );

    const { result } = renderHook(
      () => useAiComputerBrowserViewState("browser-1", "https://lyra.sh"),
      { wrapper }
    );

    act(() => {
      result.current.setInputValue("lyra runtime");
    });

    expect(result.current.state.inputValue).toBe("lyra runtime");
    expect(result.current.state.address).toBe("https://lyra.sh");
  });

  test("resets store when session scope changes", () => {
    let sessionId = "session-a";
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <AiComputerViewStateProvider sessionId={sessionId}>
        {children}
      </AiComputerViewStateProvider>
    );

    const { result, rerender } = renderHook(
      () => useAiComputerBrowserViewState("browser-1", "https://lyra.sh"),
      { wrapper }
    );

    act(() => {
      result.current.setInputValue("local draft");
      result.current.setAddress("https://docs.lyra.sh");
    });
    expect(result.current.state).toEqual({
      inputValue: "local draft",
      address: "https://docs.lyra.sh"
    });

    sessionId = "session-b";
    rerender();

    expect(result.current.state).toEqual({
      inputValue: "https://lyra.sh",
      address: "https://lyra.sh"
    });
  });
});
