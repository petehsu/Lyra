import { EventEmitter } from "node:events";
import { beforeEach, expect, test, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    nativeTheme: Object.assign(new EventEmitter(), {
      themeSource: "system",
      shouldUseDarkColors: true
    }),
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        handlers.set(channel, handler),
      removeHandler: (channel: string) => handlers.delete(channel)
    }
  };
});
import { nativeTheme } from "electron";
import { LYRA_CHANNELS } from "../shared/desktop-bridge";
import { registerWindowTheme } from "./window-theme";

beforeEach(() => {
  handlers.clear();
  Object.assign(nativeTheme, { themeSource: "system", shouldUseDarkColors: true });
  (nativeTheme as unknown as EventEmitter).removeAllListeners();
});

test("publishes the same native state to the renderer and opaque window on OS updates", () => {
  const send = vi.fn(),
    background = vi.fn();
  const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } };
  const dispose = registerWindowTheme(() => window as never, background);
  expect(handlers.get(LYRA_CHANNELS.readWindowTheme)?.()).toEqual({
    source: "system",
    shouldUseDarkColors: true
  });
  (nativeTheme as unknown as EventEmitter).emit("updated");
  expect(send).toHaveBeenLastCalledWith(LYRA_CHANNELS.windowThemeChanged, {
    source: "system",
    shouldUseDarkColors: true
  });
  expect(background).toHaveBeenLastCalledWith(true);
  Object.assign(nativeTheme, { shouldUseDarkColors: false });
  (nativeTheme as unknown as EventEmitter).emit("updated");
  expect(background).toHaveBeenLastCalledWith(false);
  dispose();
  expect(handlers.size).toBe(0);
  expect(nativeTheme.listenerCount("updated")).toBe(0);
});

test("validates explicit choices and republishes system state even without an updated event", () => {
  const background = vi.fn();
  const dispose = registerWindowTheme(() => null, background);
  const set = handlers.get(LYRA_CHANNELS.setWindowThemeSource)!;
  expect(() => set(null, "invalid")).toThrow("Invalid Lyra window theme source");
  set(null, "light");
  expect(nativeTheme.themeSource).toBe("light");
  set(null, "system");
  expect(nativeTheme.themeSource).toBe("system");
  expect(background).toHaveBeenLastCalledWith(true);
  dispose();
});
