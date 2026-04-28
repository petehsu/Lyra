import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, test, vi } from "vitest";

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

  test("renders a blinking modern caret and only blinks when idle", async () => {
    const props = createProps();
    const { container } = render(<AgentComposer {...props} />);
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;
    Object.defineProperty(input, "clientWidth", {
      configurable: true,
      value: 320
    });

    await act(async () => {
      input.focus();
      input.setSelectionRange(0, 0);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      const caret = container.querySelector(".lyra-modern-caret-composer");
      expect(caret).not.toBeNull();
      expect(caret).toHaveClass("lyra-modern-caret-focused");
      expect(caret).not.toHaveClass("lyra-modern-caret-blinking");
    });

    await waitFor(() => {
      const caret = container.querySelector(".lyra-modern-caret-composer");
      expect(caret).not.toBeNull();
      expect(caret).toHaveClass("lyra-modern-caret-blinking");
    }, { timeout: 900 });

    await act(async () => {
      input.setSelectionRange(5, 5);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    await waitFor(() => {
      const caret = container.querySelector(".lyra-modern-caret-composer");
      expect(caret).not.toBeNull();
      expect(caret).toHaveClass("lyra-modern-caret-bump");
      expect(caret).not.toHaveClass("lyra-modern-caret-blinking");
    });

    await waitFor(() => {
      expect(container.querySelector(".lyra-modern-caret-trail")).not.toBeNull();
      expect(container.querySelector(".lyra-modern-caret-echo")).not.toBeNull();
    });

    await act(async () => {
      fireEvent.change(input, {
        target: { value: "hello world!" }
      });
    });

    await waitFor(() => {
      expect(container.querySelector(".lyra-ai-agent-text-fx-insert")).not.toBeNull();
    });

    await act(async () => {
      fireEvent.change(input, {
        target: { value: "hello world" }
      });
    });

    await waitFor(() => {
      expect(container.querySelector(".lyra-ai-agent-text-fx-delete")).not.toBeNull();
    });

    await act(async () => {
      input.blur();
    });

    await waitFor(() => {
      expect(container.querySelector(".lyra-modern-caret-composer")).toBeNull();
    });
  });

  test("keeps the caret pressed during held navigation keys and restores on keyup", async () => {
    const props = createProps();
    const { container } = render(<AgentComposer {...props} />);
    const input = screen.getByLabelText("Ask Lyra") as HTMLTextAreaElement;
    Object.defineProperty(input, "clientWidth", {
      configurable: true,
      value: 320
    });

    await act(async () => {
      input.focus();
      input.setSelectionRange(0, 0);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      const caret = container.querySelector(".lyra-modern-caret-composer");
      expect(caret).not.toBeNull();
      expect(caret).toHaveClass("lyra-modern-caret-blinking");
    }, { timeout: 900 });

    await act(async () => {
      fireEvent.keyDown(input, {
        key: "ArrowRight",
        code: "ArrowRight"
      });
      input.setSelectionRange(1, 1);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      const caret = container.querySelector(".lyra-modern-caret-composer");
      expect(caret).not.toBeNull();
      expect(caret).toHaveClass("lyra-modern-caret-pressed");
      expect(caret).not.toHaveClass("lyra-modern-caret-blinking");
    });

    await waitFor(() => {
      expect(container.querySelector(".lyra-modern-caret-trail")).not.toBeNull();
    });

    await act(async () => {
      fireEvent.keyDown(input, {
        key: "ArrowRight",
        code: "ArrowRight",
        repeat: true
      });
      input.setSelectionRange(2, 2);
      document.dispatchEvent(new Event("selectionchange"));
    });

    await waitFor(() => {
      const caret = container.querySelector(".lyra-modern-caret-composer");
      expect(caret).not.toBeNull();
      expect(caret).toHaveClass("lyra-modern-caret-pressed");
      expect(caret).not.toHaveClass("lyra-modern-caret-blinking");
    });

    await act(async () => {
      fireEvent.keyUp(input, {
        key: "ArrowRight",
        code: "ArrowRight"
      });
    });

    await waitFor(() => {
      const caret = container.querySelector(".lyra-modern-caret-composer");
      expect(caret).not.toBeNull();
      expect(caret).not.toHaveClass("lyra-modern-caret-pressed");
    });
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

  test("renders permission modes outside the plus menu", () => {
    const onPermissionModeSelect = vi.fn();
    render(
      <AgentComposer
        {...createProps({
          permissionMode: "default",
          onPermissionModeSelect,
        })}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Auto review" }));
    expect(onPermissionModeSelect).toHaveBeenCalledWith("auto_review");
    expect(screen.getByRole("button", { name: "Default" })).toHaveClass("lyra-ai-agent-permission-mode-active");
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
