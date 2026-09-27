import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { buildBrowserAgentObservationScript } from "../view-manager-runtime/agent-observation-runtime";

const originalVisibility = Object.getOwnPropertyDescriptor(Element.prototype, "checkVisibility");
const originalRect = Element.prototype.getBoundingClientRect;
const originalStyle = window.getComputedStyle.bind(window);
// jsdom has no pseudo-element rendering. Chromium regressions cover CSS names.
beforeEach(() => {
  vi.spyOn(window, "getComputedStyle").mockImplementation(element => originalStyle(element));
  // JSDOM has no layout API. Real visibility inheritance is tested in Chromium.
  Object.defineProperty(Element.prototype, "checkVisibility", { configurable: true, value: function (this: Element) {
    const style = window.getComputedStyle(this);
    return style.display !== "none" && !["hidden", "collapse"].includes(style.visibility);
  } });
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect;
  if (originalVisibility) Object.defineProperty(Element.prototype, "checkVisibility", originalVisibility);
  else Reflect.deleteProperty(Element.prototype, "checkVisibility");
  document.body.replaceChildren();
});

test("keeps a faded icon inside a conversation row as its own control", async () => {
  const row = document.createElement("a");
  row.href = "/chat";
  row.textContent = "Ubuntu";
  const icon = document.createElement("div");
  icon.id = "more";
  icon.style.cursor = "pointer";
  const decoration = document.createElement("div");
  decoration.id = "mark";
  row.append(icon, decoration);
  document.body.append(row);
  const boxes = new Map<Element, { x: number; y: number; width: number; height: number }>([
    [row, { x: 12, y: 80, width: 220, height: 32 }],
    [icon, { x: 190, y: 84, width: 28, height: 28 }],
    [decoration, { x: 20, y: 88, width: 16, height: 16 }]
  ]);
  Element.prototype.getBoundingClientRect = function rect(): DOMRect {
    const box = boxes.get(this) ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      top: box.y,
      left: box.x,
      right: box.x + box.width,
      bottom: box.y + box.height,
      toJSON() {
        return this;
      }
    } as DOMRect;
  };
  document.elementFromPoint = () => null;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
  const result = await window.eval(buildBrowserAgentObservationScript({
    frameTreeNodeId: 1,
    frameRef: "main",
    frameBounds: { x: 0, y: 0, width: 800, height: 600 },
    strategy: "interactiveOnly",
    includeChildFrames: false,
    isMainFrame: true
  })) as { elements: Array<{ tagName: string }> };
  const tags = result.elements.map((element) => element.tagName);
  expect(tags.filter((tag) => tag === "div")).toHaveLength(1);
  expect(tags).toContain("a");
});

test("keeps a text field that does not receive the hit test", async () => {
  const shell = document.createElement("div");
  const field = document.createElement("input");
  field.type = "text";
  field.placeholder = "Phone number / email address";
  field.style.pointerEvents = "none";
  field.style.opacity = "0";
  shell.append(field);
  document.body.append(shell);
  const boxes = new Map<Element, { x: number; y: number; width: number; height: number }>([
    [shell, { x: 400, y: 200, width: 320, height: 40 }],
    [field, { x: 408, y: 208, width: 298, height: 25 }]
  ]);
  Element.prototype.getBoundingClientRect = function rect(): DOMRect {
    const box = boxes.get(this) ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      top: box.y,
      left: box.x,
      right: box.x + box.width,
      bottom: box.y + box.height,
      toJSON() {
        return this;
      }
    } as DOMRect;
  };
  document.elementFromPoint = () => shell;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
  const result = await window.eval(buildBrowserAgentObservationScript({
    frameTreeNodeId: 1,
    frameRef: "main",
    frameBounds: { x: 0, y: 0, width: 800, height: 600 },
    strategy: "interactiveOnly",
    includeChildFrames: false,
    isMainFrame: true
  })) as { elements: Array<{ tagName: string; label: string; semantics?: { context?: string[] } }> };
  const input = result.elements.find((element) => element.tagName === "input");
  expect(input?.label).toBe("Phone number / email address");
});

