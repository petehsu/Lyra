import { fireEvent, render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { ChatEmptyState } from "../ChatEmptyState";

describe("ChatEmptyState", () => {
  test("renders logo as a pre element with project name", () => {
    const { container } = render(
      <ChatEmptyState
        projectName="Lyra"
        isHome={false}
        onChooseProject={() => undefined}
      />
    );

    const logo = container.querySelector(".lyra-agents-chat-empty-logo");
    expect(logo).not.toBeNull();
    expect(logo!.tagName).toBe("PRE");

    const project = container.querySelector(".lyra-agents-chat-empty-project");
    expect(project).not.toBeNull();
    expect(project!.textContent).toBe("Lyra");
  });

  test("shows Home when no project is chosen", () => {
    const { container } = render(
      <ChatEmptyState
        projectName={null}
        isHome={true}
        onChooseProject={() => undefined}
      />
    );

    const project = container.querySelector(".lyra-agents-chat-empty-project");
    expect(project).not.toBeNull();
  });

  test("clicking project button calls onChooseProject", () => {
    const onChooseProject = vi.fn();
    const { container } = render(
      <ChatEmptyState
        projectName="Lyra"
        isHome={false}
        onChooseProject={onChooseProject}
      />
    );

    const project = container.querySelector(".lyra-agents-chat-empty-project")!;
    fireEvent.click(project);
    expect(onChooseProject).toHaveBeenCalledTimes(1);
  });
});