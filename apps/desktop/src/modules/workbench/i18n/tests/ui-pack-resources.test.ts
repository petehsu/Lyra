import { act } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import i18n from "../i18n-instance";
import { setWorkbenchLocale } from "../locale-state";
import { createWorkbenchUiPackContext } from "../../ui-platform/service";
import {
  registerUiPackI18nResources,
  uiPackI18nNamespace
} from "../ui-pack-resources";

afterEach(() => {
  act(() => {
    setWorkbenchLocale("zh-CN");
  });
});

describe("UI pack translation resources", () => {
  test("isolates pack keys from the core namespace and releases them on unload", () => {
    setWorkbenchLocale("en-US");
    const namespace = uiPackI18nNamespace("external:acme.theme");
    const unregister = registerUiPackI18nResources("external:acme.theme", {
      "en-US": {
        "settings.pageTitle": "Overridden settings",
        "pack.header": "Acme theme"
      }
    });

    expect(i18n.getFixedT("en-US")("settings.pageTitle")).toBe("Settings");
    expect(i18n.getResource("en-US", namespace, "pack.header")).toBe("Acme theme");
    expect(
      createWorkbenchUiPackContext(null, undefined, "external:acme.theme")
        .i18n.t("pack.header")
    ).toBe("Acme theme");

    unregister();

    expect(i18n.getResource("en-US", namespace, "pack.header")).toBeUndefined();
  });
});
