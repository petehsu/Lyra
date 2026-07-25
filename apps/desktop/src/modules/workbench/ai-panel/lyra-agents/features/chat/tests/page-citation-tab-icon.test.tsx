import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { WebsiteLinkIcon } from "../page-citation-tab-icon";

describe("WebsiteLinkIcon", () => {
  test("keeps a same-size fallback visible until the favicon has loaded", () => {
    const { container, rerender } = render(
      <WebsiteLinkIcon faviconUrl="https://example.com/favicon.ico" />
    );

    const firstImage = container.querySelector("img");
    expect(firstImage).not.toBeNull();
    expect(firstImage).not.toHaveAttribute("data-loaded");
    expect(
      container.querySelector(".lyra-agents-page-citation-chip-favicon-fallback")
    ).not.toBeNull();

    fireEvent.load(firstImage as HTMLImageElement);
    expect(firstImage).toHaveAttribute("data-loaded", "true");

    rerender(
      <WebsiteLinkIcon faviconUrl="https://example.com/new-favicon.ico" />
    );
    const nextImage = container.querySelector("img");
    expect(nextImage).not.toBe(firstImage);
    expect(nextImage).not.toHaveAttribute("data-loaded");

    fireEvent.error(nextImage as HTMLImageElement);
    expect(nextImage).toHaveAttribute("data-failed", "true");
    expect(nextImage).not.toHaveAttribute("data-loaded");
  });
});
