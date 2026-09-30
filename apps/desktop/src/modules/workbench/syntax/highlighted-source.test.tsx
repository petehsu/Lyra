import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { HighlightedSource } from "./highlighted-source";
import { lyraCodePlugin } from "./code-plugin";

describe("HighlightedSource", () => {
  test("a late language load cannot overwrite newer source", () => {
    type Highlight = typeof lyraCodePlugin.highlight;
    const callbacks: Array<NonNullable<Parameters<Highlight>[1]>> = [];
    const mock = vi.spyOn(lyraCodePlugin, "highlight").mockImplementation((_options, callback) => {
      if (callback) callbacks.push(callback);
      return null;
    });
    try {
      const view = render(<HighlightedSource code="old" language="typescript" />);
      view.rerender(<HighlightedSource code="new" language="python" />);
      const result = (text: string) => ({ tokens: [[{ content: text, offset: 0 }]] }) as NonNullable<ReturnType<Highlight>>;
      act(() => callbacks[1]!(result("new")));
      act(() => callbacks[0]!(result("old")));
      expect(view.container.textContent).toBe("new");
    } finally {
      mock.mockRestore();
    }
  });

  test("writes token colors onto CSS variables after Shiki resolves", async () => {
    const { container } = render(
      <HighlightedSource code={"const x = 1;"} language="typescript" />
    );

    expect(container.textContent).toContain("const x = 1;");
    await waitFor(() => {
      const painted = [...container.querySelectorAll(".lyra-syntax-source span")].some(
        (node) => {
          const element = node as HTMLElement;
          return element.style.getPropertyValue("--sdm-c").length > 0
            || element.style.getPropertyValue("--shiki-dark").length > 0;
        }
      );
      expect(painted).toBe(true);
    }, { timeout: 8000 });
  });
});
