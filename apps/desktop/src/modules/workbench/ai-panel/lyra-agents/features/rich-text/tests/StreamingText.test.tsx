import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SessionMeta } from "../../../core/types";
import { createDataProviderValue } from "../../../data/createDataProviderValue";
import { DataContextProvider } from "../../../data/DataProvider";
import { StreamingText } from "../StreamingText";

const session: SessionMeta = {
  title: "Test",
  project: "Lyra",
  workingDir: "/tmp",
  projectBound: true,
  workingDirIsHome: false,
  totalAdditions: 0,
  totalDeletions: 0
};

const sampleDocument = {
  blocks: [
    {
      kind: "heading" as const,
      level: 1,
      children: [{ kind: "text" as const, value: "Title" }]
    },
    {
      kind: "paragraph" as const,
      children: [{ kind: "text" as const, value: "Body" }]
    }
  ]
};

describe("StreamingText", () => {
  it("renders live LyraDocument while streaming when rich mode is enabled", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    const { container } = render(
      <DataContextProvider value={data}>
        <StreamingText
          content={"# Title\n\nBody"}
          document={sampleDocument}
          streaming
        />
      </DataContextProvider>
    );

    expect(container.querySelector(".lyra-agents-streaming-rich")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Title" })).toBeTruthy();
  });

  it("keeps plain typewriter output while streaming when rich mode is disabled", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: false
    });

    const { container } = render(
      <DataContextProvider value={data}>
        <StreamingText content={"# Title\n\nBody"} streaming />
      </DataContextProvider>
    );

    expect(container.querySelector(".lyra-agents-rich-text")).toBeNull();
    expect(container.querySelector(".lyra-agents-streaming-text")).not.toBeNull();
    expect(container.querySelector(".lyra-agents-plain-text")).not.toBeNull();
    expect(screen.queryByText("Rendering…")).toBeNull();
  });

  it("renders the same snapshot after streaming completes", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    const view = render(
      <DataContextProvider value={data}>
        <StreamingText content="Done" document={sampleDocument} streaming />
      </DataContextProvider>
    );

    expect(screen.getByText("Body")).toBeTruthy();

    view.rerender(
      <DataContextProvider value={data}>
        <StreamingText content="Done" document={sampleDocument} streaming={false} />
      </DataContextProvider>
    );

    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.queryByText("Rendering…")).toBeNull();
  });
});