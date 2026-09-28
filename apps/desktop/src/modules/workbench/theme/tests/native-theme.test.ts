import { afterEach, expect, test, vi } from "vitest";
import type { LyraDesktopApi, WindowThemePayload } from "../../../../shared/desktop-bridge";
import { observeSystemPrefersDark } from "../service";

const originalApi = window.lyraDesktop;
const originalMatchMedia = window.matchMedia;
let stop = () => {};
afterEach(() => {
  stop();
  window.lyraDesktop = originalApi;
  window.matchMedia = originalMatchMedia;
});

test("resamples after subscribing when the initial media read is stale", () => {
  window.matchMedia = vi.fn(
    () =>
      ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }) as unknown as MediaQueryList
  );
  const listener = vi.fn();
  stop = observeSystemPrefersDark(listener);
  expect(listener).toHaveBeenLastCalledWith(true);
});

test("uses native dark state even when renderer media says light and follows native changes", async () => {
  let nativeListener: (theme: WindowThemePayload) => void = () => {};
  let mediaListener: () => void = () => {};
  const unsubscribe = vi.fn();
  const readTheme = vi.fn(async (): Promise<WindowThemePayload> => ({
    source: "system",
    shouldUseDarkColors: true
  }));
  window.matchMedia = vi.fn(
    () =>
      ({
        matches: false,
        addEventListener: (_: string, listener: () => void) => {
          mediaListener = listener;
        },
        removeEventListener: vi.fn()
      }) as unknown as MediaQueryList
  );
  window.lyraDesktop = {
    windowControls: {
      readTheme,
      onThemeChange: (listener: (theme: WindowThemePayload) => void) => {
        nativeListener = listener;
        return unsubscribe;
      }
    }
  } as unknown as LyraDesktopApi;
  const listener = vi.fn();
  stop = observeSystemPrefersDark(listener);
  await Promise.resolve();
  expect(listener).toHaveBeenLastCalledWith(true);
  mediaListener();
  expect(listener).toHaveBeenLastCalledWith(true);
  nativeListener({ source: "system", shouldUseDarkColors: false });
  expect(listener).toHaveBeenLastCalledWith(false);
  window.dispatchEvent(new Event("focus"));
  await Promise.resolve();
  expect(listener).toHaveBeenLastCalledWith(true);
  stop();
  expect(unsubscribe).toHaveBeenCalled();
});

test("a delayed initial read cannot overwrite a newer theme event or an unmounted observer", async () => {
  let resolve!: (theme: WindowThemePayload) => void;
  let emit!: (theme: WindowThemePayload) => void;
  window.lyraDesktop = {
    windowControls: {
      readTheme: () =>
        new Promise<WindowThemePayload>((done) => {
          resolve = done;
        }),
      onThemeChange: (listener: (theme: WindowThemePayload) => void) => {
        emit = listener;
        return () => {};
      }
    }
  } as unknown as LyraDesktopApi;
  const listener = vi.fn();
  stop = observeSystemPrefersDark(listener);
  emit({ source: "system", shouldUseDarkColors: true });
  resolve({ source: "light", shouldUseDarkColors: false });
  await Promise.resolve();
  expect(listener).toHaveBeenLastCalledWith(true);
  stop();
  listener.mockClear();
  emit({ source: "light", shouldUseDarkColors: false });
  expect(listener).not.toHaveBeenCalled();
});
