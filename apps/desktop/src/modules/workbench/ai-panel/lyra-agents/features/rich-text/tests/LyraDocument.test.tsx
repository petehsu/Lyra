import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SessionMeta } from "../../../core/types";
import type { LyraRenderDocument } from "../../../../../../../shared/render";
import { createDataProviderValue } from "../../../data/createDataProviderValue";
import { DataContextProvider } from "../../../data/DataProvider";
import { LyraDocument, PlainAgentText } from "../LyraDocument";

const session: SessionMeta = {
  title: "Test",
  project: "Lyra",
  workingDir: "/tmp",
  projectBound: true,
  workingDirIsHome: false,
  totalAdditions: 0,
  totalDeletions: 0
};

const sampleDocument: LyraRenderDocument = {
  blocks: [
    {
      kind: "paragraph",
      children: [
        { kind: "text", value: "Hello " },
        { kind: "strong", children: [{ kind: "text", value: "world" }] }
      ]
    },
    {
      kind: "codeBlock",
      language: "rust",
      source: "let x = 1;",
      spans: [{ start: 0, end: 3, scope: "keyword" }]
    }
  ]
};

const renderWithData = (
  ui: ReactNode,
  aiRichRenderingEnabled = true
) => {
  const data = createDataProviderValue({
    session,
    messages: [],
    aiRichRenderingEnabled
  });

  return render(
    <DataContextProvider value={data}>{ui}</DataContextProvider>
  );
};

describe("LyraDocument", () => {
  it("renders plain text when rich rendering is disabled", () => {
    const { container } = renderWithData(
      <PlainAgentText content={"line one\nline two"} />,
      false
    );
    expect(container.querySelector(".lyra-agents-plain-text")?.textContent).toBe(
      "line one\nline two"
    );
  });

  it("falls back to plain text when render bridge is unavailable", async () => {
    const original = window.lyraDesktop;
    Object.defineProperty(window, "lyraDesktop", {
      configurable: true,
      value: {}
    });

    renderWithData(<LyraDocument content="fallback body" />);

    await waitFor(() => {
      expect(screen.getByText("fallback body")).toBeTruthy();
    });

    Object.defineProperty(window, "lyraDesktop", {
      configurable: true,
      value: original
    });
  });

  it("renders rust document blocks from the native render bridge", async () => {
    const renderDocument = vi.fn(async () => sampleDocument);
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

    renderWithData(<LyraDocument content="# Hello **world**" />);

    await waitFor(() => {
      expect(renderDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "# Hello **world**",
          enableMath: true,
          enableMermaid: true,
          highlightCode: true
        })
      );
      expect(screen.getByText("Hello")).toBeTruthy();
      expect(screen.getByText("world")).toBeTruthy();
      expect(screen.getByText(/let/)).toBeTruthy();
      expect(screen.getByText(/x = 1;/)).toBeTruthy();
    });

    Object.defineProperty(window, "lyraDesktop", {
      configurable: true,
      value: original
    });
  });
});