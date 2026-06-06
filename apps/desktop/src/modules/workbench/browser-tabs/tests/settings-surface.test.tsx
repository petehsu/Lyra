import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { BrowserSettingsSurface } from "../settings-surface";
import { createBrowserSettingsSurfaceProps } from "./settings-test-helpers";

vi.mock("../../settings-ai", () => ({
  SettingsAiView: () => <div aria-label="ai-provider-settings" />
}));

describe("BrowserSettingsSurface", () => {
  test("routes category navigation through a single active settings page", () => {
    render(<BrowserSettingsSurface {...createBrowserSettingsSurfaceProps()} />);

    const nav = screen.getByLabelText("settings-nav");
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Language" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bing" })).toBeNull();

    fireEvent.click(within(nav).getByRole("button", { name: "Search" }));

    expect(within(nav).getByRole("button", { name: "Search" })).toHaveClass(
      "lyra-settings-nav-item-active"
    );
    expect(screen.getByRole("heading", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bing" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Language" })).toBeNull();
  });

  test("opens directly to the AI provider settings category when requested", () => {
    render(
      <BrowserSettingsSurface
        {...createBrowserSettingsSurfaceProps({
          focusCategoryRequest: { categoryId: "ai", requestId: 1 }
        })}
      />
    );

    const nav = screen.getByLabelText("settings-nav");
    expect(within(nav).getByRole("button", { name: "AI" })).toHaveClass(
      "lyra-settings-nav-item-active"
    );
    expect(screen.getByLabelText("ai-provider-settings")).toBeInTheDocument();
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

    fireEvent.click(within(screen.getByLabelText("settings-nav")).getByRole("button", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    fireEvent.click(within(screen.getByLabelText("settings-nav")).getByRole("button", { name: "General" }));
    const preventSleepGroup = screen.getByRole("radiogroup", { name: "Prevent sleep" });
    fireEvent.click(within(preventSleepGroup).getByRole("radio", { name: /Disabled/ }));

    fireEvent.click(within(screen.getByLabelText("settings-nav")).getByRole("button", { name: "Search" }));
    fireEvent.click(screen.getByRole("button", { name: "Bing" }));

    expect(onThemeChange).toHaveBeenCalledWith("lyra-dark");
    expect(onPreventSleepChange).toHaveBeenCalledWith(false);
    expect(onSearchWebEnginesChange).toHaveBeenCalledWith(["google", "bing"]);
  });
});
