import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

describe("StreamingText", () => {
  it("renders live LyraDocument while streaming when rich mode is enabled", async () => {
    const renderDocument = vi.fn(async () => ({
      blocks: [
        {
          kind: "heading",
          level: 1,
          children: [{ kind: "text", value: "Title" }]
        },
        {
          kind: "paragraph",
          children: [{ kind: "text", value: "Body" }]
        }
      ]
    }));
    const original = window.lyraDesktop;
    Object.defineProperty(window, "lyraDesktop", {
      configurable: true,
      value: {
        render: {
          renderDocument,
          highlightSpans: vi.fn(),
          invalidateCache: vi.fn()
        }
      }
    });

    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    const { container } = render(
      <DataContextProvider value={data}>
        <StreamingText content={"# Title\n\nBody"} streaming />
      </DataContextProvider>
    );

    expect(container.querySelector(".lyra-agents-streaming-rich")).not.toBeNull();
    expect(container.querySelector(".lyra-agents-streaming-cursor")).not.toBeNull();
    expect(await screen.findByRole("heading", { level: 1, name: "Title" })).toBeTruthy();
    expect(renderDocument).toHaveBeenCalled();

    Object.defineProperty(window, "lyraDesktop", {
      configurable: true,
      value: original
    });
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

  it("renders LyraDocument after streaming completes", async () => {
    const renderDocument = vi.fn(async () => ({
      blocks: [
        {
          kind: "paragraph",
          children: [{ kind: "text", value: "Done" }]
        }
      ]
    }));
    const original = window.lyraDesktop;
    Object.defineProperty(window, "lyraDesktop", {
      configurable: true,
      value: {
        render: {
          renderDocument,
          highlightSpans: vi.fn(),
          invalidateCache: vi.fn()
        }
      }
    });

    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    render(
      <DataContextProvider value={data}>
        <StreamingText content="Done" streaming={false} />
      </DataContextProvider>
    );

    expect(await screen.findByText("Done")).toBeTruthy();
    expect(renderDocument).toHaveBeenCalled();

    Object.defineProperty(window, "lyraDesktop", {
      configurable: true,
      value: original
    });
  });
});