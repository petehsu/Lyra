import { describe, expect, it } from "vitest";

import { visibleAssistantText } from "./message-view-model";

describe("visibleAssistantText", () => {
  it("preserves markdown newlines so block structure survives rendering", () => {
    const input = "# 标题\n\n正文一段。\n\n## 小节\n\n- 项 1\n- 项 2";
    expect(visibleAssistantText(input)).toBe(input);
  });

  it("collapses runs of spaces/tabs within a line but keeps newlines", () => {
    const input = "这是一段   带多余空格的文本。\n\n## 列表";
    expect(visibleAssistantText(input)).toBe("这是一段 带多余空格的文本。\n\n## 列表");
  });

  it("strips internal protocol markers without flattening newlines", () => {
    const input = "# 标题\n\n正文。 [Tool result ref: call_abc]\n\n## 小节";
    expect(visibleAssistantText(input)).toBe("# 标题\n\n正文。\n\n## 小节");
  });

  it("trims trailing whitespace on each line", () => {
    const input = "行一   \n行二\t\n行三";
    expect(visibleAssistantText(input)).toBe("行一\n行二\n行三");
  });
});
