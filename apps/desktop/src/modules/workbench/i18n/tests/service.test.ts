import { describe, expect, test } from "vitest";

import { createTranslator } from "../service";
import type { I18nKey, WorkbenchLocale } from "../types";

describe("i18n translator", () => {
  test("returns localized string for zh-CN", () => {
    const t = createTranslator("zh-CN");
    expect(t("settings.pageTitle")).toBe("基本设置");
  });

  test("returns localized string for en-US", () => {
    const t = createTranslator("en-US");
    expect(t("settings.pageTitle")).toBe("Basic Settings");
  });

  test("falls back to en-US dictionary for unknown locale", () => {
    const t = createTranslator("unknown" as WorkbenchLocale);
    expect(t("settings.pageTitle")).toBe("Basic Settings");
  });

  test("falls back to en-US key text when key is missing in current locale", () => {
    const t = createTranslator("zh-CN");
    expect(t("totally.missing.key" as I18nKey)).toBeUndefined();
  });
});
