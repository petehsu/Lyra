import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { ChatMessage, SessionMeta } from "../../../core/types";
import { setLocale } from "@workbench/i18n";
import { createDataProviderValue } from "../../../data/createDataProviderValue";
import { DataContextProvider } from "../../../data/DataProvider";
import { Message } from "../Message";
import { collectChangedFiles, splitDisplayPath } from "../changed-files";

const session: SessionMeta = {
  title: "New session",
  project: "Lyra",
  workingDir: "/Users/petehsu/Documents/Lyra",
  projectBound: true,
  workingDirIsHome: false,
  totalAdditions: 0,
  totalDeletions: 0
};

const editCall = (
  id: string,
  file: string,
  additions: number,
  deletions: number
): ChatMessage["blocks"][number] => ({
  type: "tools",
  id: `tools-${id}`,
  group: {
    id: `group-${id}`,
    status: "done",
    label: "Agent 活动",
    calls: [
      {
        id,
        kind: "edit",
        title: file,
        status: "success",
        details: {
          type: "edit",
          file,
          additions,
          deletions,
          hunks: [
            {
              startLine: 1,
              lines: [{ kind: "add", text: "new line" }]
            }
          ]
        }
      }
    ]
  }
});

const messageWithEdits = (blocks: ChatMessage["blocks"]): ChatMessage => ({
  id: "agent-1",
  author: "agent",
  blocks,
  time: "23:10"
});

describe("collectChangedFiles", () => {
  test("keeps the last edit for a repeated path", () => {
    const files = collectChangedFiles(
      messageWithEdits([
        editCall("a", "src/opencode.rs", 10, 1),
        editCall("b", "src/state.rs", 2, 3),
        editCall("c", "src/opencode.rs", 272, 3)
      ])
    );
    expect(files).toEqual([
      expect.objectContaining({ file: "src/opencode.rs", additions: 272, deletions: 3 }),
      expect.objectContaining({ file: "src/state.rs", additions: 2, deletions: 3 })
    ]);
  });

  test("splits directory and filename", () => {
    expect(splitDisplayPath("apps/desktop/src/renderer/ui/components/app-tabs.tsx")).toEqual({
      directory: "apps/desktop/src/renderer/ui/components/",
      filename: "app-tabs.tsx"
    });
    expect(splitDisplayPath("opencode.rs")).toEqual({
      directory: "",
      filename: "opencode.rs"
    });
  });
});

describe("ChangedFilesCard in Message", () => {
  test("shows the turn summary after tools finish", () => {
    setLocale("en-US");
    const data = createDataProviderValue({
      session,
      messages: [
        messageWithEdits([
          { type: "text", id: "summary-1", body: "Done." },
          editCall("a", "src/opencode.rs", 272, 3),
          editCall("b", "src/state.rs", 37, 108)
        ])
      ]
    });
    render(
      <DataContextProvider value={data}>
        <Message message={data.messages[0]!} />
      </DataContextProvider>
    );

    expect(screen.getByText("2 Changed files")).toBeInTheDocument();
    expect(screen.getByText("+309")).toBeInTheDocument();
    expect(screen.getByText("-111")).toBeInTheDocument();
    expect(screen.getByText("opencode.rs")).toBeInTheDocument();
    expect(screen.queryByText("new line")).not.toBeInTheDocument();

    const summary = screen.getByText("2 Changed files").closest(".lyra-agents-changed-files");
    expect(summary).not.toBeNull();
    expect(summary!.querySelector(".lyra-agents-changed-files-icon svg")).not.toBeNull();
    fireEvent.click(summary!.querySelector(".lyra-agents-changed-files-row")!);
    expect(summary!.querySelector(".lyra-agents-changed-files-item.open")).not.toBeNull();
    expect(summary!.querySelector(".lyra-agents-changed-files-diff")).not.toBeNull();
  });

  test("hides the summary until the turn finishes", () => {
    setLocale("en-US");
    const done = messageWithEdits([
      { type: "text", id: "summary-1", body: "Done." },
      editCall("a", "src/opencode.rs", 272, 3)
    ]);
    const data = createDataProviderValue({
      session,
      messages: [done],
      isTurnRunning: true
    });
    render(
      <DataContextProvider value={data}>
        <Message message={done} showActivityIndicator />
      </DataContextProvider>
    );
    expect(screen.queryByText("1 Changed file")).not.toBeInTheDocument();
  });

  test("keeps earlier turn summaries visible while a later turn is running", () => {
    setLocale("en-US");
    const previous = messageWithEdits([
      { type: "text", id: "summary-1", body: "Done." },
      editCall("a", "src/opencode.rs", 272, 3)
    ]);
    const data = createDataProviderValue({
      session,
      messages: [previous],
      isTurnRunning: true
    });
    render(
      <DataContextProvider value={data}>
        <Message message={previous} showActivityIndicator={false} />
      </DataContextProvider>
    );
    expect(screen.getByText("1 Changed file")).toBeInTheDocument();
  });

  test("hides the summary while a tool group is still running", () => {
    setLocale("en-US");
    const running = messageWithEdits([
      {
        type: "tools",
        id: "tools-live",
        group: {
          id: "group-live",
          status: "running",
          label: "Agent 活动",
          calls: [
            {
              id: "live",
              kind: "edit",
              title: "src/opencode.rs",
              status: "running",
              details: {
                type: "edit",
                file: "src/opencode.rs",
                additions: 2,
                deletions: 0,
                hunks: []
              }
            }
          ]
        }
      }
    ]);
    const data = createDataProviderValue({
      session,
      messages: [running],
      isTurnRunning: true
    });
    render(
      <DataContextProvider value={data}>
        <Message message={running} showActivityIndicator />
      </DataContextProvider>
    );
    expect(screen.queryByText("1 Changed file")).not.toBeInTheDocument();
  });
});
