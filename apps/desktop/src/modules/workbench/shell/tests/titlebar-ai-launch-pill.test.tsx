import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { TitlebarAiLaunchPill } from "../titlebar-ai-launch-pill";

const LOGO_URL = "data:image/svg+xml;utf8,<svg/>";
const VERBS = ["讨论", "编码", "思考", "探索"];
const EN_VERBS = ["Chat", "Code", "Build", "Debug", "Think", "Discuss", "Explore", "Collaborate"];

describe("TitlebarAiLaunchPill", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("renders logo, prefix, and the first verb", () => {
    render(
      <TitlebarAiLaunchPill
        isOpen={false}
        onToggle={vi.fn()}
        logoUrl={LOGO_URL}
        prefix="和 Lyra"
        verbs={VERBS}
        ariaLabel="切换左侧面板"
      />
    );

    const button = screen.getByRole("button", { name: "切换左侧面板" });
    expect(button).toBeInTheDocument();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.className).toContain("lyra-titlebar-ai-launch");
    expect(button.className).not.toContain("lyra-titlebar-ai-launch-open");

    const prefix = button.querySelector(".lyra-titlebar-ai-launch-prefix");
    expect(prefix?.textContent).toBe("和 Lyra");

    const word = button.querySelector(".lyra-titlebar-ai-launch-word");
    expect(word?.textContent).toBe("讨论");

    const logo = button.querySelector(".lyra-titlebar-ai-launch-logo");
    expect(logo).not.toBeNull();
  });

  test("renders a single sizer anchored to the shortest verb in the locale", () => {
    const { rerender } = render(
      <TitlebarAiLaunchPill
        isOpen={false}
        onToggle={vi.fn()}
        logoUrl={LOGO_URL}
        prefix="和 Lyra"
        verbs={VERBS}
        ariaLabel="切换左侧面板"
      />
    );

    const button = screen.getByRole("button", { name: "切换左侧面板" });
    const sizers = button.querySelectorAll(".lyra-titlebar-ai-launch-sizer");
    expect(sizers.length).toBe(1);
    expect(sizers[0]?.textContent).toBe("讨论");
    expect(sizers[0]?.getAttribute("aria-hidden")).toBe("true");

    rerender(
      <TitlebarAiLaunchPill
        isOpen={false}
        onToggle={vi.fn()}
        logoUrl={LOGO_URL}
        prefix="Lyra"
        verbs={EN_VERBS}
        ariaLabel="Toggle Left Panel"
      />
    );

    const enButton = screen.getByRole("button", { name: "Toggle Left Panel" });
    const enSizers = enButton.querySelectorAll(".lyra-titlebar-ai-launch-sizer");
    expect(enSizers.length).toBe(1);
    expect(enSizers[0]?.textContent).toBe("Chat");
  });

  test("exposes a marquee flag on the word that defaults to false without layout", () => {
    render(
      <TitlebarAiLaunchPill
        isOpen={false}
        onToggle={vi.fn()}
        logoUrl={LOGO_URL}
        prefix="Lyra"
        verbs={EN_VERBS}
        ariaLabel="Toggle Left Panel"
      />
    );

    const button = screen.getByRole("button", { name: "Toggle Left Panel" });
    const word = button.querySelector(".lyra-titlebar-ai-launch-word") as HTMLElement;
    expect(word.getAttribute("data-marquee")).toBe("false");
    expect(word.getAttribute("style")).toBeNull();
  });

  test("invokes onToggle when clicked", () => {
    const onToggle = vi.fn();
    render(
      <TitlebarAiLaunchPill
        isOpen={false}
        onToggle={onToggle}
        logoUrl={LOGO_URL}
        prefix="和 Lyra"
        verbs={VERBS}
        ariaLabel="切换左侧面板"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "切换左侧面板" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test("rotates to the next verb after the rotation interval and animation phases", () => {
    render(
      <TitlebarAiLaunchPill
        isOpen={false}
        onToggle={vi.fn()}
        logoUrl={LOGO_URL}
        prefix="和 Lyra"
        verbs={VERBS}
        ariaLabel="切换左侧面板"
        verbRotationMs={2000}
        exitDurationMs={200}
        enterDurationMs={300}
      />
    );

    const button = screen.getByRole("button", { name: "切换左侧面板" });
    const initialWord = button.querySelector(".lyra-titlebar-ai-launch-word") as HTMLElement;
    expect(initialWord.textContent).toBe("讨论");

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    const exitWord = button.querySelector(".lyra-titlebar-ai-launch-word") as HTMLElement;
    expect(exitWord.getAttribute("data-phase")).toBe("exit");
    expect(exitWord.textContent).toBe("讨论");

    act(() => {
      vi.advanceTimersByTime(200);
    });

    const enterWord = button.querySelector(".lyra-titlebar-ai-launch-word") as HTMLElement;
    expect(enterWord.getAttribute("data-phase")).toBe("enter");
    expect(enterWord.textContent).toBe("编码");

    act(() => {
      vi.advanceTimersByTime(400);
    });

    const idleWord = button.querySelector(".lyra-titlebar-ai-launch-word") as HTMLElement;
    expect(idleWord.getAttribute("data-phase")).toBe("idle");
    expect(idleWord.textContent).toBe("编码");
  });

  test("marks the open state with aria-pressed and class", () => {
    render(
      <TitlebarAiLaunchPill
        isOpen
        onToggle={vi.fn()}
        logoUrl={LOGO_URL}
        prefix="和 Lyra"
        verbs={VERBS}
        ariaLabel="切换左侧面板"
      />
    );

    const button = screen.getByRole("button", { name: "切换左侧面板" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.className).toContain("lyra-titlebar-ai-launch-open");
  });

  test("does not animate phases when reduced motion is preferred", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })) as unknown as typeof window.matchMedia;

    try {
      render(
        <TitlebarAiLaunchPill
          isOpen={false}
          onToggle={vi.fn()}
          logoUrl={LOGO_URL}
          prefix="和 Lyra"
          verbs={VERBS}
          ariaLabel="切换左侧面板"
          verbRotationMs={1500}
        />
      );

      const button = screen.getByRole("button", { name: "切换左侧面板" });

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      const word = button.querySelector(".lyra-titlebar-ai-launch-word") as HTMLElement;
      expect(word.getAttribute("data-phase")).toBe("idle");
      expect(word.textContent).toBe("编码");
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  test("stays on the single verb when only one is provided", () => {
    render(
      <TitlebarAiLaunchPill
        isOpen={false}
        onToggle={vi.fn()}
        logoUrl={LOGO_URL}
        prefix="和 Lyra"
        verbs={["讨论"]}
        ariaLabel="切换左侧面板"
        verbRotationMs={1000}
      />
    );

    const button = screen.getByRole("button", { name: "切换左侧面板" });
    const word = button.querySelector(".lyra-titlebar-ai-launch-word") as HTMLElement;
    expect(word.textContent).toBe("讨论");
    expect(word.getAttribute("data-phase")).toBe("idle");

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    const laterWord = button.querySelector(".lyra-titlebar-ai-launch-word") as HTMLElement;
    expect(laterWord.textContent).toBe("讨论");
    expect(laterWord.getAttribute("data-phase")).toBe("idle");

    const sizers = button.querySelectorAll(".lyra-titlebar-ai-launch-sizer");
    expect(sizers.length).toBe(1);
    expect(sizers[0]?.textContent).toBe("讨论");
  });
});
