import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { BrowserSettingsSurface } from "../settings-surface";
import { createBrowserSettingsSurfaceProps } from "./settings-test-helpers";

vi.mock("../../settings-ai", () => ({
  SettingsAiMcpView: () => <div aria-label="ai-mcp-settings" />,
  SettingsAiModelsView: () => <div aria-label="ai-models-settings" />,
  SettingsAiSkillsView: () => <div aria-label="ai-skills-settings" />
}));

vi.mock("../../login-manager", () => ({
  LoginManagerSurface: ({ embedded }: { readonly embedded?: boolean }) => (
    <div aria-label="login-manager-settings" data-embedded={embedded ? "true" : "false"} />
  )
}));

vi.mock("../../settings-import", () => ({
  SettingsImportView: () => <div aria-label="import-settings" />
}));

describe("BrowserSettingsSurface", () => {
  test("routes category navigation through a single active settings page", () => {
    render(<BrowserSettingsSurface {...createBrowserSettingsSurfaceProps()} />);

    const nav = screen.getByLabelText("settings-nav");
    expect(screen.getByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search languages" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Bing" })).toBeNull();

    fireEvent.click(within(nav).getByRole("button", { name: "Search" }));

    expect(within(nav).getByRole("button", { name: "Search" })).toHaveClass(
      "lyra-settings-nav-item-active"
    );
    expect(screen.getByRole("heading", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Bing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Search languages" })).toBeNull();
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
    expect(screen.queryByText("Provider Login")).not.toBeInTheDocument();
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
  });

  test("opens the standalone import settings category", () => {
    render(
      <BrowserSettingsSurface
        {...createBrowserSettingsSurfaceProps({
          focusCategoryRequest: { categoryId: "importSettings", requestId: 1 }
        })}
      />
    );

    const nav = screen.getByLabelText("settings-nav");
    expect(within(nav).getByRole("button", { name: "Import Settings" })).toHaveClass(
      "lyra-settings-nav-item-active"
    );
    expect(screen.getByLabelText("import-settings")).toBeInTheDocument();
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
    expect(nav.querySelector(".lyra-settings-nav-list")).toContainElement(docsButton);

    fireEvent.click(docsButton);

    expect(onOpenDocs).toHaveBeenCalledTimes(1);
    expect(within(nav).getByRole("button", { name: "General" })).toHaveClass(
      "lyra-settings-nav-item-active"
    );
  });

  test("renders the signed-in account and routes logout through the account action", () => {
    const onAction = vi.fn();
    const { container } = render(
      <BrowserSettingsSurface
        {...createBrowserSettingsSurfaceProps({
          account: {
            kind: "signed-in",
            displayName: "Pete Hsu",
            avatarUrl: "https://example.com/avatar.png",
            actionLabel: "Sign out",
            actionPending: false,
            onAction
          }
        })}
      />
    );

    expect(screen.getByText("Pete Hsu")).toBeInTheDocument();
    expect(container.querySelector(".lyra-settings-account-avatar img")).toHaveAttribute(
      "src",
      "https://example.com/avatar.png"
    );
    expect(container.querySelector(".lyra-settings-nav-actions")).toContainElement(
      screen.getByText("Pete Hsu")
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  test("renders the local account with the Lyra logo and a login action", () => {
    const onAction = vi.fn();
    const { container, rerender } = render(
      <BrowserSettingsSurface
        {...createBrowserSettingsSurfaceProps({
          account: {
            kind: "local",
            displayName: "Local account",
            avatarUrl: null,
            actionLabel: "Sign in",
            actionPending: false,
            onAction
          }
        })}
      />
    );

    expect(screen.getByText("Local account")).toBeInTheDocument();
    expect(container.querySelector(".lyra-settings-account-local-logo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Docs" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onAction).toHaveBeenCalledTimes(1);

    rerender(
      <BrowserSettingsSurface
        {...createBrowserSettingsSurfaceProps({
          account: {
            kind: "signed-in",
            displayName: "Pete Hsu",
            avatarUrl: null,
            actionLabel: "Sign out",
            actionPending: true,
            onAction: vi.fn()
          }
        })}
      />
    );

    expect(screen.getByText("P")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled();
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
