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
});
