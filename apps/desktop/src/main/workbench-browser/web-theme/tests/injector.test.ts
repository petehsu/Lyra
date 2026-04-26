import { describe, expect, test, vi } from "vitest";

import { createWebThemeInjector } from "../injector";
import { buildWebThemeSnapshot } from "../theme-bridge";

type FakeDebugger = {
  readonly isAttached: ReturnType<typeof vi.fn>;
  readonly attach: ReturnType<typeof vi.fn>;
  readonly detach: ReturnType<typeof vi.fn>;
  readonly sendCommand: ReturnType<typeof vi.fn>;
  readonly on: ReturnType<typeof vi.fn>;
  readonly off: ReturnType<typeof vi.fn>;
};

type FakeWebContents = {
  readonly debugger: FakeDebugger;
  readonly isDestroyed: ReturnType<typeof vi.fn>;
  readonly getURL: ReturnType<typeof vi.fn>;
  readonly insertCSS: ReturnType<typeof vi.fn>;
  readonly executeJavaScript: ReturnType<typeof vi.fn>;
};

const makeWebContents = (): FakeWebContents => {
  const fake: FakeWebContents = {
    debugger: {
      isAttached: vi.fn(() => false),
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(async (method: string) => {
        if (method === "Page.addScriptToEvaluateOnNewDocument") {
          return { identifier: `script-${Math.random().toString(16).slice(2)}` };
        }
        return {};
      }),
      on: vi.fn(),
      off: vi.fn()
    },
    isDestroyed: vi.fn(() => false),
    getURL: vi.fn(() => "https://example.com/"),
    insertCSS: vi.fn(async () => undefined),
    executeJavaScript: vi.fn(async () => undefined)
  };
  return fake;
};

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

// Cast helpers so we can feed a minimal fake object into the injector without
// pulling the full Electron type surface into the test.
const toWebContentsArg = (value: FakeWebContents): never => value as never;

const enabledSnapshot = () =>
  buildWebThemeSnapshot({
    vars: {
      "--lyra-bg-app": "#111",
      "--lyra-text-primary": "#eee"
    },
    enabled: true,
    previousRevision: 0
  });

describe("createWebThemeInjector", () => {
  test("attach is idempotent per tab", async () => {
    const injector = createWebThemeInjector();
    const wc = makeWebContents();
    await injector.updateSnapshot(enabledSnapshot());
    injector.attach("tab-1", toWebContentsArg(wc));
    injector.attach("tab-1", toWebContentsArg(wc));
    await flushMicrotasks();
    expect(wc.debugger.attach).toHaveBeenCalledTimes(1);
    injector.dispose();
  });

  test("detach unknown tab is a no-op", () => {
    const injector = createWebThemeInjector();
    expect(() => injector.detach("nope")).not.toThrow();
    injector.dispose();
  });

  test("dispose tears down attached debuggers", async () => {
    const injector = createWebThemeInjector();
    const wc = makeWebContents();
    wc.debugger.isAttached.mockReturnValueOnce(false).mockReturnValue(true);
    await injector.updateSnapshot(enabledSnapshot());
    injector.attach("tab-1", toWebContentsArg(wc));
    await flushMicrotasks();
    injector.dispose();
    expect(wc.debugger.detach).toHaveBeenCalled();
  });

  test("updateSnapshot skips work when palette + enabled are unchanged", async () => {
    const injector = createWebThemeInjector();
    const wc = makeWebContents();
    injector.attach("tab-1", toWebContentsArg(wc));
    await flushMicrotasks();
    const baselineSends = wc.debugger.sendCommand.mock.calls.length;
    const first = buildWebThemeSnapshot({
      vars: {
        "--lyra-bg-app": "#111",
        "--lyra-text-primary": "#eee"
      },
      enabled: true,
      previousRevision: 0
    });
    await injector.updateSnapshot(first);
    const afterFirstSends = wc.debugger.sendCommand.mock.calls.length;
    expect(afterFirstSends).toBeGreaterThan(baselineSends);

    const equivalent = buildWebThemeSnapshot({
      vars: {
        "--lyra-bg-app": "#111",
        "--lyra-text-primary": "#eee"
      },
      enabled: true,
      previousRevision: 999
    });
    await injector.updateSnapshot(equivalent);
    expect(wc.debugger.sendCommand.mock.calls.length).toBe(afterFirstSends);
    injector.dispose();
  });

  test("falls back to insertCSS when CDP attach fails", async () => {
    const injector = createWebThemeInjector();
    const wc = makeWebContents();
    wc.debugger.attach.mockImplementation(() => {
      throw new Error("cdp-not-allowed");
    });
    wc.debugger.isAttached.mockReturnValue(false);

    injector.attach("tab-1", toWebContentsArg(wc));
    await flushMicrotasks();

    const snapshot = buildWebThemeSnapshot({
      vars: {
        "--lyra-bg-app": "#111",
        "--lyra-text-primary": "#eee"
      },
      enabled: true,
      previousRevision: 0
    });
    await injector.updateSnapshot(snapshot);
    await flushMicrotasks();
    expect(wc.insertCSS).toHaveBeenCalled();
    injector.dispose();
  });

  test("disabled snapshot does not install new-document scripts", async () => {
    const injector = createWebThemeInjector();
    const wc = makeWebContents();
    injector.attach("tab-1", toWebContentsArg(wc));
    await flushMicrotasks();
    const baseline = wc.debugger.sendCommand.mock.calls.length;

    const disabled = buildWebThemeSnapshot({
      vars: { "--lyra-bg-app": "#111", "--lyra-text-primary": "#eee" },
      enabled: false,
      previousRevision: 0
    });
    await injector.updateSnapshot(disabled);
    const callsAfterDisable = wc.debugger.sendCommand.mock.calls.filter(
      ([method]) => method === "Page.addScriptToEvaluateOnNewDocument"
    );
    // No *new* document scripts should be installed beyond whatever attached initially.
    expect(callsAfterDisable.length).toBeLessThanOrEqual(baseline);
    injector.dispose();
  });
});
