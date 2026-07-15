import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { SessionMeta } from "../../core/types";
import { createDataProviderValue } from "../../data/createDataProviderValue";
import { DataContextProvider } from "../../data/DataProvider";
import { HeaderControls } from "./Header";

const session: SessionMeta = {
  id: "header-test-session",
  title: "New session",
  project: "",
  workingDir: null,
  projectBound: false,
  workingDirIsHome: true,
  totalAdditions: 0,
  totalDeletions: 0
};

test("uses the label grid for new-session modes instead of the icon grid", async () => {
  const data = createDataProviderValue({
    session,
    messages: [],
    createSession: vi.fn(async () => undefined)
  });
  const { container } = render(
    <DataContextProvider value={data}>
      <HeaderControls forceShowNewSessionButton />
    </DataContextProvider>
  );

  fireEvent.keyDown(container.querySelector("button.app-header-new-session")!, {
    key: "ArrowDown"
  });
  const soloLabel = await screen.findByText(/Solo/);
  const soloItem = soloLabel.closest("[role='menuitem']");

  expect(soloItem).toHaveClass("lyra-agents-header-mode-item");
  expect(soloItem).not.toHaveClass("lyra-app-menu-item-with-icon");
});
