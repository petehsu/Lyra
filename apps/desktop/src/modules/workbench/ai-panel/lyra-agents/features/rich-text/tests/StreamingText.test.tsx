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
  it("renders streamdown content while streaming when rich mode is enabled", () => {
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
          messageId="test-msg-1"
        />
      </DataContextProvider>
    );

    expect(container.querySelector(".lyra-agents-rich-text")).not.toBeNull();
    expect(container.querySelector(".lyra-agents-streamdown")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Title" })).toBeTruthy();
    expect(container.textContent).toContain("Body");
  });

  it("renders math content while streaming", () => {
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
          messageId="test-msg-2"
        />
      </DataContextProvider>
    );

    // Math and mermaid are now rendered by streamdown plugins in both
    // streaming and final modes (unified renderer). The content should
    // be present in the DOM.
    expect(container.textContent).toContain("x^2");
  });

  it("shows partial fenced code before the closing fence arrives", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    const { container } = render(
      <DataContextProvider value={data}>
        <StreamingText content={"Here\n```ts\nconst x = 1"} streaming messageId="test-msg-3" />
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
        <StreamingText content={"# Title\n\nBody"} streaming messageId="test-msg-4" />
      </DataContextProvider>
    );

    expect(container.querySelector(".lyra-agents-rich-text")).toBeNull();
    expect(container.querySelector(".lyra-agents-streaming-text")).not.toBeNull();
    expect(container.querySelector(".lyra-agents-plain-text")).not.toBeNull();
    expect(screen.queryByText("Rendering…")).toBeNull();
  });

  it("uses the same streamdown renderer after streaming completes (no reflow)", () => {
    const data = createDataProviderValue({
      session,
      messages: [],
      aiRichRenderingEnabled: true
    });

    const view = render(
      <DataContextProvider value={data}>
        <StreamingText content={"# Done\n\nBody"} streaming messageId="test-msg-5" />
      </DataContextProvider>
    );

    // While streaming: streamdown renders the content.
    expect(screen.getByRole("heading", { name: "Done" })).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
    expect(view.container.querySelector(".lyra-agents-streamdown")).not.toBeNull();

    view.rerender(
      <DataContextProvider value={data}>
        <StreamingText content={"# Done\n\nBody"} streaming={false} messageId="test-msg-5" />
      </DataContextProvider>
    );

    // After streaming: still streamdown (unified renderer), no switch to
    // a different renderer. The streamdown class should persist.
    expect(view.container.querySelector(".lyra-agents-streamdown")).not.toBeNull();
    // The old markdown-it document class should NOT appear.
    expect(view.container.querySelector(".lyra-agents-markdown-document")).toBeNull();
    expect(screen.getByRole("heading", { name: "Done" })).toBeTruthy();
    expect(screen.getByText("Body")).toBeTruthy();
    expect(screen.queryByText("Rendering…")).toBeNull();
  });
});