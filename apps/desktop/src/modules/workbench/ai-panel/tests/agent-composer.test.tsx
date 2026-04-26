import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, test, vi } from "vitest";

import { AgentComposer } from "../agent-composer";

type AgentComposerProps = ComponentProps<typeof AgentComposer>;

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
      expect(onSend).toHaveBeenCalledWith("keep this draft");
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
});
