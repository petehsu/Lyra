import { describe, expect, test } from "vitest";

import { parseElementPickerConsoleMessage } from "../console-channel";
import { WORKBENCH_ELEMENT_PICKER_CONSOLE_PREFIX } from "../types";

describe("element picker console channel", () => {
  test("parses prefixed hover payloads", () => {
    const message = `${WORKBENCH_ELEMENT_PICKER_CONSOLE_PREFIX}${JSON.stringify({
      kind: "hover",
      frameTreeNodeId: 7,
      tagName: "textarea",
      selectorPreview: 'textarea[name="prompt"]',
      bounds: { x: 12, y: 24, width: 320, height: 48 },
      textSnippet: "发送消息..."
    })}`;

    expect(parseElementPickerConsoleMessage(message)).toEqual({
      kind: "hover",
      frameTreeNodeId: 7,
      tagName: "textarea",
      selectorPreview: 'textarea[name="prompt"]',
      bounds: { x: 12, y: 24, width: 320, height: 48 },
      textSnippet: "发送消息..."
    });
  });

  test("ignores unrelated console messages", () => {
    expect(parseElementPickerConsoleMessage("plain console output")).toBeNull();
    expect(parseElementPickerConsoleMessage(`${WORKBENCH_ELEMENT_PICKER_CONSOLE_PREFIX}{bad`)).toBeNull();
  });
});
