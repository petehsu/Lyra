// @vitest-environment jsdom

import "../../../../renderer/test/setup";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { writeFileManagerEntryDragPayload } from "../../file-manager/drag-transfer";
import { AgentComposer } from "../agent-composer";

type AgentComposerProps = ComponentProps<typeof AgentComposer>;
type DataTransferLike = Pick<DataTransfer, "types" | "files" | "setData" | "getData" | "effectAllowed" | "dropEffect">;

const createDataTransferMock = (
  files: readonly File[] = []
): DataTransferLike => {
  const store = new Map<string, string>();
  const dataTransfer: DataTransferLike = {
    effectAllowed: "all",
    dropEffect: "none",
    files: files as unknown as FileList,
    get types() {
      return [
        ...Array.from(store.keys()),
        ...(files.length > 0 ? ["Files"] : []),
      ];
    },
    setData(format, value) {
      store.set(format, value);
    },
    getData(format) {
      return store.get(format) ?? "";
    },
  };
  return dataTransfer;
};

const createFileWithPath = (name: string, path: string): File => {
  const file = new File([""], name);
  Object.defineProperty(file, "path", {
    configurable: true,
    value: path,
  });
  return file;
};

const createProps = (overrides: Partial<AgentComposerProps> = {}): AgentComposerProps => ({
  locale: "en-US",
  currentThreadId: "thread-a",
  initialValue: "hello world",
  ariaLabel: "Ask Lyra",
  placeholder: "Ask Lyra",
  sendLabel: "Send",
  inputDisabled: false,
  sendDisabled: false,
  sending: false,
  onSend: vi.fn(async () => undefined),
  ...overrides
});

afterEach(() => {
  cleanup();
});

