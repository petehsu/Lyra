import { describe, expect, test } from "vitest";

import {
  filterLauncherSearchItems,
  type LauncherSearchItem
} from "../launcher-search";

const createItem = (
  item: Omit<LauncherSearchItem, "targetApp"> & {
    readonly targetApp?: LauncherSearchItem["targetApp"];
  }
): LauncherSearchItem => ({
  ...item,
  targetApp: item.targetApp ?? null
});

describe("launcher search", () => {
  test("matches arbitrary chinese title with generated pinyin token", () => {
    const items: readonly LauncherSearchItem[] = [
      createItem({
        kind: "browser",
        label: "图片处理中心"
      }),
      createItem({
        kind: "terminal",
        label: "终端"
      })
    ];

    const results = filterLauncherSearchItems("tupian", items);
    expect(results[0]?.label).toBe("图片处理中心");
  });

  test("matches chinese title by generated pinyin initials", () => {
    const items: readonly LauncherSearchItem[] = [
      createItem({
        kind: "file-editor",
        label: "文本编辑器"
      })
    ];

    const results = filterLauncherSearchItems("wbbjq", items);
    expect(results).toHaveLength(1);
    expect(results[0]?.label).toBe("文本编辑器");
  });

  test("supports fuzzy and cross-language keyword matching", () => {
    const items: readonly LauncherSearchItem[] = [
      createItem({
        kind: "browser",
        label: "浏览器",
        keywords: ["browser", "web"]
      }),
      createItem({
        kind: "file-manager",
        label: "文件管理",
        keywords: ["explorer"]
      })
    ];

    const fuzzyResults = filterLauncherSearchItems("brwsr", items);
    expect(fuzzyResults[0]?.kind).toBe("browser");

    const englishResults = filterLauncherSearchItems("explorer", items);
    expect(englishResults[0]?.kind).toBe("file-manager");
  });
});

