import { render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { HighlightedSource } from "./highlighted-source";

describe("HighlightedSource", () => {
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
