import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import {
  useWorkbenchTitlebarContribution,
  WorkbenchTitlebarContextProvider,
  WorkbenchTitlebarContextSlot,
  WorkbenchTitlebarScopeProvider
} from "../titlebar-context";

const TestTitlebarContributor = () => {
  useWorkbenchTitlebarContribution({
    ariaLabel: "test titlebar context",
    content: (
      <>
        <span className="lyra-titlebar-context-chip">Status</span>
        <button type="button">Action</button>
      </>
    )
  });
  return null;
};

describe("WorkbenchTitlebarContextSlot", () => {
  test("keeps the registered context slot draggable outside its controls", async () => {
    render(
      <WorkbenchTitlebarContextProvider activeScopeId="test-scope">
        <WorkbenchTitlebarScopeProvider scopeId="test-scope">
          <TestTitlebarContributor />
        </WorkbenchTitlebarScopeProvider>
        <WorkbenchTitlebarContextSlot />
      </WorkbenchTitlebarContextProvider>
    );

    const context = await screen.findByLabelText("test titlebar context");
    expect(context).toHaveClass("lyra-titlebar-context");
    expect(context).not.toHaveClass("lyra-no-drag");
    expect(screen.getByRole("button", { name: "Action" })).toBeInTheDocument();
  });
});
