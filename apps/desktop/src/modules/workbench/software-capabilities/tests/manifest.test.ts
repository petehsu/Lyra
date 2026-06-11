import {
  describe,
  expect,
  test
} from "vitest";

import type { SoftwareStoreLabels } from "../../software-store/types";
import {
  createBuiltinSoftware,
  isHighRiskCapability,
  softwareWithoutSchemas
} from "../manifest";

const labels = {
  builtinApps: [
    {
      id: "browser-search",
      title: "Browser Search",
      description: "Search and browse",
      category: "Web"
    },
    {
      id: "login-manager",
      title: "Login Manager",
      description: "Manage logins",
      category: "Security"
    }
  ]
} as unknown as SoftwareStoreLabels;

describe("software capability manifests", () => {
  test("creates builtin actions with stable ids and schemas", () => {
    const software = createBuiltinSoftware(labels);
    const browser = software.find((entry) => entry.id === "browser-search");
    const loginManager = software.find((entry) => entry.id === "login-manager");

    expect(browser?.actions.map((action) => action.id)).toEqual([
      "browser-search.openUrl",
      "browser-search.search",
      "browser-search.readState",
      "browser-search.readCurrentPage",
      "browser-search.searchInPage",
      "browser-search.readDownloads"
    ]);
    expect(browser?.actions[0]?.inputSchema).toMatchObject({
      required: ["url"]
    });
    expect(loginManager?.actions.map((action) => action.id)).toEqual([
      "login-manager.readState",
      "login-manager.open",
      "login-manager.logoutSite",
      "login-manager.updateAuthMethod",
      "login-manager.fillCredential"
    ]);
  });

  test("removes schemas from lightweight capability lists", () => {
    const software = createBuiltinSoftware(labels);
    const lightweight = softwareWithoutSchemas(software);
    const openUrl = lightweight
      .find((entry) => entry.id === "browser-search")
      ?.actions.find((action) => action.id === "browser-search.openUrl");

    expect(openUrl).toMatchObject({
      id: "browser-search.openUrl",
      risk: "navigate"
    });
    expect(openUrl).not.toHaveProperty("inputSchema");
  });

  test("classifies write, external, and destructive capabilities as high risk", () => {
    expect(isHighRiskCapability("read")).toBe(false);
    expect(isHighRiskCapability("navigate")).toBe(false);
    expect(isHighRiskCapability("write")).toBe(true);
    expect(isHighRiskCapability("external")).toBe(true);
    expect(isHighRiskCapability("destructive")).toBe(true);
  });
});
