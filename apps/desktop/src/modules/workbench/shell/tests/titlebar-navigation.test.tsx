import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { TitlebarNavigation } from "../titlebar-navigation";

const renderNavigation = (
  overrides: Partial<Parameters<typeof TitlebarNavigation>[0]> = {}
) => {
  const onSubmit = vi.fn();
  const onChange = vi.fn();

  render(
    <TitlebarNavigation
      value="https://example.com/"
      placeholder="Search"
      ariaLabel="Address"
      submitLabel="Go"
      reloadLabel="Reload page"
      primaryActionKind="submit"
      isContextualAddress={false}
      onChange={onChange}
      onSubmit={onSubmit}
      onFocus={vi.fn()}
      onBlur={vi.fn()}
      {...overrides}
    />
  );

  return { onChange, onSubmit };
};

describe("TitlebarNavigation", () => {
  test("uses the submit label for the default primary action", () => {
    const { onSubmit } = renderNavigation();

    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toHaveAttribute("title", "Go");

    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("uses the reload label and icon for reload primary action", () => {
    const { onSubmit } = renderNavigation({
      primaryActionKind: "reload"
    });

    const button = screen.getByRole("button", { name: "Reload page" });
    expect(button).toHaveAttribute("title", "Reload page");
    expect(button.querySelector("svg")).not.toBeNull();

    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
