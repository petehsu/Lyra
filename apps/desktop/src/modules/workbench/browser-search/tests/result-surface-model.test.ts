import { describe, expect, test } from "vitest";

import {
  createWebResultViewModel,
  resolveLocalSearchStatusLabel,
  resolveOfficialCategoryLabel,
  resolveSearchResultChannelVisibility
} from "../result-surface-model";

describe("result surface model", () => {
  test("resolves source channel visibility", () => {
    expect(resolveSearchResultChannelVisibility("all")).toEqual({
      showWebResults: true,
      showLocalResults: true
    });
    expect(resolveSearchResultChannelVisibility("web")).toEqual({
      showWebResults: true,
      showLocalResults: false
    });
  });

  test("maps local channel status labels", () => {
    expect(resolveLocalSearchStatusLabel("loading", {
      idle: "Idle",
      loading: "Loading",
      ready: "Ready",
      error: "Error"
    })).toBe("Loading");
  });

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
      { id: "bing", label: "Bing", accentColor: "#008373" },
      { id: "unknown", label: "unknown", accentColor: "var(--lyra-text-accent)" }
    ]);
  });
});
