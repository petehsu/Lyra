import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import * as clipboard from "../../../../../../../shared/clipboard";
import { setLocale } from "@workbench/i18n";
import type { ChatMessage, SessionMeta } from "../../../core/types";
import { createDataProviderValue } from "../../../data/createDataProviderValue";
import { DataContextProvider } from "../../../data/DataProvider";
import { Message } from "../Message";

const session: SessionMeta = {
  title: "New session",
  project: "Lyra",
  workingDir: "/Users/petehsu/Documents/Lyra",
  projectBound: true,
  workingDirIsHome: false,
  totalAdditions: 0,
  totalDeletions: 0
};

const makeMessage = (author: "user" | "agent"): ChatMessage => ({
  id: `${author}-message`,
  author,
  blocks: [
    { type: "text", id: "text-1", body: "First paragraph" },
    { type: "text", id: "text-2", body: "Second paragraph" }
  ],
  time: "10:30"
});

const renderMessage = (message: ChatMessage) => {
  const data = createDataProviderValue({
    session,
    messages: [message],
    isTurnRunning: false
  });
  return render(
    <DataContextProvider value={data}>
      <Message
        message={message}
        showActivityIndicator={false}
        activityIndicatorMessage={message}
      />
    </DataContextProvider>
  );
};

beforeEach(() => {
  setLocale("en-US");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(["user", "agent"] as const)("%s message copy feedback", (author) => {
  test("shows a check after copying succeeds", async () => {
    const writeClipboardText = vi
      .spyOn(clipboard, "writeClipboardText")
      .mockResolvedValue(true);
    renderMessage(makeMessage(author));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    });

    expect(writeClipboardText).toHaveBeenCalledWith(
      "First paragraph\n\nSecond paragraph"
    );
    expect(
      screen.getByRole("button", { name: "Copied" }).querySelector("svg")
    ).toHaveClass("lucide-check");
  });
});

test("keeps the copy icon when copying fails", async () => {
  vi.spyOn(clipboard, "writeClipboardText").mockResolvedValue(false);
  renderMessage(makeMessage("agent"));

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
  });

  expect(screen.queryByRole("button", { name: "Copied" })).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Copy message" }).querySelector("svg")
  ).toHaveClass("lucide-copy");
});