test("keeps the avatar, the name, and the trailing icon of a footer row", async () => {
  const row = document.createElement("div");
  row.id = "account";
  row.style.cursor = "pointer";
  const avatar = document.createElement("div");
  avatar.id = "avatar";
  avatar.style.cursor = "pointer";
  const name = document.createElement("div");
  name.id = "name";
  name.style.cursor = "pointer";
  name.textContent = "ㅤ";
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.id = "more";
  icon.style.cursor = "pointer";
  row.append(avatar, name, icon);
  document.body.append(row);
  const boxes = new Map<Element, { x: number; y: number; width: number; height: number }>([
    [row, { x: 12, y: 640, width: 236, height: 44 }],
    [avatar, { x: 20, y: 646, width: 32, height: 32 }],
    [name, { x: 58, y: 652, width: 39, height: 20 }],
    [icon, { x: 210, y: 654, width: 16, height: 16 }]
  ]);
  Element.prototype.getBoundingClientRect = function rect(): DOMRect {
    const box = boxes.get(this) ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: box.x, y: box.y, width: box.width, height: box.height,
      top: box.y, left: box.x, right: box.x + box.width, bottom: box.y + box.height,
      toJSON() { return this; }
    } as DOMRect;
  };
  document.elementFromPoint = (x, y) => {
    const point = Number(x) + Number(y) * 0;
    const hits = [icon, name, avatar, row].filter((element) => {
      const box = boxes.get(element)!;
      return point >= 0 && x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
    });
    return hits[0] ?? null;
  };
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
  const result = await window.eval(buildBrowserAgentObservationScript({
    frameTreeNodeId: 1,
    frameRef: "main",
    frameBounds: { x: 0, y: 0, width: 800, height: 700 },
    strategy: "interactiveOnly",
    includeChildFrames: false,
    isMainFrame: true
  })) as { elements: Array<{ tagName: string; label: string; selectorPreview: string }> };
  const ids = result.elements.map((element) => element.selectorPreview);
  expect(ids.some((id) => id.includes("avatar"))).toBe(true);
  expect(ids.some((id) => id.includes("name"))).toBe(true);
  expect(ids.some((id) => id.includes("more") || result.elements.some((element) => element.tagName === "svg"))).toBe(true);
});

test("reads tab order without pressing Tab", async () => {
  const field = document.createElement("input");
  field.type = "text";
  field.placeholder = "Code";
  field.tabIndex = 1;
  document.body.append(field);
  const box = { x: 20, y: 900, width: 120, height: 24 };
  Element.prototype.getBoundingClientRect = function rect(): DOMRect {
    const here = this === field ? box : { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: here.x, y: here.y, width: here.width, height: here.height,
      top: here.y, left: here.x, right: here.x + here.width, bottom: here.y + here.height,
      toJSON() { return this; }
    } as DOMRect;
  };
  document.elementFromPoint = () => null;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
  const result = await window.eval(buildBrowserAgentObservationScript({
    frameTreeNodeId: 1,
    frameRef: "main",
    frameBounds: { x: 0, y: 0, width: 800, height: 600 },
    strategy: "interactiveOnly",
    includeChildFrames: false,
    isMainFrame: true
  })) as { elements: Array<{ tagName: string; label: string; semantics?: { context?: string[] } }> };
  expect(result.elements.some((element) => element.tagName === "input" && element.label === "Code")).toBe(true);
});

test("names the icon button at the top corner of a panel", async () => {
  const panel = document.createElement("div");
  panel.style.position = "fixed";
  const close = document.createElement("button");
  close.append(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
  const middle = document.createElement("button");
  middle.textContent = "Profile";
  panel.append(close, middle);
  document.body.append(panel);
  const boxes = new Map<Element, { x: number; y: number; width: number; height: number }>([
    [panel, { x: 180, y: 80, width: 440, height: 420 }],
    [close, { x: 584, y: 92, width: 32, height: 32 }],
    [middle, { x: 200, y: 160, width: 120, height: 36 }]
  ]);
  Element.prototype.getBoundingClientRect = function rect(): DOMRect {
    const here = boxes.get(this) ?? { x: 0, y: 0, width: 0, height: 0 };
    return {
      x: here.x, y: here.y, width: here.width, height: here.height,
      top: here.y, left: here.x, right: here.x + here.width, bottom: here.y + here.height,
      toJSON() { return this; }
    } as DOMRect;
  };
  document.elementFromPoint = (x, y) => {
    for (const element of [close, middle, panel]) {
      const box = boxes.get(element);
      if (box === undefined) continue;
      if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) return element;
    }
    return null;
  };
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 700 });
  const result = await window.eval(buildBrowserAgentObservationScript({
    frameTreeNodeId: 1,
    frameRef: "main",
    frameBounds: { x: 0, y: 0, width: 900, height: 700 },
    strategy: "interactiveOnly",
    includeChildFrames: false,
    isMainFrame: true
  })) as { elements: Array<{ tagName: string; label: string; semantics?: { context?: string[] } }> };
  expect(result.elements.some((element) => element.label === "(no label)" && element.semantics?.context?.includes("icon at the top corner of this panel"))).toBe(true);
  expect(result.elements.some((element) => element.label === "Profile")).toBe(true);
});
