import type { LyraAppManifest } from "@lyra/capability-protocol";

import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";
import type { CapabilityRegistry } from "../registry";

const BROWSER_APP_ID = "browser";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

export const registerBrowserCapabilities = (
  registry: CapabilityRegistry,
  bridge: WorkbenchBrowserIpcBridge
): LyraAppManifest => {
  registry.register(
    {
      id: "browser.navigate",
      domain: "browser",
      kind: "action",
      title: "Navigate Browser",
      appId: BROWSER_APP_ID,
      operation: "navigate",
      permissions: ["browser:navigate", "network:http"],
      risk: "network",
      approvalMode: "ask",
      aiExposure: "hidden",
      inputSchema: {
        type: "object",
        required: ["address"],
        properties: {
          address: { type: "string" },
          tabId: { type: "string" },
          title: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      const address = typeof payload.address === "string" ? payload.address.trim() : "";
      if (address.length === 0) {
        throw new Error("address is required");
      }
      return await bridge.navigate({
        address,
        ...(typeof payload.tabId === "string" && payload.tabId.trim().length > 0
          ? { tabId: payload.tabId.trim() }
          : {}),
        ...(typeof payload.title === "string" && payload.title.trim().length > 0
          ? { title: payload.title.trim() }
          : {})
      });
    }
  );

  registry.register(
    {
      id: "browser.read_address",
      domain: "browser",
      kind: "resource",
      title: "Read Browser Address",
      appId: BROWSER_APP_ID,
      operation: "read_address",
      permissions: ["browser:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "hidden",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async (request) => {
      const payload = asRecord(request.payload);
      return bridge.readPageState(
        typeof payload.tabId === "string" && payload.tabId.trim().length > 0
          ? { tabId: payload.tabId.trim() }
          : undefined
      );
    }
  );

  registry.register(
    {
      id: "browser.capture_page",
      domain: "browser",
      kind: "resource",
      title: "Capture Browser Page",
      appId: BROWSER_APP_ID,
      operation: "capture_page",
      permissions: ["browser:read"],
      risk: "read",
      approvalMode: "auto",
      aiExposure: "hidden",
      inputSchema: {
        type: "object",
        properties: {
          tabId: { type: "string" }
        },
        additionalProperties: false
      },
      outputSchema: {
        type: "object"
      }
    },
    async () => ({
      ok: false,
      reason: "unsupported",
      message: "browser.capture_page is unsupported in workbench-native Agent v1."
    })
  );

  return {
    id: BROWSER_APP_ID,
    title: "Browser",
    version: "0.1.0",
    source: "builtin",
    permissions: ["browser:navigate", "browser:read", "network:http"],
    capabilities: [
      "browser.navigate",
      "browser.read_address",
      "browser.capture_page"
    ],
    compatibility: {
      minApiVersion: "0.1.0",
      platforms: ["macos", "windows", "linux"]
    },
    contributes: {
      surfaces: ["workspace"]
    }
  };
};
