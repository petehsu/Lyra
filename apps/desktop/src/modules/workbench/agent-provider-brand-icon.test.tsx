import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { AgentProviderBrandIcon } from "./agent-provider-brand-icon";

describe("AgentProviderBrandIcon", () => {
  test("marks dark mono brand colors so theme CSS can invert them", () => {
    const { container } = render(<AgentProviderBrandIcon provider="openai" label="GPT" />);
    const icon = container.querySelector(".lyra-agent-provider-brand-icon");
    const svg = icon?.querySelector("svg");

    expect(icon).toHaveAttribute("data-lyra-brand-luma", "dark");
    expect(svg).toHaveStyle({ color: "#000" });
  });

  test("marks light mono brand colors so theme CSS can invert them", () => {
    const { container } = render(<AgentProviderBrandIcon provider="xai" label="Grok" />);
    const icon = container.querySelector(".lyra-agent-provider-brand-icon");
    const svg = icon?.querySelector("svg");

    expect(icon).toHaveAttribute("data-lyra-brand-luma", "light");
    expect(svg).toHaveStyle({ color: "#fff" });
  });

  test("uses the site favicon for custom provider base URLs", () => {
    const { container } = render(
      <AgentProviderBrandIcon
        baseUrl="https://api.example.com/v1"
        providerId="custom_openai_compatible"
        label="Custom"
      />
    );

    const image = container.querySelector(".lyra-agent-provider-brand-icon-image");
    expect(image).toHaveAttribute("src", "https://api.example.com/favicon.ico");
  });
});
