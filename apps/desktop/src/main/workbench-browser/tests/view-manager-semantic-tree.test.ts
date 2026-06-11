import { JSDOM, type DOMWindow } from "jsdom";
import { beforeEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  const webContentsQueue: unknown[] = [];
  const browserWindows: unknown[] = [];

  class FakeView {
    readonly children: unknown[] = [];
    private bounds = { x: 0, y: 0, width: 1, height: 1 };
    private visible = false;

    addChildView(view: unknown): void {
      this.children.push(view);
    }

    removeChildView(view: unknown): void {
      const index = this.children.indexOf(view);
      if (index >= 0) {
        this.children.splice(index, 1);
      }
    }

    setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
      this.bounds = bounds;
    }

    getBounds(): { x: number; y: number; width: number; height: number } {
      return this.bounds;
    }

    setVisible(visible: boolean): void {
      this.visible = visible;
    }

    isVisible(): boolean {
      return this.visible;
    }
  }

  class FakeWebContentsView extends FakeView {
    readonly webContents: unknown;

    constructor() {
      super();
      this.webContents = webContentsQueue.shift() ?? {};
    }

    setBackgroundColor(): void {
      // Electron-only visual hook.
    }
  }

  class FakeBrowserWindow {
    readonly contentView = new FakeView();
    readonly webContents: unknown;
    private destroyed = false;

    constructor() {
      this.webContents = webContentsQueue.shift() ?? {};
      browserWindows.push(this);
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    destroy(): void {
      this.destroyed = true;
    }

    getContentBounds(): { x: number; y: number; width: number; height: number } {
      return { x: 0, y: 0, width: 1_280, height: 720 };
    }

    isFullScreen(): boolean {
      return false;
    }

    setFullScreen(): void {
      // Electron-only visual hook.
    }

    setMenuBarVisibility(): void {
      // Electron-only visual hook.
    }

    on(): void {
      // Listener registration is not needed by these fixtures.
    }
  }

  return {
    webContentsQueue,
    browserWindows,
    BrowserWindow: FakeBrowserWindow,
    View: FakeView,
    WebContentsView: FakeWebContentsView,
    session: {
      fromPartition: vi.fn(() => ({
        getStoragePath: () => null,
        cookies: {
          get: vi.fn(async () => [])
        }
      }))
    },
    shell: {
      openExternal: vi.fn(async () => undefined)
    }
  };
});

vi.mock("electron", () => electronMock);

import { createWorkbenchBrowserViewManager } from "../view-manager";
import type {
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserViewManager
} from "../types";

type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type FakeFrame = {
  frameTreeNodeId: number;
  url: string;
  origin: string;
  name: string;
  readonly window: DOMWindow;
  parent: FakeFrame | null;
  top: FakeFrame;
  frames: FakeFrame[];
  readonly framesInSubtree: FakeFrame[];
  isDestroyed: () => boolean;
  executeJavaScript: ReturnType<typeof vi.fn>;
};

type FakeWebContents = {
  mainFrame: FakeFrame;
  sentInputEvents: Array<Record<string, unknown>>;
  debugger: {
    isAttached: ReturnType<typeof vi.fn>;
    attach: ReturnType<typeof vi.fn>;
    detach: ReturnType<typeof vi.fn>;
    sendCommand: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
  getURL: ReturnType<typeof vi.fn>;
  getTitle: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  sendInputEvent: ReturnType<typeof vi.fn>;
  executeJavaScript: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
  listenerCount: (event: string) => number;
  removeAllListeners: ReturnType<typeof vi.fn>;
  insertCSS: ReturnType<typeof vi.fn>;
  findInPage: ReturnType<typeof vi.fn>;
  stopFindInPage: ReturnType<typeof vi.fn>;
  capturePage: ReturnType<typeof vi.fn>;
  navigationHistory: {
    canGoBack: ReturnType<typeof vi.fn>;
    canGoForward: ReturnType<typeof vi.fn>;
    getAllEntries: ReturnType<typeof vi.fn>;
    getActiveIndex: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
  };
  session: {
    cookies: {
      get: ReturnType<typeof vi.fn>;
    };
  };
};

const originFromUrl = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return "null";
  }
};

