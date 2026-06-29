import { describe, expect, test } from "vitest";

import {
  createWebResultViewModel,
  resolveOfficialCategoryLabel
} from "../result-surface-model";

describe("result surface model", () => {
  test("builds web result labels and engine chips", () => {
    const model = createWebResultViewModel(
      {
        id: "result-1",
        title: "Docs",
        url: "https://docs.lyra.test",
        displayUrl: "docs.lyra.test",
        snippet: "Docs",
        sourceEngineIds: ["bing", "unknown"],
        isOfficialResult: true,
        officialCategory: "official_docs"
      },
      new Map([["bing", { id: "bing", label: "Bing", accentColor: "#008373" }]]),
      {
        fallback: "Official",
        homepage: "Homepage",
        subsite: "Subsite",
        docs: "Docs",
        login: "Login",
        download: "Download",
        support: "Support"
      }
    );

    expect(resolveOfficialCategoryLabel(undefined, {
      fallback: "Official",
      homepage: "Homepage",
      subsite: "Subsite",
      docs: "Docs",
      login: "Login",
      download: "Download",
      support: "Support"
    })).toBe("Official");
    expect(model.officialCategoryLabel).toBe("Docs");
    expect(model.sourceChips).toEqual([
      { id: "bing", label: "Bing" },
      { id: "unknown", label: "unknown" }
    ]);
  });
});