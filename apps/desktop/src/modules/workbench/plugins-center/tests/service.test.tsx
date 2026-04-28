import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import { usePluginsCenterModel } from "../service";

const samplePlugin = {
  id: "sample@test",
  name: "sample",
  source: { type: "local", path: "/marketplace/sample" },
  installed: false,
  enabled: false,
  installPolicy: "AVAILABLE",
  authPolicy: "ON_USE",
  interface: {
    displayName: "Sample Plugin",
    shortDescription: "A test plugin",
    longDescription: null,
    developerName: null,
    category: null,
    capabilities: ["skills", "mcp"],
    websiteUrl: null,
    privacyPolicyUrl: null,
    termsOfServiceUrl: null,
    defaultPrompt: null,
    brandColor: null,
    composerIcon: null,
    composerIconUrl: null,
    logo: null,
    logoUrl: null,
    screenshots: [],
    screenshotUrls: [],
  },
} as const;

const pluginListResponse = {
  marketplaces: [
    {
      name: "local",
      path: "/marketplace/plugins.json",
      interface: { displayName: "Local Marketplace" },
      plugins: [
        samplePlugin,
      ],
    },
  ],
  marketplaceLoadErrors: [],
  featuredPluginIds: [],
};

const pluginDetailResponse = {
  plugin: {
    marketplaceName: "local",
    marketplacePath: "/marketplace/plugins.json",
    summary: samplePlugin,
    description: "Detailed plugin",
    skills: [],
    apps: [],
    mcpServers: ["sample-server"],
  },
};

describe("plugins center model", () => {
  test("routes plugin runtime calls and config enablement", async () => {
    const request = vi.fn(async (payload: { readonly method: string }) => {
      if (payload.method === "plugin/list") {
        return pluginListResponse;
      }
      if (payload.method === "plugin/read") {
        return pluginDetailResponse;
      }
      if (payload.method === "plugin/install") {
        return { authPolicy: "ON_USE", appsNeedingAuth: [] };
      }
      if (payload.method === "config/batchWrite") {
        return {};
      }
      throw new Error(`Unexpected method: ${payload.method}`);
    });
    const desktopApi = { lyra: { request } } as unknown as LyraDesktopApi;

    const { result } = renderHook(() =>
      usePluginsCenterModel({
        desktopApi,
        projectHintPath: "/repo",
      })
    );

    await waitFor(() => {
      expect(result.current.state.status).toBe("ready");
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: "plugin/list",
      params: { cwds: ["/repo"] },
    }));
    expect(result.current.state.selectedPluginKey).toBe("local:sample@test");

    await act(async () => {
      await result.current.readPlugin("local:sample@test");
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: "plugin/read",
      params: {
        marketplacePath: "/marketplace/plugins.json",
        pluginName: "sample",
      },
    }));

    await act(async () => {
      await result.current.installPlugin("local:sample@test");
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: "plugin/install",
      params: {
        marketplacePath: "/marketplace/plugins.json",
        pluginName: "sample",
      },
    }));

    await act(async () => {
      await result.current.setPluginEnabled("local:sample@test", true);
    });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: "config/batchWrite",
      params: {
        edits: [
          {
            keyPath: "plugins.sample@test.enabled",
            value: true,
            mergeStrategy: "upsert",
          },
        ],
        reloadUserConfig: true,
      },
    }));
  });
});