const createWindow = (html: string, url: string): DOMWindow => {
  const dom = new JSDOM(html, {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const win = dom.window;
  Object.defineProperty(win, "innerWidth", { configurable: true, value: 1_280 });
  Object.defineProperty(win, "innerHeight", { configurable: true, value: 720 });
  win.scrollTo = vi.fn();
  win.document.elementFromPoint = ((x: number, y: number) => {
    const collect = (root: ParentNode): Element[] => {
      const elements = Array.from(root.querySelectorAll("*"));
      return elements.flatMap((element) => {
        const shadowRoot = (element as HTMLElement).shadowRoot;
        return shadowRoot === null ? [element] : [element, ...collect(shadowRoot)];
      });
    };
    return collect(win.document)
      .reverse()
      .find((element) => {
        const rect = element.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      }) ?? win.document.body;
  }) as Document["elementFromPoint"];
  return win;
};

const setRect = (element: Element, rect: Rect): void => {
  element.getBoundingClientRect = vi.fn(() => ({
    x: rect.x,
    y: rect.y,
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    width: rect.width,
    height: rect.height,
    toJSON: () => rect
  }));
};

const createFrame = ({
  id,
  url,
  html,
  name = "",
  parent = null,
  executeJavaScript
}: {
  readonly id: number;
  readonly url: string;
  readonly html: string;
  readonly name?: string;
  readonly parent?: FakeFrame | null;
  readonly executeJavaScript?: (script: string, userGesture?: boolean) => unknown | Promise<unknown>;
}): FakeFrame => {
  const win = createWindow(html, url);
  const frame = {
    frameTreeNodeId: id,
    url,
    origin: originFromUrl(url),
    name,
    parent,
    top: undefined as unknown as FakeFrame,
    frames: [] as FakeFrame[],
    get framesInSubtree(): FakeFrame[] {
      return [frame, ...frame.frames.flatMap((child) => child.framesInSubtree)];
    },
    isDestroyed: () => false,
    executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) => {
      if (executeJavaScript !== undefined) {
        return await executeJavaScript(script, userGesture);
      }
      return win.eval(script);
    }),
    window: win
  };
  frame.top = parent?.top ?? frame;
  return frame;
};

const appendChildFrame = (parent: FakeFrame, child: FakeFrame): void => {
  child.parent = parent;
  child.top = parent.top;
  parent.frames.push(child);
};

const createWebContents = (
  mainFrame: FakeFrame,
  options: {
    readonly sendCommand?: (method: string, params?: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
    readonly hangLoad?: boolean;
  } = {}
): FakeWebContents => {
  let attached = false;
  const sentInputEvents: Array<Record<string, unknown>> = [];
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const addListener = (event: string, listener: (...args: unknown[]) => void): void => {
    const existing = listeners.get(event) ?? new Set();
    existing.add(listener);
    listeners.set(event, existing);
  };
  const removeListener = (event: string, listener: (...args: unknown[]) => void): void => {
    listeners.get(event)?.delete(listener);
  };
  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of [...(listeners.get(event) ?? [])]) {
      listener(...args);
    }
  };
  const debuggerApi = {
    isAttached: vi.fn(() => attached),
    attach: vi.fn(() => {
      attached = true;
    }),
    detach: vi.fn(() => {
      attached = false;
    }),
    sendCommand: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (options.sendCommand !== undefined) {
        return await options.sendCommand(method, params);
      }
      if (method === "Accessibility.getFullAXTree") {
        return { nodes: [] };
      }
      if (method === "Page.addScriptToEvaluateOnNewDocument") {
        return { identifier: `script-${Math.random().toString(16).slice(2)}` };
      }
      return {};
    }),
    on: vi.fn(),
    off: vi.fn()
  };
  const webContents: FakeWebContents = {
    mainFrame,
    sentInputEvents,
    debugger: debuggerApi,
    getURL: vi.fn(() => mainFrame.url),
    getTitle: vi.fn(() => mainFrame.window.document.title || "Fixture"),
    isDestroyed: vi.fn(() => false),
    focus: vi.fn(),
    sendInputEvent: vi.fn((event: Record<string, unknown>) => {
      sentInputEvents.push(event);
      const type = event.type;
      const x = Number(event.x);
      const y = Number(event.y);
      if (
        (type === "mouseMove" || type === "mouseDown" || type === "mouseUp")
        && Number.isFinite(x)
        && Number.isFinite(y)
      ) {
        const domEventType =
          type === "mouseMove" ? "mousemove" : type === "mouseDown" ? "mousedown" : "mouseup";
        const target = mainFrame.window.document.elementFromPoint(x, y);
        target?.dispatchEvent(new mainFrame.window.MouseEvent(domEventType, {
          bubbles: true,
          composed: true,
          clientX: x,
          clientY: y
        }));
      }
    }),
    executeJavaScript: vi.fn(async (script: string, userGesture?: boolean) =>
      await mainFrame.executeJavaScript(script, userGesture)
    ),
    loadURL: vi.fn(async (url: string) => {
      mainFrame.url = url;
      mainFrame.origin = originFromUrl(url);
      if (options.hangLoad === true) {
        await new Promise(() => undefined);
      }
    }),
    close: vi.fn(),
    stop: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      addListener(event, listener);
    }),
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      removeListener(event, listener);
    }),
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      const onceListener = (...args: unknown[]): void => {
        removeListener(event, onceListener);
        listener(...args);
      };
      addListener(event, onceListener);
    }),
    emit,
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    removeAllListeners: vi.fn((event?: string) => {
      if (typeof event === "string") {
        listeners.delete(event);
      } else {
        listeners.clear();
      }
    }),
    insertCSS: vi.fn(async () => "css-key"),
    findInPage: vi.fn(),
    stopFindInPage: vi.fn(),
    capturePage: vi.fn(async () => ({
      getSize: () => ({ width: 1, height: 1 }),
      toPNG: () => Buffer.from([])
    })),
    navigationHistory: {
      canGoBack: vi.fn(() => false),
      canGoForward: vi.fn(() => false),
      getAllEntries: vi.fn(() => []),
      getActiveIndex: vi.fn(() => 0),
      restore: vi.fn(async () => undefined)
    },
    session: {
      cookies: {
        get: vi.fn(async () => [])
      }
    }
  };
  return webContents;
};

