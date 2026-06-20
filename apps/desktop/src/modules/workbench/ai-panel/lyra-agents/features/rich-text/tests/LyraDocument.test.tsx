import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("falls back to plain text when no render snapshot is provided", () => {
    renderWithData(<LyraDocument content="fallback body" />);
    expect(screen.getByText("fallback body")).toBeTruthy();
  });

  it("renders collapsible details blocks", () => {
    renderWithData(
      <LyraDocument
        content=""
        document={{
          blocks: [
            {
              kind: "details",
              summary: [{ kind: "text", value: "点击展开" }],
              children: [
                {
                  kind: "paragraph",
                  children: [{ kind: "text", value: "折叠正文" }]
                }
              ]
            }
          ]
        }}
      />
    );

    expect(screen.getByText("点击展开")).toBeTruthy();
    expect(screen.getByText("折叠正文")).toBeTruthy();
    expect(document.querySelector(".lyra-agents-md-details")).not.toBeNull();
  });

  it("renders rust document blocks from agent snapshot", () => {
    renderWithData(
      <LyraDocument content="# Hello **world**" document={sampleDocument} />
    );

    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("world")).toBeTruthy();
    expect(screen.getByText(/let/)).toBeTruthy();
    expect(screen.getByText(/x = 1;/)).toBeTruthy();
  });

  it("reveals inline path targets instead of opening them as files", () => {
    const openFileInWorkbench = vi.fn().mockResolvedValue(undefined);
    const revealPathInWorkbench = vi.fn().mockResolvedValue(undefined);
    const data = createDataProviderValue({
      session,
      messages: [],
      openFileInWorkbench,
      revealPathInWorkbench
    });

    render(
      <DataContextProvider value={data}>
        <LyraDocument
          content=""
          document={{
            blocks: [
              {
                kind: "paragraph",
                children: [
                  { kind: "text", value: "Open " },
                  { kind: "code", value: "/tmp/project/src" }
                ]
              }
            ]
          }}
        />
      </DataContextProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "/tmp/project/src" }));

    expect(revealPathInWorkbench).toHaveBeenCalledWith("/tmp/project/src");
    expect(openFileInWorkbench).not.toHaveBeenCalled();
  });

  it("renders image alt text from the render snapshot", () => {
    renderWithData(
      <LyraDocument
        content=""
        document={{
          blocks: [
            {
              kind: "paragraph",
              children: [
                {
                  kind: "image",
                  src: "https://example.com/logo.png",
                  alt: "Alt text"
                }
              ]
            }
          ]
        }}
      />
    );

    expect(screen.getByRole("img", { name: "Alt text" })).toBeTruthy();
  });

  it("does not render clickable anchors for unsafe javascript links", () => {
    renderWithData(
      <LyraDocument
        content=""
        document={{
          blocks: [
            {
              kind: "paragraph",
              children: [
                {
                  kind: "link",
                  href: "javascript:alert(1)",
                  children: [{ kind: "text", value: "unsafe" }]
                }
              ]
            }
          ]
        }}
      />
    );

    expect(screen.getByText("unsafe")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "unsafe" })).toBeNull();
  });

  it("opens inline file path targets in the workbench editor", () => {
    const openFileInWorkbench = vi.fn().mockResolvedValue(undefined);
    const revealPathInWorkbench = vi.fn().mockResolvedValue(undefined);
    const data = createDataProviderValue({
      session,
      messages: [],
      openFileInWorkbench,
      revealPathInWorkbench
    });

    render(
      <DataContextProvider value={data}>
        <LyraDocument
          content=""
          document={{
            blocks: [
              {
                kind: "paragraph",
                children: [
                  { kind: "text", value: "Open " },
                  { kind: "code", value: "/tmp/project/src/App.tsx:42" }
                ]
              }
            ]
          }}
        />
      </DataContextProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "/tmp/project/src/App.tsx:42" }));

    expect(openFileInWorkbench).toHaveBeenCalledWith("/tmp/project/src/App.tsx:42");
    expect(revealPathInWorkbench).not.toHaveBeenCalled();
  });
});