describe("agent composer", () => {
  test("keeps draft state local so parent does not rerender on typing", async () => {
    const props = createProps();
    let parentRenderCount = 0;
    const Harness = () => {
      parentRenderCount += 1;
      return <AgentComposer {...props} />;
    };

    render(<Harness />);
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;

    await act(async () => {
      input.focus();
      fireEvent.change(input, {
        target: { value: "hello world!" }
      });
    });

    expect(parentRenderCount).toBe(1);
  });

  test("does not report unchanged height again when the callback identity changes", async () => {
    const firstHeightChange = vi.fn();
    const secondHeightChange = vi.fn();
    const props = createProps({ onHeightChange: firstHeightChange });
    const { rerender } = render(<AgentComposer {...props} />);

    await waitFor(() => {
      expect(firstHeightChange).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      rerender(
        <AgentComposer
          {...props}
          onHeightChange={secondHeightChange}
        />
      );
    });

    expect(secondHeightChange).not.toHaveBeenCalled();
  });

  test("resyncs local draft when the thread or initial value changes", async () => {
    const props = createProps({ initialValue: "draft a" });
    const { rerender } = render(<AgentComposer {...props} />);
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, { target: { value: "edited draft" } });
    });
    expect(input.value).toBe("edited draft");

    rerender(
      <AgentComposer
        {...props}
        currentThreadId="thread-b"
        initialValue="draft b"
      />
    );

    expect(screen.getByLabelText("Ask Lyra")).toHaveValue("draft b");
  });

  test("restores the draft if send fails", async () => {
    const onSend = vi.fn(async () => {
      throw new Error("send failed");
    });
    const props = createProps({
      initialValue: "",
      onSend
    });

    render(<AgentComposer {...props} />);
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, {
        target: { value: "keep this draft" }
      });
    });

    await act(async () => {
      fireEvent.keyDown(input, {
        key: "Enter",
        code: "Enter"
      });
    });

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith({
        text: "keep this draft",
        attachments: [],
        parts: [{ type: "text", text: "keep this draft" }],
      });
      expect(screen.getByLabelText("Ask Lyra")).toHaveValue("keep this draft");
    });
  });

  test("moves plan and model controls into the plus menu", async () => {
    const onPlanModeToggle = vi.fn();
    const onModelSelect = vi.fn();
    render(
      <AgentComposer
        {...createProps({
          initialValue: "",
          modelOptions: [
            { value: "gpt-a", label: "GPT A" },
            { value: "gpt-b", label: "GPT B" },
          ],
          selectedModelName: "gpt-a",
          onModelSelect,
          onPlanModeToggle,
        })}
      />
    );

    fireEvent.click(screen.getByLabelText("Composer menu"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Plan mode/i }));
    expect(onPlanModeToggle).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("menuitem", { name: /Model/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /GPT B/i }));
    expect(onModelSelect).toHaveBeenCalledWith("gpt-b");
  });

  test("groups composer models under provider categories", async () => {
    const onModelSelect = vi.fn();
    render(
      <AgentComposer
        {...createProps({
          initialValue: "",
          modelOptions: [
            { value: "openai:gpt-a", label: "GPT A", providerId: "openai", providerLabel: "OpenAI" },
            { value: "anthropic:claude", label: "Claude", providerId: "anthropic", providerLabel: "Anthropic" },
          ],
          selectedModelName: "openai:gpt-a",
          onModelSelect,
        })}
      />
    );

    fireEvent.click(screen.getByLabelText("Composer menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Model/i }));

    expect(screen.getByRole("menuitem", { name: /OpenAI/i })).toBeDefined();
    expect(screen.getByRole("menuitem", { name: /Anthropic/i })).toBeDefined();
    expect(screen.getByRole("menuitemradio", { name: /GPT A/i })).toBeDefined();
    expect(screen.queryByRole("menuitemradio", { name: /Claude/i })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: /Anthropic/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Claude/i }));
    expect(onModelSelect).toHaveBeenCalledWith("anthropic:claude");
  });

  test("closes the portal plus menu on outside click and Escape", () => {
    render(<AgentComposer {...createProps({ initialValue: "" })} />);

    fireEvent.click(screen.getByLabelText("Composer menu"));
    expect(screen.getByRole("menu")).toBeDefined();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByLabelText("Composer menu"));
    expect(screen.getByRole("menu")).toBeDefined();
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("applies append requests once and appends later requests with spacing", () => {
    const props = createProps({
      initialValue: "",
      appendRequest: {
        id: 1,
        text: " first note "
      }
    });
    const { rerender } = render(<AgentComposer {...props} />);

    expect(screen.getByLabelText("Ask Lyra")).toHaveValue("first note");

    rerender(
      <AgentComposer
        {...props}
        appendRequest={{
          id: 1,
          text: "ignored"
        }}
      />
    );
    expect(screen.getByLabelText("Ask Lyra")).toHaveValue("first note");

    rerender(
      <AgentComposer
        {...props}
        appendRequest={{
          id: 2,
          text: "second note"
        }}
      />
    );
    expect(screen.getByLabelText("Ask Lyra")).toHaveValue("first note\n\nsecond note");
  });

  test("submits on Enter but preserves Shift+Enter", async () => {
    const onSend = vi.fn(async () => undefined);
    render(
      <AgentComposer
        {...createProps({
          initialValue: "",
          onSend
        })}
      />
    );
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;

    await act(async () => {
      fireEvent.change(input, {
        target: { value: "send this" }
      });
      fireEvent.keyDown(input, {
        key: "Enter",
        code: "Enter",
        shiftKey: true
      });
    });
    expect(onSend).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(input, {
        key: "Enter",
        code: "Enter"
      });
    });

    expect(onSend).toHaveBeenCalledWith({
      text: "send this",
      attachments: [],
      parts: [{ type: "text", text: "send this" }],
    });
  });

  test("routes steer and stop actions while sending", async () => {
    const onSteer = vi.fn(async () => undefined);
    render(
      <AgentComposer
        {...createProps({
          initialValue: "focus on tests",
          sending: true,
          onSteer,
          steerLabel: "Steer"
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Steer" }));

    await waitFor(() => {
      expect(onSteer).toHaveBeenCalledWith({
        text: "focus on tests",
        attachments: [],
        parts: [{ type: "text", text: "focus on tests" }],
      });
      expect(screen.getByLabelText("Ask Lyra")).toHaveValue("");
    });

    const onStop = vi.fn();
    render(
      <AgentComposer
        {...createProps({
          initialValue: "stop this",
          sending: true,
          onStop,
          stopDisabled: false
        })}
      />
    );

    fireEvent.click(screen.getAllByLabelText("Send")[1]!);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  test("adds selected files inline and sends mentions in text order", async () => {
    const onSend = vi.fn(async () => undefined);
    const onRequestFileAttachments = vi.fn(async () => [
      {
        id: "system-picker:file:/workspace/README.md",
        name: "README.md",
        path: "/workspace/README.md",
        kind: "file" as const,
        source: "system-picker" as const,
      },
    ]);
    render(
      <AgentComposer
        {...createProps({
          initialValue: "",
          onSend,
          onRequestFileAttachments,
        })}
      />
    );

    fireEvent.click(screen.getByLabelText("Composer menu"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Add file" }));
    });

    expect(await screen.findByText("README.md")).toBeDefined();
    expect(screen.getByLabelText("Ask Lyra")).toHaveValue("[[file:README.md]]");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send"));
    });

    expect(onSend).toHaveBeenCalledWith({
      text: "",
      attachments: [
        {
          id: "system-picker:file:/workspace/README.md",
          name: "README.md",
          path: "/workspace/README.md",
          kind: "file",
          source: "system-picker",
        },
      ],
      parts: [
        {
          type: "attachment",
          attachment: {
            id: "system-picker:file:/workspace/README.md",
            name: "README.md",
            path: "/workspace/README.md",
            kind: "file",
            source: "system-picker",
          },
        },
      ],
    });
  });

  test("inserts selected files at the textarea cursor", async () => {
    const onSend = vi.fn(async () => undefined);
    const onRequestFileAttachments = vi.fn(async () => [
      {
        id: "system-picker:file:/workspace/README.md",
        name: "README.md",
        path: "/workspace/README.md",
        kind: "file" as const,
        source: "system-picker" as const,
      },
    ]);
    render(
      <AgentComposer
        {...createProps({
          initialValue: "你看一下 是什么？",
          onSend,
          onRequestFileAttachments,
        })}
      />
    );
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;
    await act(async () => {
      input.focus();
      input.setSelectionRange("你看一下 ".length, "你看一下 ".length);
      document.dispatchEvent(new Event("selectionchange"));
    });

    fireEvent.click(screen.getByLabelText("Composer menu"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Add file" }));
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          resolve();
        });
      });
    });

    expect(input.value).toBe("你看一下 [[file:README.md]] 是什么？");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send"));
    });

    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({
      parts: [
        { type: "text", text: "你看一下 " },
        {
          type: "attachment",
          attachment: {
            id: "system-picker:file:/workspace/README.md",
            name: "README.md",
            path: "/workspace/README.md",
            kind: "file",
            source: "system-picker",
          },
        },
        { type: "text", text: " 是什么？" },
      ],
    }));
  });

  test("starts fuzzy file mention search and inserts the selected result inline", async () => {
    const onSend = vi.fn(async () => undefined);
    const onFileMentionSearchStart = vi.fn();
    const onFileMentionSearchUpdate = vi.fn();
    const onFileMentionSearchStop = vi.fn();
    render(
      <AgentComposer
        {...createProps({
          initialValue: "",
          onSend,
          fileMentionSearchRoots: ["/workspace"],
          fileMentionSearchResults: [
            {
              id: "readme",
              name: "README.md",
              path: "/workspace/README.md",
              kind: "file",
            },
          ],
          onFileMentionSearchStart,
          onFileMentionSearchUpdate,
          onFileMentionSearchStop,
        })}
      />
    );
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;

    await act(async () => {
      input.focus();
      fireEvent.change(input, { target: { value: "open @read" } });
      input.setSelectionRange("open @read".length, "open @read".length);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      expect(onFileMentionSearchStart).toHaveBeenCalledWith(expect.any(String), ["/workspace"]);
      expect(onFileMentionSearchUpdate).toHaveBeenCalledWith(expect.any(String), "read");
      expect(screen.getByRole("option", { name: /README\.md/i })).toBeDefined();
    });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    });

    expect(input.value).toBe("open [[file:README.md]]");
    expect(onFileMentionSearchStop).toHaveBeenCalledWith(expect.any(String));

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send"));
    });

    expect(onSend).toHaveBeenCalledWith({
      text: "open",
      attachments: [
        {
          id: "fuzzy-mention:file:/workspace/README.md",
          name: "README.md",
          path: "/workspace/README.md",
          kind: "file",
          source: "fuzzy-mention",
        },
      ],
      parts: [
        { type: "text", text: "open " },
        {
          type: "attachment",
          attachment: {
            id: "fuzzy-mention:file:/workspace/README.md",
            name: "README.md",
            path: "/workspace/README.md",
            kind: "file",
            source: "fuzzy-mention",
          },
        },
      ],
    });
  });

  test("opens the mention panel for a bare at sign and keeps Enter from sending empty matches", async () => {
    const onSend = vi.fn(async () => undefined);
    const onFileMentionSearchStart = vi.fn();
    const onFileMentionSearchUpdate = vi.fn();
    render(
      <AgentComposer
        {...createProps({
          initialValue: "",
          onSend,
          fileMentionSearchRoots: ["/workspace"],
          fileMentionSearchResults: [],
          onFileMentionSearchStart,
          onFileMentionSearchUpdate,
        })}
      />
    );
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;

    await act(async () => {
      input.focus();
      fireEvent.change(input, { target: { value: "@" } });
      input.setSelectionRange(1, 1);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      expect(onFileMentionSearchStart).toHaveBeenCalledWith(expect.any(String), ["/workspace"]);
      expect(onFileMentionSearchUpdate).toHaveBeenCalledWith(expect.any(String), "");
      expect(screen.getByRole("listbox", { name: "Mentions" })).toBeDefined();
      expect(screen.getByText("No matches")).toBeDefined();
    });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    });

    expect(onSend).not.toHaveBeenCalled();
  });

  test("renders all mention results inside the scrollable panel", async () => {
    const results = Array.from({ length: 12 }, (_, index) => ({
      id: `file-${String(index)}`,
      name: `file-${String(index)}.ts`,
      path: `/workspace/file-${String(index)}.ts`,
      kind: "file" as const,
    }));
    render(
      <AgentComposer
        {...createProps({
          initialValue: "",
          fileMentionSearchRoots: ["/workspace"],
          fileMentionSearchResults: results,
          onFileMentionSearchStart: vi.fn(),
          onFileMentionSearchUpdate: vi.fn(),
        })}
      />
    );
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;

    await act(async () => {
      input.focus();
      fireEvent.change(input, { target: { value: "@file" } });
      input.setSelectionRange("@file".length, "@file".length);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /file-0\.ts/i })).toBeDefined();
      expect(screen.getByRole("option", { name: /file-11\.ts/i })).toBeDefined();
    });
  });

  test("selects workbench tab mentions without a file search root and sends context text", async () => {
    const onSend = vi.fn(async () => undefined);
    const onFileMentionSearchStart = vi.fn();
    render(
      <AgentComposer
        {...createProps({
          initialValue: "",
          onSend,
          fileMentionSearchRoots: [],
          workbenchTabMentions: [
            {
              tabId: "tab-1",
              title: "Docs",
              kind: "page",
              active: true,
              visible: true,
              address: "https://example.test/docs",
            },
          ],
          onFileMentionSearchStart,
        })}
      />
    );
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;

    await act(async () => {
      input.focus();
      fireEvent.change(input, { target: { value: "read @doc" } });
      input.setSelectionRange("read @doc".length, "read @doc".length);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Docs/i })).toBeDefined();
    });
    expect(onFileMentionSearchStart).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    });

    expect(input.value).toBe("read [[workbench_tab:Docs]]");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send"));
    });

    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [
        expect.objectContaining({
          name: "Docs",
          path: "app://workbench/tab/tab-1",
          kind: "workbench_tab",
          source: "mention-panel",
          contextText: expect.stringContaining("Address: https://example.test/docs"),
        }),
      ],
      parts: [
        { type: "text", text: "read " },
        {
          type: "attachment",
          attachment: expect.objectContaining({
            name: "Docs",
            path: "app://workbench/tab/tab-1",
            kind: "workbench_tab",
            contextText: expect.stringContaining("workbench.tab.read"),
          }),
        },
      ],
    }));
  });

  test("prioritizes fuzzy file matches over tab mentions for filename queries", async () => {
    render(
      <AgentComposer
        {...createProps({
          initialValue: "",
          fileMentionSearchRoots: ["/workspace"],
          fileMentionSearchResults: [
            {
              id: "main-ts",
              name: "main.ts",
              path: "/workspace/src/main.ts",
              kind: "file",
              score: 950,
            },
          ],
          workbenchTabMentions: [
            {
              tabId: "tab-1",
              title: "Main docs",
              kind: "page",
              active: false,
              visible: true,
              address: "https://example.test/main",
            },
          ],
          onFileMentionSearchStart: vi.fn(),
          onFileMentionSearchUpdate: vi.fn(),
        })}
      />
    );
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;

    await act(async () => {
      input.focus();
      fireEvent.change(input, { target: { value: "@main" } });
      input.setSelectionRange("@main".length, "@main".length);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options[0]?.textContent).toContain("main.ts");
    });

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    });

    expect(input.value).toBe("[[file:main.ts]]");
  });

  test("shows file mention paths relative to the search root", async () => {
    render(
      <AgentComposer
        {...createProps({
          initialValue: "",
          fileMentionSearchRoots: ["/Users/petehsu/Documents/Lyra"],
          fileMentionSearchResults: [
            {
              id: "main-ts",
              name: "main.ts",
              path: "/Users/petehsu/Documents/Lyra/apps/desktop/src/main.ts",
              root: "/Users/petehsu/Documents/Lyra",
              kind: "file",
            },
          ],
          onFileMentionSearchStart: vi.fn(),
          onFileMentionSearchUpdate: vi.fn(),
        })}
      />
    );
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;

    await act(async () => {
      input.focus();
      fireEvent.change(input, { target: { value: "@main" } });
      input.setSelectionRange("@main".length, "@main".length);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      const option = screen.getByRole("option", { name: /main\.ts/i });
      expect(option.textContent).toContain("apps/desktop/src/main.ts");
      expect(option.textContent).not.toContain("/Users/petehsu/Documents/Lyra");
    });
  });

  test("keeps the full file mention path when the query matches the hidden prefix", async () => {
    render(
      <AgentComposer
        {...createProps({
          initialValue: "",
          fileMentionSearchRoots: ["/Users/petehsu/Documents/Lyra"],
          fileMentionSearchResults: [
            {
              id: "main-ts",
              name: "main.ts",
              path: "/Users/petehsu/Documents/Lyra/apps/desktop/src/main.ts",
              root: "/Users/petehsu/Documents/Lyra",
              kind: "file",
            },
          ],
          onFileMentionSearchStart: vi.fn(),
          onFileMentionSearchUpdate: vi.fn(),
        })}
      />
    );
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;

    await act(async () => {
      input.focus();
      fireEvent.change(input, { target: { value: "@petehsu" } });
      input.setSelectionRange("@petehsu".length, "@petehsu".length);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      const option = screen.getByRole("option", { name: /main\.ts/i });
      expect(option.textContent).toContain("/Users/petehsu/Documents/Lyra/apps/desktop/src/main.ts");
    });
  });

  test("turns matching open file tabs into local file mention candidates", async () => {
    const onSend = vi.fn(async () => undefined);
    const onFileMentionSearchStart = vi.fn();
    render(
      <AgentComposer
        {...createProps({
          initialValue: "",
          onSend,
          fileMentionSearchRoots: [],
          workbenchTabMentions: [
            {
              tabId: "tab-1",
              title: "Composer View",
              kind: "app",
              active: true,
              visible: true,
              filePath: "/workspace/src/agent-composer-view.tsx",
            },
          ],
          onFileMentionSearchStart,
        })}
      />
    );
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;

    await act(async () => {
      input.focus();
      fireEvent.change(input, { target: { value: "read @acv" } });
      input.setSelectionRange("read @acv".length, "read @acv".length);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options[0]?.textContent).toContain("agent-composer-view.tsx");
    });
    expect(onFileMentionSearchStart).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    });

    expect(input.value).toBe("read [[file:agent-composer-view.tsx]]");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send"));
    });

    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [
        expect.objectContaining({
          name: "agent-composer-view.tsx",
          path: "/workspace/src/agent-composer-view.tsx",
          kind: "file",
          source: "fuzzy-mention",
        }),
      ],
    }));
  });

  test("renders favicon and file type icons in mention results", async () => {
    render(
      <AgentComposer
        {...createProps({
          initialValue: "",
          fileMentionSearchRoots: ["/workspace"],
          fileMentionSearchResults: [
            {
              id: "package-json",
              name: "package.json",
              path: "/workspace/package.json",
              kind: "file",
            },
          ],
          workbenchTabMentions: [
            {
              tabId: "tab-1",
              title: "Package docs",
              kind: "page",
              active: true,
              visible: true,
              address: "https://example.test/package",
              faviconUrl: "https://example.test/favicon.ico",
            },
          ],
          onFileMentionSearchStart: vi.fn(),
          onFileMentionSearchUpdate: vi.fn(),
        })}
      />
    );
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;

    await act(async () => {
      input.focus();
      fireEvent.change(input, { target: { value: "@" } });
      input.setSelectionRange(1, 1);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      expect(document.body.querySelector(".lyra-ai-agent-composer-mention-favicon")).not.toBeNull();
      expect(document.body.querySelector(".lyra-ai-agent-composer-mention-file-icon")).not.toBeNull();
    });
    expect(
      document.body.querySelector<HTMLImageElement>(".lyra-ai-agent-composer-mention-favicon")?.src
    ).toBe("https://example.test/favicon.ico");
  });

  test("treats inline attachment chips as atomic keyboard tokens", async () => {
    const onRequestFileAttachments = vi.fn(async () => [
      {
        id: "system-picker:file:/workspace/README.md",
        name: "README.md",
        path: "/workspace/README.md",
        kind: "file" as const,
        source: "system-picker" as const,
      },
    ]);
    render(
      <AgentComposer
        {...createProps({
          initialValue: "before after",
          onRequestFileAttachments,
        })}
      />
    );
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;
    const insertAt = "before ".length;
    await act(async () => {
      input.focus();
      input.setSelectionRange(insertAt, insertAt);
      document.dispatchEvent(new Event("selectionchange"));
    });

    fireEvent.click(screen.getByLabelText("Composer menu"));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Add file" }));
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => {
          resolve();
        });
      });
    });

    const placeholder = "[[file:README.md]]";
    const placeholderStart = input.value.indexOf(placeholder);
    const placeholderEnd = placeholderStart + placeholder.length;
    input.setSelectionRange(placeholderStart, placeholderStart);
    fireEvent.keyDown(input, { key: "ArrowRight", code: "ArrowRight" });
    expect(input.selectionStart).toBe(placeholderEnd);

    fireEvent.keyDown(input, { key: "ArrowLeft", code: "ArrowLeft" });
    expect(input.selectionStart).toBe(placeholderStart);

    input.setSelectionRange(placeholderEnd, placeholderEnd);
    fireEvent.keyDown(input, { key: "Backspace", code: "Backspace" });
    expect(input.value).not.toContain(placeholder);
    expect(screen.queryByText("README.md")).toBeNull();
  });

  test("turns file manager drops into inline chips instead of raw path text", async () => {
    const props = createProps({ initialValue: "" });
    const { container } = render(<AgentComposer {...props} />);
    const dataTransfer = createDataTransferMock();
    writeFileManagerEntryDragPayload(dataTransfer as DataTransfer, {
      name: "client.ts",
      kind: "file",
      source: "directory",
      path: "/workspace/src/client.ts",
    });

    await act(async () => {
      fireEvent.drop(
        container.querySelector(".lyra-ai-agent-composer-input-shell")!,
        { dataTransfer }
      );
    });

    expect(screen.getByText("client.ts")).toBeDefined();
    expect(screen.getByLabelText("Ask Lyra")).toHaveValue("[[file:client.ts]]");
  });

  test("turns pasted system files into inline attachment chips", async () => {
    const props = createProps({ initialValue: "" });
    render(<AgentComposer {...props} />);
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;
    const file = createFileWithPath("notes.md", "/Users/petehsu/notes.md");

    await act(async () => {
      fireEvent.paste(input, {
        clipboardData: createDataTransferMock([file]),
      });
    });

    expect(screen.getByText("notes.md")).toBeDefined();
    expect(input.value).toBe("[[file:notes.md]]");
  });

  test("turns pasted absolute file paths into inline attachment chips", async () => {
    const props = createProps({ initialValue: "" });
    render(<AgentComposer {...props} />);
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;
    const clipboardData = createDataTransferMock();
    clipboardData.setData("text/plain", "/Users/petehsu/Documents/Lyra/package.json");

    await act(async () => {
      fireEvent.paste(input, { clipboardData });
    });

    expect(screen.getByText("package.json")).toBeDefined();
    expect(input.value).toBe("[[file:package.json]]");
  });

  test("turns pasted image references into image attachment chips", async () => {
    const onSend = vi.fn(async () => undefined);
    render(<AgentComposer {...createProps({ initialValue: "inspect ", onSend })} />);
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;
    const clipboardData = createDataTransferMock();
    clipboardData.setData("text/plain", "https://example.test/screenshot.png");

    await act(async () => {
      input.focus();
      input.setSelectionRange("inspect ".length, "inspect ".length);
      fireEvent.paste(input, { clipboardData });
    });

    expect(screen.getByText("screenshot.png")).toBeDefined();
    expect(input.value).toBe("inspect [[image:screenshot.png]]");

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send"));
    });

    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({
      parts: [
        { type: "text", text: "inspect " },
        {
          type: "attachment",
          attachment: {
            id: "clipboard:image:https://example.test/screenshot.png",
            name: "screenshot.png",
            path: "https://example.test/screenshot.png",
            kind: "image",
            source: "clipboard",
          },
        },
      ],
    }));
  });

  test("closes the plus menu from outside click and Escape", () => {
    render(
      <AgentComposer
        {...createProps({
          initialValue: "",
          onPlanModeToggle: vi.fn()
        })}
      />
    );

    fireEvent.click(screen.getByLabelText("Composer menu"));
    expect(screen.getByRole("menuitemcheckbox", { name: /Plan mode/i })).toBeDefined();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menuitemcheckbox", { name: /Plan mode/i })).toBeNull();

    fireEvent.click(screen.getByLabelText("Composer menu"));
    expect(screen.getByRole("menuitemcheckbox", { name: /Plan mode/i })).toBeDefined();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menuitemcheckbox", { name: /Plan mode/i })).toBeNull();
  });

  test("toggles follow and enables it for command-enter send", async () => {
    const onFollowToggle = vi.fn();
    const onSendWithFollow = vi.fn();
    const onSend = vi.fn(async () => undefined);
    render(
      <AgentComposer
        {...createProps({
          initialValue: "inspect file",
          followLabel: "Follow Agent",
          followEnabled: true,
          onFollowToggle,
          onSendWithFollow,
          onSend,
        })}
      />
    );
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;
    const followButton = screen.getByLabelText("Follow Agent");

    expect(followButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(followButton);
    expect(onFollowToggle).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.keyDown(input, {
        key: "Enter",
        code: "Enter",
        metaKey: true,
      });
    });

    expect(onSendWithFollow).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({
      text: "inspect file",
    }));
  });
});
