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

describe("StreamingText", () => {
  it("renders streamdown live content while streaming when rich mode is enabled", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    const { container } = render(
      <DataContextProvider value={data}>
        <StreamingText
          content={"# Title\n\nBody"}
          streaming
        />
      </DataContextProvider>
    );

    expect(container.querySelector(".lyra-agents-streaming-rich")).not.toBeNull();
    expect(container.querySelector(".lyra-agents-streamdown")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Title" })).toBeTruthy();
    expect(container.textContent).toContain("Body");
  });

  it("keeps math and mermaid as plain streaming content", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    const { container } = render(
      <DataContextProvider value={data}>
        <StreamingText
          content={"$x^2$\n\n```mermaid\nflowchart LR\n  A-->B"}
          streaming
        />
      </DataContextProvider>
    );

    expect(container.textContent).toContain("$x^2$");
    expect(container.textContent).toContain("flowchart LR");
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.querySelector(".lyra-markdown-mermaid")).toBeNull();
  });

  it("shows partial fenced code before the closing fence arrives", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    const { container } = render(
      <DataContextProvider value={data}>
        <StreamingText content={"Here\n```ts\nconst x = 1"} streaming />
      </DataContextProvider>
    );

    const codeBlock = container.querySelector('[data-streamdown="code-block"]');
    expect(codeBlock).not.toBeNull();
    expect(codeBlock?.getAttribute("data-language")).toBe("ts");
    expect(codeBlock?.textContent).toContain("const x = 1");
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

  it("renders markdown-it output after streaming completes", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    const view = render(
      <DataContextProvider value={data}>
        <StreamingText content={"# Done\n\nBody"} streaming />
      </DataContextProvider>
    );

    expect(screen.getByRole("heading", { name: "Done" })).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
    expect(view.container.querySelector(".lyra-agents-streamdown")).not.toBeNull();

    view.rerender(
      <DataContextProvider value={data}>
        <StreamingText content={"# Done\n\nBody"} streaming={false} />
      </DataContextProvider>
    );

    expect(view.container.querySelector(".lyra-agents-streamdown")).toBeNull();
    expect(view.container.querySelector(".lyra-agents-markdown-document")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Done" })).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.queryByText("Rendering…")).toBeNull();
  });
});
