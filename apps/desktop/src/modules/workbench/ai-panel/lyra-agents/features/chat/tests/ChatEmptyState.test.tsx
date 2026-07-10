import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { ChatEmptyState } from "../ChatEmptyState";

describe("ChatEmptyState", () => {
  test("animates once for each new empty session and replays only after a click", () => {
    const { container, rerender } = render(
      <ChatEmptyState
        key="session-a"
        projectName="Lyra"
        isHome={false}
        onChooseProject={() => undefined}
      />
    );

    const staticLogo = container.querySelector(
      ".lyra-agents-chat-empty-logo"
    ) as HTMLButtonElement;
    expect(staticLogo.dataset.animate).toBe("true");

    fireEvent.animationEnd(staticLogo);
    expect(staticLogo.dataset.animate).toBe("false");

    fireEvent.click(staticLogo);
    const animatedLogo = container.querySelector(
      ".lyra-agents-chat-empty-logo"
    ) as HTMLButtonElement;
    expect(animatedLogo).not.toBe(staticLogo);
    expect(animatedLogo.dataset.animate).toBe("true");

    fireEvent.animationEnd(animatedLogo);
    rerender(
      <ChatEmptyState
        key="session-b"
        projectName="Lyra"
        isHome={false}
        onChooseProject={() => undefined}
      />
    );
    expect(
      (container.querySelector(".lyra-agents-chat-empty-logo") as HTMLButtonElement)
        .dataset.animate
    ).toBe("true");
  });
});
