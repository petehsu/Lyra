import { expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { t } from "@workbench/i18n";
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

test("creates a new session from the header button without mode choices", () => {
  const createSession = vi.fn(async () => undefined);
  const data = createDataProviderValue({
    session,
    messages: [],
    createSession
  });
  render(
    <DataContextProvider value={data}>
      <HeaderControls forceShowNewSessionButton />
    </DataContextProvider>
  );

  fireEvent.click(screen.getByRole("button", { name: t("header.newSession") }));
  expect(createSession).toHaveBeenCalledTimes(1);
});
