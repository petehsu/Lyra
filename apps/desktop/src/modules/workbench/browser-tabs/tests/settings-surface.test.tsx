import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { BrowserSettingsSurface } from "../settings-surface";
import { createBrowserSettingsSurfaceProps } from "./settings-test-helpers";

vi.mock("../../settings-ai", () => ({
  SettingsAiMcpView: () => <div aria-label="ai-mcp-settings" />,
  SettingsAiModelsView: () => <div aria-label="ai-models-settings" />,
  SettingsAiSkillsView: () => <div aria-label="ai-skills-settings" />,
  SettingsAiView: () => <div aria-label="ai-provider-settings" />
}));

vi.mock("../../login-manager", () => ({
  LoginManagerSurface: ({ embedded }: { readonly embedded?: boolean }) => (
    <div aria-label="login-manager-settings" data-embedded={embedded ? "true" : "false"} />
  )
}));

describe("BrowserSettingsSurface", () => {
  test("routes category navigation through a single active settings page", () => {
    render(<BrowserSettingsSurface {...createBrowserSettingsSurfaceProps()} />);

    const nav = screen.getByLabelText("settings-nav");
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Language" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Bing" })).toBeNull();

    fireEvent.click(within(nav).getByRole("button", { name: "Search" }));

    expect(within(nav).getByRole("button", { name: "Search" })).toHaveClass(
      "lyra-settings-nav-item-active"
    );
    expect(screen.getByRole("heading", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Bing" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Language" })).toBeNull();
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
    expect(within(nav).getByRole("button", { name: "Lyra Agents" })).toHaveClass(
      "lyra-settings-nav-item-active"
    );
    expect(screen.getByLabelText("ai-provider-settings")).toBeInTheDocument();
  });

  test("opens directly to the Models settings category when requested", () => {
    render(
      <BrowserSettingsSurface
        {...createBrowserSettingsSurfaceProps({
          focusCategoryRequest: { categoryId: "models", requestId: 1 }
        })}
      />
    );

    const nav = screen.getByLabelText("settings-nav");
    expect(within(nav).getByRole("button", { name: "Models" })).toHaveClass(
      "lyra-settings-nav-item-active"
    );
    expect(screen.getByLabelText("ai-models-settings")).toBeInTheDocument();
    expect(screen.queryByLabelText("ai-provider-settings")).not.toBeInTheDocument();
  });

  test("renders Login Manager as an embedded settings category", () => {
    render(
      <BrowserSettingsSurface
        {...createBrowserSettingsSurfaceProps({
          focusCategoryRequest: { categoryId: "loginManager", requestId: 1 }
        })}
      />
    );

    const nav = screen.getByLabelText("settings-nav");
    expect(within(nav).getByRole("button", { name: "Login Manager" })).toHaveClass(
      "lyra-settings-nav-item-active"
    );
    expect(screen.getByLabelText("login-manager-settings")).toHaveAttribute("data-embedded", "true");
  });

  test("loads open source notices in the Legal category", async () => {
    const readThirdPartyNotices = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: "2026-06-30T00:00:00.000Z",
      packageCount: 1,
      ecosystems: { npm: 1 },
      items: [
        {
          name: "Example Package",
          version: "1.0.0",
          ecosystem: "npm",
          license: "MIT",
          repository: "https://example.test/repo",
          noticeText: "Example notice",
          licenseText: "Example license"
        }
      ],
      markdown: "# Third-Party Notices\n"
    });

    render(
      <BrowserSettingsSurface
        {...createBrowserSettingsSurfaceProps({
          desktopApi: {
            legal: { readThirdPartyNotices }
          } as unknown as NonNullable<ReturnType<typeof createBrowserSettingsSurfaceProps>["desktopApi"]>,
          focusCategoryRequest: { categoryId: "legal", requestId: 1 }
        })}
      />
    );

    const nav = screen.getByLabelText("settings-nav");
    expect(within(nav).getByRole("button", { name: "Legal" })).toHaveClass(
      "lyra-settings-nav-item-active"
    );
    expect(await screen.findByRole("heading", { name: "Open Source Notices" })).toBeInTheDocument();
    expect(screen.getByText("Last updated June 30, 2026")).toBeInTheDocument();
    expect(screen.getByText("The following lists open source components.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Example Package" })).toBeInTheDocument();
    expect(screen.getByText(/Example notice/u)).toBeInTheDocument();
    expect(screen.getByText(/Example license/u)).toBeInTheDocument();
    expect(readThirdPartyNotices).toHaveBeenCalledTimes(1);
  });

  test("renders docs as a jump action in settings navigation", () => {
    const onOpenDocs = vi.fn();

    render(
      <BrowserSettingsSurface
        {...createBrowserSettingsSurfaceProps({
          onOpenDocs
        })}
      />
    );

    const nav = screen.getByLabelText("settings-nav");
    const docsButton = within(nav).getByRole("button", { name: "Docs" });

    expect(docsButton).toHaveClass("lyra-settings-nav-item-jump");
    expect(docsButton).not.toHaveClass("lyra-settings-nav-item-active");

    fireEvent.click(docsButton);

    expect(onOpenDocs).toHaveBeenCalledTimes(1);
    expect(within(nav).getByRole("button", { name: "General" })).toHaveClass(
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

    fireEvent.click(within(screen.getByLabelText("settings-nav")).getByRole("button", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Theme" }));
    fireEvent.click(screen.getByRole("option", { name: "Dark" }));

    fireEvent.click(within(screen.getByLabelText("settings-nav")).getByRole("button", { name: "General" }));
    fireEvent.click(screen.getByRole("switch", { name: "Prevent sleep" }));

    fireEvent.click(within(screen.getByLabelText("settings-nav")).getByRole("button", { name: "Search" }));
    fireEvent.click(screen.getByRole("switch", { name: "Bing" }));

    expect(onThemeChange).toHaveBeenCalledWith("lyra-dark");
    expect(onPreventSleepChange).toHaveBeenCalledWith(false);
    expect(onSearchWebEnginesChange).toHaveBeenCalledWith(["google", "bing"]);
  });
});
