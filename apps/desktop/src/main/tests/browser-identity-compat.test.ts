import { describe, expect, test, vi } from "vitest";

import {
  BROWSER_IDENTITY_FEDCM_FEATURE,
  configureBrowserIdentityCompatibility,
  sanitizeBrowserCompatibleUserAgent
} from "../browser-identity-compat";

describe("browser identity compatibility", () => {
  test("removes Electron and Lyra tokens while preserving the Chrome user agent", () => {
    expect(
      sanitizeBrowserCompatibleUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) LyraDesktop/0.1.0 Chrome/142.0.0.0 Electron/41.2.0 Safari/537.36"
      )
    ).toBe(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"
    );
  });

  test("disables FedCM so Google Identity Services can use the iframe prompt fallback", () => {
    const appendSwitch = vi.fn();
    const app = {
      commandLine: { appendSwitch },
      userAgentFallback:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Electron/41.2.0 Safari/537.36"
    };

    configureBrowserIdentityCompatibility(app);

    expect(appendSwitch).toHaveBeenCalledWith("disable-features", BROWSER_IDENTITY_FEDCM_FEATURE);
    expect(app.userAgentFallback).not.toContain("Electron/");
  });
});
