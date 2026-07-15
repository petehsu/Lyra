import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AgentProviderBrandIcon } from "./agent-provider-brand-icon";

const resolveProviderIconMock = vi.hoisted(() => vi.fn());

vi.mock("./shell/service", () => ({
  getDesktopApi: () => ({
    agent: { resolveProviderIcon: resolveProviderIconMock }
  })
}));

afterEach(() => {
  resolveProviderIconMock.mockReset();
});

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

  test("renders the IPC-resolved site icon for custom providers", async () => {
    resolveProviderIconMock.mockResolvedValue({
      iconUrl: "lyra-file://preview?path=%2Fx&contentType=image/png"
    });
    const { container } = render(
      <AgentProviderBrandIcon
        baseUrl="https://api.example.com/v1"
        providerId="custom_endpoint"
        label="Custom"
      />
    );

    const image = await waitFor(() => {
      const el = container.querySelector(".lyra-agent-provider-brand-icon-image");
      if (!el) throw new Error("site icon not rendered yet");
      return el;
    });
    expect(image).toHaveAttribute(
      "src",
      "lyra-file://preview?path=%2Fx&contentType=image/png"
    );
    expect(resolveProviderIconMock).toHaveBeenCalledWith({
      baseUrl: "https://api.example.com/v1"
    });
  });

  test("falls back to initials when the custom provider icon cannot be resolved", async () => {
    resolveProviderIconMock.mockResolvedValue({ iconUrl: null });
    const { container } = render(
      <AgentProviderBrandIcon
        baseUrl="https://api.example.com/v1"
        providerId="custom_endpoint"
        label="Custom"
      />
    );

    await waitFor(() => {
      if (!resolveProviderIconMock.mock.calls.length) throw new Error("not called yet");
    });
    // 让解析后的空响应刷新状态后，再断言最终落到 initials 分支
    await waitFor(() => {
      if (!container.querySelector(".lyra-agent-provider-brand-icon-initials")) {
        throw new Error("initials not rendered yet");
      }
    });
    expect(container.querySelector(".lyra-agent-provider-brand-icon-image")).toBeNull();
  });
});