const createManager = (
  mainFrame: FakeFrame,
  options?: Parameters<typeof createWebContents>[1],
  managerOptions: { readonly withWindow?: boolean } = {}
): { readonly manager: WorkbenchBrowserViewManager; readonly webContents: FakeWebContents } => {
  const webContents = createWebContents(mainFrame, options);
  const browserWindow = managerOptions.withWindow === true
    ? new electronMock.BrowserWindow()
    : null;
  electronMock.webContentsQueue.push(webContents);
  const manager = createWorkbenchBrowserViewManager({
    getWindow: () => browserWindow as never,
    publishEvent: vi.fn()
  });
  manager.syncTopology({
    activeTabId: "tab-1",
    pages: [{
      tabId: "tab-1",
      address: mainFrame.url,
      titleHint: "Fixture",
      isActive: true
    }]
  });
  return { manager, webContents };
};

const createEmptyManager = (): WorkbenchBrowserViewManager =>
  createWorkbenchBrowserViewManager({
    getWindow: () => null,
    publishEvent: vi.fn()
  });

const findByLabel = (
  elements: readonly WorkbenchBrowserAgentElement[],
  label: string
): WorkbenchBrowserAgentElement => {
  const element = elements.find((candidate) => candidate.label === label);
  expect(element).toBeDefined();
  return element as WorkbenchBrowserAgentElement;
};

