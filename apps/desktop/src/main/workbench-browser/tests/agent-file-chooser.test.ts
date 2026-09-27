import { expect, test, vi } from "vitest";
import { createBrowserFileChooserController } from "../view-manager-runtime/agent-file-chooser";

// Failure cleanup is observable: subsequent human clicks must reach Chromium's
// normal picker, and a late agent continuation must not launch a native dialog.
test("expired input lease restores dialogs and blocks late activation", async () => {
  vi.useFakeTimers();
  const sendCommand = vi.fn(async () => ({}));
  const close = vi.fn(async () => {});
  const files = createBrowserFileChooserController({
    resolveBrowserAgentTarget: async () => ({}),
    openDebuggerSessionForTarget: async () => ({ sendCommand, close, subscribe: () => () => {} }),
    assertSharedControlCanContinue: () => {}, setPending: () => {}, click: vi.fn(), observe: vi.fn()
  } as never);
  let activate = () => {};
  const activation = vi.fn();
  try {
    const finished = files.capture("tab", {}, async () => {
      await new Promise<void>(resolve => { activate = resolve; });
      files.assertInputAllowed(); activation(); return {};
    });
    const rejected = expect(finished).rejects.toMatchObject({ kind: "inputScopeExpired" });
    await vi.advanceTimersByTimeAsync(8_001);
    expect(sendCommand).toHaveBeenLastCalledWith("Page.setInterceptFileChooserDialog", { enabled: false }, undefined);
    activate(); await rejected;
    expect(activation).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
  } finally { files.dispose(); vi.useRealTimers(); }
});
