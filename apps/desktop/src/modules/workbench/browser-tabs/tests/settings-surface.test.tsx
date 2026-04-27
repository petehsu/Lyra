import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { BrowserSettingsSurface } from "../settings-surface";
import { createBrowserSettingsSurfaceProps } from "./settings-test-helpers";

vi.mock("../../settings-ai", () => ({
  SettingsAiView: () => <div aria-label="ai-provider-settings" />
}));

const installScrollIntoViewMock = () => {
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView
  });
  return scrollIntoView;
};

describe("BrowserSettingsSurface", () => {
  test("routes category navigation through the shell state and scroll target", () => {
    const scrollIntoView = installScrollIntoViewMock();

    render(<BrowserSettingsSurface {...createBrowserSettingsSurfaceProps()} />);

    const nav = screen.getByLabelText("settings-nav");
    fireEvent.click(within(nav).getByRole("button", { name: "Search" }));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start"
    });
    expect(within(nav).getByRole("button", { name: "Search" })).toHaveClass(
      "lyra-settings-nav-item-active"
    );
  });

  test("routes choice, boolean, and multi-choice controls through props", () => {
    const onThemeChange = vi.fn();
    const onPreventSleepChange = vi.fn();
    const onSearchWebEnginesChange = vi.fn();

    render(
      <BrowserSettingsSurface
        {...createBrowserSettingsSurfaceProps({
          onThemeChange,
          onPreventSleepChange,
          onSearchWebEnginesChange
        })}
      />
    );

    const preventSleepGroup = screen.getByRole("radiogroup", { name: "Prevent sleep" });

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    fireEvent.click(within(preventSleepGroup).getByRole("radio", { name: /Disabled/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bing" }));

    expect(onThemeChange).toHaveBeenCalledWith("lyra-dark");
    expect(onPreventSleepChange).toHaveBeenCalledWith(false);
    expect(onSearchWebEnginesChange).toHaveBeenCalledWith(["google", "bing"]);
  });

  test("keeps pending rebuild index actions disabled", () => {
    render(
      <BrowserSettingsSurface
        {...createBrowserSettingsSurfaceProps({
          searchRebuildIndexPending: true
        })}
      />
    );

    expect(screen.getByRole("button", { name: "Rebuild..." })).toBeDisabled();
  });
});