describe("Workbench browser semantic tree fixtures", () => {
  beforeEach(() => {
    electronMock.webContentsQueue.length = 0;
    electronMock.browserWindows.length = 0;
    delete process.env.LYRA_BROWSER_ENABLE_CDP_PAGESHOT;
    delete process.env.LYRA_BROWSER_ENABLE_TEMP_SNAPSHOT_RENDERER;
  });

  test("maps and acts on open shadow root controls", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://app.test/shadow",
      html: "<!doctype html><title>Shadow</title><semantic-widget></semantic-widget>"
    });
    const host = mainFrame.window.document.querySelector("semantic-widget");
    expect(host).toBeInstanceOf(mainFrame.window.HTMLElement);
    setRect(host as Element, { x: 12, y: 18, width: 260, height: 96 });
    const shadow = (host as HTMLElement).attachShadow({ mode: "open" });
    shadow.innerHTML = "<button>Shadow save</button><input aria-label=\"Shadow name\" />";
    const button = shadow.querySelector("button");
    const input = shadow.querySelector("input");
    expect(button).toBeInstanceOf(mainFrame.window.HTMLButtonElement);
    expect(input).toBeInstanceOf(mainFrame.window.HTMLInputElement);
    setRect(button as Element, { x: 24, y: 30, width: 120, height: 32 });
    setRect(input as Element, { x: 24, y: 72, width: 180, height: 32 });

    const { manager, webContents } = createManager(mainFrame);
    const observation = await manager.observeAgentPage("tab-1", {
      targetMode: "live",
      strategy: "hybrid"
    });

    const shadowButton = findByLabel(observation.elements, "Shadow save");
    const shadowInput = findByLabel(observation.elements, "Shadow name");
    expect(shadowButton.discoveryScope).toBe("shadow");
    expect(shadowInput.discoveryScope).toBe("shadow");
    expect(shadowButton.hostChainFingerprint).toBeTruthy();
    expect(shadowButton.actionCapabilities).toContain("click");
    expect(shadowInput.actionCapabilities).toContain("type");
    expect(observation.semanticTree?.nodes.find((node) => node.targetRef === shadowButton.targetRef)).toMatchObject({
      treeScope: "shadow",
      hostChain: expect.arrayContaining(["semantic-widget"])
    });

    await expect(
      manager.actOnAgentElement("tab-1", {
        targetMode: "live",
        targetRef: shadowButton.targetRef,
        interaction: "click"
      })
    ).resolves.toMatchObject({
      ok: true,
      targetRef: shadowButton.targetRef
    });
    expect(webContents.sentInputEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "mouseDown",
          x: 84,
          y: 46
        })
      ])
    );

    await expect(
      manager.typeIntoAgentElement("tab-1", {
        targetMode: "live",
        targetRef: shadowInput.targetRef,
        text: "Ada",
        clear: true
      })
    ).resolves.toMatchObject({
      ok: true,
      targetRef: shadowInput.targetRef
    });
    expect((input as HTMLInputElement).value).toBe("Ada");
  });

  test("uses a lightweight interactive-only map without frame graph or AX debugger", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://app.test/quick",
      html: "<!doctype html><title>Quick</title><button>Save</button><input aria-label=\"Name\" />"
    });
    const button = mainFrame.window.document.querySelector("button");
    const input = mainFrame.window.document.querySelector("input");
    expect(button).toBeInstanceOf(mainFrame.window.HTMLButtonElement);
    expect(input).toBeInstanceOf(mainFrame.window.HTMLInputElement);
    setRect(button as Element, { x: 24, y: 40, width: 96, height: 32 });
    setRect(input as Element, { x: 24, y: 88, width: 160, height: 32 });

    const { manager, webContents } = createManager(mainFrame);
    mainFrame.executeJavaScript.mockClear();

    const observation = await manager.observeAgentPage("tab-1", {
      targetMode: "live",
      strategy: "interactiveOnly"
    });

    expect(observation).toMatchObject({
      strategy: "interactiveOnly",
      title: "Quick"
    });
    expect(observation.elements.map((element) => element.label)).toEqual(["Save", "Name"]);
    expect(mainFrame.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(mainFrame.executeJavaScript.mock.calls[0]?.[0]).toContain("const INCLUDE_CHILD_FRAMES = true");
    expect(webContents.debugger.attach).not.toHaveBeenCalled();
    expect(webContents.debugger.sendCommand).not.toHaveBeenCalledWith("Accessibility.getFullAXTree");
  });

  test("finds and semantically locates page text before returning nearby controls", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://app.test/settings",
      html: `
        <!doctype html>
        <title>Settings</title>
        <button id="top">Global save</button>
        <section>
          <h2 id="billing-title">Billing settings</h2>
          <p id="billing-copy">Invoices and payment method are managed here.</p>
          <button id="edit-billing">Edit billing</button>
          <input aria-label="Billing email" />
        </section>
      `
    });
    const topButton = mainFrame.window.document.querySelector("#top");
    const title = mainFrame.window.document.querySelector("#billing-title");
    const copy = mainFrame.window.document.querySelector("#billing-copy");
    const editButton = mainFrame.window.document.querySelector("#edit-billing");
    const input = mainFrame.window.document.querySelector("input");
    expect(topButton).toBeInstanceOf(mainFrame.window.HTMLButtonElement);
    expect(title).toBeInstanceOf(mainFrame.window.HTMLElement);
    expect(copy).toBeInstanceOf(mainFrame.window.HTMLElement);
    expect(editButton).toBeInstanceOf(mainFrame.window.HTMLButtonElement);
    expect(input).toBeInstanceOf(mainFrame.window.HTMLInputElement);
    setRect(topButton as Element, { x: 24, y: 40, width: 120, height: 32 });
    setRect(title as Element, { x: 40, y: 280, width: 220, height: 34 });
    setRect(copy as Element, { x: 40, y: 320, width: 420, height: 44 });
    setRect(editButton as Element, { x: 40, y: 382, width: 120, height: 32 });
    setRect(input as Element, { x: 180, y: 382, width: 180, height: 32 });

    const { manager, webContents } = createManager(mainFrame);

    await expect(
      manager.findAgentPage("tab-1", {
        targetMode: "live",
        query: "payment method",
        reveal: true
      })
    ).resolves.toMatchObject({
      ok: true,
      kind: "lyraLumenFind",
      totalMatches: 1,
      currentIndex: 1,
      revealRect: expect.objectContaining({ top: 320 })
    });
    expect(webContents.findInPage).toHaveBeenCalledWith(
      "payment method",
      expect.objectContaining({ findNext: false })
    );

    const located = await manager.locateAgentPage("tab-1", {
      targetMode: "live",
      query: "billing settings",
      matchMode: "semantic",
      reveal: true,
      autoMap: true,
      nearbyLimit: 3
    });

    expect(located).toMatchObject({
      ok: true,
      kind: "lyraLumenLocate",
      matched: true,
      matchMode: "semantic",
      anchorQuery: expect.stringContaining("Billing"),
      observationId: expect.any(String)
    });
    expect(located.nearbyElements?.map((element) => element.label)).toEqual([
      "Edit billing",
      "Billing email",
      "Global save"
    ]);
  });

  test("maps same-origin iframe controls and clicks by child frame bounds", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://app.test/parent",
      html: "<!doctype html><title>Parent</title><iframe name=\"checkout\" src=\"https://app.test/child\"></iframe>"
    });
    const childFrame = createFrame({
      id: 2,
      url: "https://app.test/child",
      name: "checkout",
      parent: mainFrame,
      html: "<!doctype html><title>Child</title><button>Pay now</button>"
    });
    appendChildFrame(mainFrame, childFrame);
    const iframe = mainFrame.window.document.querySelector("iframe");
    const payButton = childFrame.window.document.querySelector("button");
    expect(iframe).toBeInstanceOf(mainFrame.window.HTMLIFrameElement);
    expect(payButton).toBeInstanceOf(childFrame.window.HTMLButtonElement);
    setRect(iframe as Element, { x: 100, y: 80, width: 320, height: 200 });
    setRect(payButton as Element, { x: 12, y: 16, width: 120, height: 30 });

    const { manager, webContents } = createManager(mainFrame);
    const observation = await manager.observeAgentPage("tab-1", {
      targetMode: "live",
      strategy: "hybrid"
    });

    const payTarget = findByLabel(observation.elements, "Pay now");
    expect(payTarget.frameTreeNodeId).toBe(2);
    expect(payTarget.bounds).toEqual({ x: 112, y: 96, width: 120, height: 30 });
    expect(observation.semanticTree?.frames.find((frame) => frame.frameTreeNodeId === 2)).toMatchObject({
      parentFrameTreeNodeId: 1,
      ownerSelectorPreview: "iframe[name=\"checkout\"]",
      bounds: { x: 100, y: 80, width: 320, height: 200 },
      domAccess: "direct"
    });

    await expect(
      manager.actOnAgentElement("tab-1", {
        targetMode: "live",
        targetRef: payTarget.targetRef,
        interaction: "click"
      })
    ).resolves.toMatchObject({
      ok: true,
      targetRef: payTarget.targetRef
    });
    expect(webContents.sentInputEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "mouseDown",
          x: 172,
          y: 111
        })
      ])
    );
  });

  test("uses fast action verification by default and full verification only when requested", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://app.test/fast-action",
      html: "<!doctype html><title>Fast</title><button>Save</button>"
    });
    const button = mainFrame.window.document.querySelector("button");
    expect(button).toBeInstanceOf(mainFrame.window.HTMLButtonElement);
    setRect(button as Element, { x: 32, y: 48, width: 100, height: 30 });

    const { manager, webContents } = createManager(mainFrame);
    const observation = await manager.observeAgentPage("tab-1", {
      targetMode: "live",
      strategy: "hybrid"
    });
    const saveTarget = findByLabel(observation.elements, "Save");

    mainFrame.executeJavaScript.mockClear();
    webContents.executeJavaScript.mockClear();

    const fastResult = await manager.actOnAgentElement("tab-1", {
      targetMode: "live",
      targetRef: saveTarget.targetRef,
      interaction: "click"
    });

    expect(fastResult).toMatchObject({
      ok: true,
      targetRef: saveTarget.targetRef,
      verification: "none"
    });
    expect(fastResult.afterObservationId).toBeUndefined();
    expect(mainFrame.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(mainFrame.executeJavaScript.mock.calls[0]?.[0]).toContain("window.innerWidth");
    expect(webContents.executeJavaScript).toHaveBeenCalledTimes(1);

    const fullResult = await manager.actOnAgentElement("tab-1", {
      targetMode: "live",
      targetRef: saveTarget.targetRef,
      interaction: "click",
      verification: "full"
    });

    expect(fullResult).toMatchObject({
      ok: true,
      targetRef: saveTarget.targetRef,
      verification: "full"
    });
    expect(fullResult.afterObservationId).toBeTruthy();
  });

  test("splits full verification codes across segmented one-character inputs", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://github.com/login/device",
      html: `
        <!doctype html>
        <title>Device Activation</title>
        <form>
          ${Array.from({ length: 8 }, (_, index) =>
            `<input aria-label="User code ${index}" maxlength="1" inputmode="text" />`
          ).join("")}
          <button>Continue</button>
        </form>
      `
    });
    const inputs = Array.from(mainFrame.window.document.querySelectorAll("input"));
    for (const [index, input] of inputs.entries()) {
      setRect(input, { x: 40 + index * 36, y: 80, width: 28, height: 36 });
    }
    const button = mainFrame.window.document.querySelector("button");
    expect(button).toBeInstanceOf(mainFrame.window.HTMLButtonElement);
    setRect(button as Element, { x: 40, y: 132, width: 180, height: 36 });

    const { manager } = createManager(mainFrame);
    const observation = await manager.observeAgentPage("tab-1", {
      targetMode: "live",
      strategy: "hybrid"
    });
    const firstCodeInput = findByLabel(observation.elements, "User code 0");

    await expect(
      manager.typeIntoAgentElement("tab-1", {
        targetMode: "live",
        targetRef: firstCodeInput.targetRef,
        text: "2514-091A",
        clear: true
      })
    ).resolves.toMatchObject({
      ok: true,
      targetRef: firstCodeInput.targetRef
    });
    expect(inputs.map((input) => input.value)).toEqual(["2", "5", "1", "4", "0", "9", "1", "A"]);
  });

  test("keeps full verification codes in a single ordinary code input", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://example.com/login/device",
      html: `
        <!doctype html>
        <title>Device Activation</title>
        <label>
          Verification code
          <input aria-label="Verification code" inputmode="text" />
        </label>
      `
    });
    const input = mainFrame.window.document.querySelector("input");
    expect(input).toBeInstanceOf(mainFrame.window.HTMLInputElement);
    setRect(input as Element, { x: 40, y: 80, width: 220, height: 36 });

    const { manager } = createManager(mainFrame);
    const observation = await manager.observeAgentPage("tab-1", {
      targetMode: "live",
      strategy: "hybrid"
    });
    const codeInput = findByLabel(observation.elements, "Verification code");

    await expect(
      manager.typeIntoAgentElement("tab-1", {
        targetMode: "live",
        targetRef: codeInput.targetRef,
        text: "2514-091A",
        clear: true
      })
    ).resolves.toMatchObject({
      ok: true,
      targetRef: codeInput.targetRef
    });
    expect(input?.value).toBe("2514-091A");
  });

  test("returns the final input value and avoids duplicating an already matching value", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://ip112.cn/",
      html: `
        <!doctype html>
        <title>IP availability</title>
        <label>
          IP地址或域名
          <input aria-label="IP地址或域名" />
        </label>
      `
    });
    const input = mainFrame.window.document.querySelector("input");
    expect(input).toBeInstanceOf(mainFrame.window.HTMLInputElement);
    setRect(input as Element, { x: 40, y: 80, width: 260, height: 36 });

    const { manager } = createManager(mainFrame);
    const observation = await manager.observeAgentPage("tab-1", {
      targetMode: "live",
      strategy: "interactiveOnly"
    });
    const ipInput = findByLabel(observation.elements, "IP地址或域名");

    const firstResult = await manager.typeIntoAgentElement("tab-1", {
      targetMode: "live",
      targetRef: ipInput.targetRef,
      text: "64.186.233.226",
      clear: true
    });
    expect(firstResult).toMatchObject({
      ok: true,
      inputValuePreview: "64.186.233.226",
      inputTextChanged: true
    });

    const secondResult = await manager.typeIntoAgentElement("tab-1", {
      targetMode: "live",
      targetRef: ipInput.targetRef,
      text: "64.186.233.226"
    });
    expect(secondResult).toMatchObject({
      ok: true,
      inputValuePreview: "64.186.233.226",
      inputTextChanged: false,
      inputAlreadyMatched: true
    });
    expect(input?.value).toBe("64.186.233.226");
  });

  test("returns blocked regions and visual fallback target for cross-origin iframe", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://merchant.test/checkout",
      html: "<!doctype html><title>Checkout</title><iframe name=\"pay\" src=\"https://pay.example/auth\"></iframe>"
    });
    const childWindow = createWindow("<!doctype html><title>Pay</title>", "https://pay.example/auth");
    const childFrame = createFrame({
      id: 2,
      url: "https://pay.example/auth",
      name: "pay",
      parent: mainFrame,
      html: "<!doctype html><title>Pay</title>",
      executeJavaScript: (script) => {
        if (script.includes("const FRAME_TREE_NODE_ID")) {
          throw new Error("cross origin frame execution blocked");
        }
        return childWindow.eval(script);
      }
    });
    appendChildFrame(mainFrame, childFrame);
    const iframe = mainFrame.window.document.querySelector("iframe");
    expect(iframe).toBeInstanceOf(mainFrame.window.HTMLIFrameElement);
    setRect(iframe as Element, { x: 240, y: 140, width: 360, height: 220 });

    const { manager } = createManager(mainFrame);
    const observation = await manager.observeAgentPage("tab-1", {
      targetMode: "live",
      strategy: "hybrid"
    });

    expect(observation.blockedRegions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "cross-origin",
          frameTreeNodeId: 2,
          bounds: { x: 240, y: 140, width: 360, height: 220 },
          fallback: "visual"
        })
      ])
    );
    const visualTarget = observation.elements.find((element) => element.discoveryScope === "visual");
    expect(visualTarget).toBeDefined();
    expect(visualTarget).toMatchObject({
      frameTreeNodeId: 2,
      frameBounds: { x: 240, y: 140, width: 360, height: 220 },
      bounds: { x: 400, y: 230, width: 40, height: 40 }
    });
    expect(observation.semanticTree?.coverage.visualCoverage).toBe(1);
    expect(observation.nextRecommendedAction).toBe("lyra_lumen.see");
    expect(visualTarget?.actionHint).toBe("use_visual_act");
    expect(visualTarget?.actionCapabilities).toEqual([]);

    await expect(
      manager.actOnAgentElement("tab-1", {
        targetMode: "live",
        targetRef: visualTarget!.targetRef,
        interaction: "click"
      })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        kind: "visualActRequired"
      },
      nextRecommendedAction: "lyra_lumen.see"
    });
  });

  test("visual point action converts screenshot device pixels to css coordinates", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://app.test/visual",
      html: "<!doctype html><title>Visual</title><button id=\"hit\">Hit</button>"
    });
    Object.defineProperty(mainFrame.window, "devicePixelRatio", { configurable: true, value: 2 });
    const hit = mainFrame.window.document.querySelector("#hit");
    expect(hit).toBeInstanceOf(mainFrame.window.HTMLButtonElement);
    setRect(hit as Element, { x: 90, y: 40, width: 80, height: 40 });

    const { manager, webContents } = createManager(mainFrame, undefined, { withWindow: true });
    manager.syncLayout({
      windowWidth: 1_280,
      windowHeight: 720,
      layouts: [{
        tabId: "tab-1",
        x: 0,
        y: 0,
        width: 1_280,
        height: 720,
        visible: true,
        zIndex: 0,
        isFocusedPane: true
      }]
    });
    webContents.capturePage.mockResolvedValueOnce({
      getSize: () => ({ width: 2_560, height: 1_440 }),
      toPNG: () => Buffer.from("visual")
    });
    const capture = await manager.captureAgentPage("tab-1", { targetMode: "live" });
    expect(capture.visualFrame).toMatchObject({
      dpr: 2,
      cssViewportWidth: 1_280,
      cssViewportHeight: 720,
      imageWidth: 2_560,
      imageHeight: 1_440
    });

    const result = await manager.actOnAgentVisualPoint("tab-1", {
      targetMode: "live",
      captureId: capture.visualFrame!.captureId,
      point: { x: 200, y: 100, reason: "hit button" },
      interaction: "click"
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "lyraLumenActionResult",
      x: 100,
      y: 50
    });
    expect(webContents.sentInputEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "mouseUp", x: 100, y: 50 })
      ])
    );
  });

  test("visual point action rejects stale captures after layout resize", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://app.test/visual-stale",
      html: "<!doctype html><title>Visual stale</title><button id=\"hit\">Hit</button>"
    });
    Object.defineProperty(mainFrame.window, "devicePixelRatio", { configurable: true, value: 2 });
    const { manager, webContents } = createManager(mainFrame, undefined, { withWindow: true });
    manager.syncLayout({
      windowWidth: 1_280,
      windowHeight: 720,
      layouts: [{
        tabId: "tab-1",
        x: 0,
        y: 0,
        width: 1_280,
        height: 720,
        visible: true,
        zIndex: 0,
        isFocusedPane: true
      }]
    });
    webContents.capturePage.mockResolvedValueOnce({
      getSize: () => ({ width: 2_560, height: 1_440 }),
      toPNG: () => Buffer.from("visual")
    });
    const capture = await manager.captureAgentPage("tab-1", { targetMode: "live" });

    manager.syncLayout({
      windowWidth: 1_280,
      windowHeight: 720,
      layouts: [{
        tabId: "tab-1",
        x: 0,
        y: 0,
        width: 960,
        height: 540,
        visible: true,
        zIndex: 0,
        isFocusedPane: true
      }]
    });

    const result = await manager.actOnAgentVisualPoint("tab-1", {
      targetMode: "live",
      captureId: capture.visualFrame!.captureId,
      point: { x: 200, y: 100, reason: "hit button" },
      interaction: "click"
    });

    expect(result).toMatchObject({
      ok: false,
      kind: "lyraLumenVactStale",
      reason: "viewport_resized",
      nextRecommendedAction: "lyra_lumen.see"
    });
    expect(webContents.sentInputEvents).toEqual([]);
  });

  test("discovers portal menuitems after hover reveal", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://app.test/menu",
      html: "<!doctype html><title>Menu</title><button id=\"more\" aria-haspopup=\"menu\">More</button>"
    });
    const moreButton = mainFrame.window.document.querySelector("#more");
    expect(moreButton).toBeInstanceOf(mainFrame.window.HTMLButtonElement);
    setRect(moreButton as Element, { x: 40, y: 44, width: 90, height: 36 });
    moreButton?.addEventListener("mousemove", () => {
      if (mainFrame.window.document.querySelector("[role='menuitem']") !== null) {
        return;
      }
      const item = mainFrame.window.document.createElement("button");
      item.setAttribute("role", "menuitem");
      item.textContent = "Delete";
      setRect(item, { x: 44, y: 88, width: 120, height: 32 });
      mainFrame.window.document.body.appendChild(item);
    });

    const { manager } = createManager(mainFrame);
    const before = await manager.observeAgentPage("tab-1", {
      targetMode: "live",
      strategy: "hybrid"
    });
    const moreTarget = findByLabel(before.elements, "More");
    expect(before.elements.some((element) => element.label === "Delete")).toBe(false);

    await expect(
      manager.actOnAgentElement("tab-1", {
        targetMode: "live",
        targetRef: moreTarget.targetRef,
        interaction: "hover"
      })
    ).resolves.toMatchObject({
      ok: true,
      targetRef: moreTarget.targetRef
    });
    const after = await manager.observeAgentPage("tab-1", {
      targetMode: "live",
      strategy: "hybrid"
    });
    const menuitem = findByLabel(after.elements, "Delete");
    expect(menuitem.role).toBe("menuitem");
    expect(menuitem.actionCapabilities).toEqual(expect.arrayContaining(["menuitem", "click"]));
  });

  test("cancels stale page-load waits when isolated navigation is superseded", async () => {
    vi.useFakeTimers();
    try {
      const shadowFrame = createFrame({
        id: 1,
        url: "about:blank",
        html: "<!doctype html><title>Shadow</title><main>Loading</main>"
      });
      const shadowWebContents = createWebContents(shadowFrame, { hangLoad: true });
      electronMock.webContentsQueue.push(shadowWebContents);
      const manager = createEmptyManager();

      const firstNavigation = manager.navigateAgentPage("agent-tab", {
        targetMode: "isolated",
        url: "https://app.test/first",
        timeoutMs: 10_000
      });
      await Promise.resolve();
      expect(shadowWebContents.listenerCount("did-stop-loading")).toBe(2);

      const secondNavigation = manager.navigateAgentPage("agent-tab", {
        targetMode: "isolated",
        url: "https://app.test/second",
        timeoutMs: 1_000
      });
      await Promise.resolve();

      expect(shadowWebContents.stop).toHaveBeenCalledTimes(1);
      expect(shadowWebContents.listenerCount("did-stop-loading")).toBe(2);
      expect(shadowWebContents.listenerCount("did-fail-load")).toBe(1);

      await expect(firstNavigation).resolves.toMatchObject({
        targetMode: "isolated"
      });

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(secondNavigation).resolves.toMatchObject({
        address: "https://app.test/second",
        targetMode: "isolated"
      });
      expect(shadowWebContents.listenerCount("did-stop-loading")).toBe(1);
      expect(shadowWebContents.listenerCount("did-fail-load")).toBe(0);
      expect(shadowWebContents.stop).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("degrades pageshot to visible capture without CDP by default", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://app.test/snapshot",
      html: "<!doctype html><title>Snapshot</title><main>Rendered snapshot text</main>"
    });
    const { manager, webContents } = createManager(mainFrame);

    const snapshot = await manager.readRenderedSnapshot({
      url: "https://app.test/snapshot",
      includePageshot: true,
      waitUntil: "html"
    });

    expect(webContents.debugger.attach).not.toHaveBeenCalled();
    expect(webContents.capturePage).toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      ok: true,
      kind: "workbenchBrowserRenderedSnapshot",
      finalUrl: "https://app.test/snapshot",
      pageshot: {
        mimeType: "image/png",
        visibleOnly: true
      },
      debug: {
        snapshotMode: "tabRenderer"
      }
    });
    expect((snapshot as { warnings?: Array<{ readonly code: string }> }).warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "browser_pageshot_degraded" })
      ])
    );
  });

  test("keeps viewport/mobile browser snapshots on the tab renderer unless explicitly enabled", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://app.test/mobile",
      html: "<!doctype html><title>Mobile</title><main>Mobile snapshot text</main>"
    });
    const { manager, webContents } = createManager(mainFrame);
    expect(electronMock.browserWindows).toHaveLength(0);

    const snapshot = await manager.readRenderedSnapshot({
      url: "https://app.test/mobile",
      includePageshot: true,
      mobile: true,
      viewport: { width: 390, height: 844, deviceScaleFactor: 3 },
      waitUntil: "html"
    });

    expect(electronMock.browserWindows).toHaveLength(0);
    expect(webContents.debugger.attach).not.toHaveBeenCalled();
    expect(webContents.capturePage).toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      ok: true,
      kind: "workbenchBrowserRenderedSnapshot",
      finalUrl: "https://app.test/mobile",
      pageshot: {
        visibleOnly: true
      },
      debug: {
        snapshotMode: "tabRenderer"
      }
    });
    expect((snapshot as { warnings?: Array<{ readonly code: string }> }).warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "browser_temporary_renderer_disabled" }),
        expect.objectContaining({ code: "browser_pageshot_degraded" })
      ])
    );
  });

  test("creates target refs for AX-only controls", async () => {
    const mainFrame = createFrame({
      id: 1,
      url: "https://app.test/ax-only",
      html: "<!doctype html><title>AX</title>"
    });
    const { manager } = createManager(mainFrame, {
      sendCommand: async (method) => {
        if (method === "Accessibility.getFullAXTree") {
          return {
            nodes: [{
              ignored: false,
              role: { value: "button" },
              name: { value: "AX submit" },
              backendDOMNodeId: 42
            }]
          };
        }
        if (method === "DOM.getBoxModel") {
          return {
            model: {
              border: [300, 220, 420, 220, 420, 260, 300, 260]
            }
          };
        }
        if (method === "Page.addScriptToEvaluateOnNewDocument") {
          return { identifier: "script-ax" };
        }
        return {};
      }
    });

    const observation = await manager.observeAgentPage("tab-1", {
      targetMode: "live",
      strategy: "hybrid"
    });

    const axTarget = findByLabel(observation.elements, "AX submit");
    expect(axTarget.discoveryScope).toBe("ax");
    expect(axTarget.targetRef).toMatch(/^lumen:/u);
    expect(axTarget.actionCapabilities).toContain("click");
    expect(observation.semanticTree?.nodes.find((node) => node.targetRef === axTarget.targetRef)).toMatchObject({
      source: ["ax"],
      actionCapabilities: expect.arrayContaining(["click"])
    });
  });
});
