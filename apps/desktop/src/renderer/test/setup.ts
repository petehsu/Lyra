import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}

if (typeof window !== "undefined") {
  Object.defineProperty(globalThis, "self", {
    configurable: true,
    value: window
  });

  if (typeof window.requestAnimationFrame !== "function") {
    window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16)) as typeof window.requestAnimationFrame;
  }

  if (typeof window.cancelAnimationFrame !== "function") {
    window.cancelAnimationFrame = ((handle: number) => {
      window.clearTimeout(handle);
    }) as typeof window.cancelAnimationFrame;
  }

  if (typeof window.ResizeObserver !== "function") {
    class ResizeObserverMock implements ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }

    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: ResizeObserverMock
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: ResizeObserverMock
    });
  }

  const localStorageCandidate = window.localStorage as Partial<Storage> | undefined;
  const hasCompleteStorageApi =
    localStorageCandidate !== undefined &&
    typeof localStorageCandidate.getItem === "function" &&
    typeof localStorageCandidate.setItem === "function" &&
    typeof localStorageCandidate.removeItem === "function" &&
    typeof localStorageCandidate.clear === "function";

  if (hasCompleteStorageApi === false) {
    const memory = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return memory.size;
      },
      clear: () => {
        memory.clear();
      },
      getItem: (key: string) => memory.get(String(key)) ?? null,
      key: (index: number) => Array.from(memory.keys())[index] ?? null,
      removeItem: (key: string) => {
        memory.delete(String(key));
      },
      setItem: (key: string, value: string) => {
        memory.set(String(key), String(value));
      }
    };

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: storage
    });
  }
}

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddonMock {
    fit(): void {}
  }
}));

vi.mock("xterm", () => {
  const terminalInstances: TerminalMock[] = [];

  class TerminalMock {
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
    element: HTMLElement | undefined;
    helperTextarea: HTMLTextAreaElement | undefined;

    constructor(options: Record<string, unknown> = {}) {
      this.options = { ...options };
      terminalInstances.push(this);
    }

    loadAddon(): void {}
    open(element?: HTMLElement): void {
      if (element === undefined) {
        return;
      }

      const terminalElement = document.createElement("div");
      terminalElement.className = "terminal xterm";
      const helpersElement = document.createElement("div");
      helpersElement.className = "xterm-helpers";
      const helperTextarea = document.createElement("textarea");
      helperTextarea.className = "xterm-helper-textarea";
      helperTextarea.style.left = "12px";
      helperTextarea.style.top = "10px";
      helperTextarea.style.width = "8px";
      helperTextarea.style.height = "18px";
      helpersElement.append(helperTextarea);
      terminalElement.append(helpersElement);
      element.append(terminalElement);
      this.element = terminalElement;
      this.helperTextarea = helperTextarea;
    }
    dispose(): void {
      this.element?.remove();
      this.element = undefined;
      this.helperTextarea = undefined;
    }
    refresh(): void {}
    write(): void {}
    writeln(): void {}

    onData(): { dispose: () => void } {
      return { dispose: () => undefined };
    }
  }

  return {
    Terminal: TerminalMock,
    __terminalInstances: terminalInstances
  };
});
