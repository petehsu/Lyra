import { expect, test } from "vitest";
import { browserKeyEvents, browserKeyRepeat, isBrowserNavigationKey, dispatchBrowserKeys } from "../view-manager-runtime/agent-keyboard";

test("Electron shortcuts carry modifiers separately and never type shortcut letters", () => {
  expect(browserKeyEvents("Control+b")).toEqual([
    { type: "keyDown", keyCode: "b", modifiers: ["control"] },
    { type: "keyUp", keyCode: "b", modifiers: ["control"] }
  ]);
  expect(browserKeyEvents("Shift+ArrowLeft")[0]).toEqual({ type: "keyDown", keyCode: "Left", modifiers: ["shift"] });
  expect(browserKeyEvents("Alt+Meta+Enter")[0]).toEqual({ type: "keyDown", keyCode: "Enter", modifiers: ["alt", "meta"] });
  expect(browserKeyEvents("Control++")[0]).toEqual({ type: "keyDown", keyCode: "+", modifiers: ["control"] });
  expect(browserKeyEvents("a").map(event => event.type)).toEqual(["keyDown", "char", "keyUp"]);
  expect(() => browserKeyEvents("unknown+Enter")).toThrow();
});

test("only caret/navigation operations can repeat in one key call", () => {
  expect(browserKeyRepeat("Shift+ArrowLeft", 5)).toBe(5);
  for (const key of ["Enter", "Control+Enter", "Backspace", "a", "Tab"]) expect(() => browserKeyRepeat(key, 2)).toThrow();
  expect(() => browserKeyRepeat("ArrowUp", 51)).toThrow();
});


test.each(["Shift+Left", "shift+left", "SHIFT+ARROWLEFT"])("key aliases share dispatch, repeat and observation semantics: %s", key => {
  expect(browserKeyEvents(key)).toEqual(browserKeyEvents("Shift+ArrowLeft"));
  expect(browserKeyRepeat(key, 7)).toBe(7);
  expect(isBrowserNavigationKey(key)).toBe(true);
});

test.each(["enter", "RETURN", "space", "alt+left", "ctrl+tab", "shift+escape", "Backspace", "Control+b"])("aliases never bypass activation or repeat guards: %s", key => {
  expect(isBrowserNavigationKey(key)).toBe(false);
  expect(() => browserKeyRepeat(key, 2)).toThrow();
});


test("a failed or cancelled key-down still releases the key", () => {
  const received: string[] = [];
  expect(() => dispatchBrowserKeys(browserKeyEvents("Shift+ArrowLeft"), event => {
    received.push(event.type);
    if (event.type === "keyDown") throw new Error("takeover");
  })).toThrow("takeover");
  expect(received).toEqual(["keyDown", "keyUp"]);
});
