import { describe, expect, test } from "vitest";

import { searchLanguages } from "./language-picker-search";

const languages = [
  {
    locale: "zh-CN",
    nativeName: "简体中文",
    displayName: "Simplified Chinese",
    englishName: "Chinese",
    aliases: ["mandarin", "zhongwen"],
  },
  {
    locale: "en-US",
    nativeName: "English",
    displayName: "English (US)",
    englishName: "English",
    aliases: ["american", "en"],
  },
  {
    locale: "ja-JP",
    nativeName: "日本語",
    displayName: "Japanese",
    englishName: "Japanese",
    aliases: ["nihongo", "nihon", "jp"],
  },
  {
    locale: "ko-KR",
    nativeName: "한국어",
    displayName: "Korean",
    englishName: "Korean",
    aliases: ["hanguk", "hangugeo", "kr"],
  }
] as const;

describe("language picker search", () => {
  test("matches endonyms, locale codes, and romanized aliases", () => {
    expect(searchLanguages(languages, "日本").map((entry) => entry.locale)).toEqual(["ja-JP"]);
    expect(searchLanguages(languages, "ko kr")[0]?.locale).toBe("ko-KR");
    expect(searchLanguages(languages, "nihongo")[0]?.locale).toBe("ja-JP");
  });

  test("normalizes punctuation and ranks prefix matches ahead of fuzzy matches", () => {
    expect(searchLanguages(languages, "en us")[0]?.locale).toBe("en-US");
    expect(searchLanguages(languages, "jpn")[0]?.locale).toBe("ja-JP");
  });
});
