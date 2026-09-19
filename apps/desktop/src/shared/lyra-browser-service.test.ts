import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { LYRA_BROWSER_CDP_PROTOCOL_VERSION } from "./lyra-browser-api";
import {
  isLyraBrowserServiceComponentId,
  isLyraBrowserServiceName,
  LYRA_BROWSER_SERVICE_API,
  LYRA_BROWSER_SERVICE_CDP_INSPECTOR,
  LYRA_BROWSER_SERVICE_CDP_PROTOCOL_VERSION,
  LYRA_BROWSER_SERVICE_ELECTRON_ADAPTER,
  LYRA_BROWSER_SERVICE_EXCLUDED_COMPONENT_IDS,
  LYRA_BROWSER_SERVICE_NAME,
  LYRA_BROWSER_SERVICE_SPAWN_POLICY,
  LYRA_BROWSER_SERVICE_TRANSPORT
} from "./lyra-browser-service";

const here = dirname(fileURLToPath(import.meta.url));
const readRepoSource = (relativeFromRepo: string): string =>
  readFileSync(join(here, "../../../..", relativeFromRepo), "utf8");

describe("lyra-browser-service process boundary", () => {
  test("engine process is not lyrad and not the lyra.browser app component", () => {
    expect(LYRA_BROWSER_SERVICE_NAME).toBe("lyra-browser-service");
    expect(LYRA_BROWSER_SERVICE_SPAWN_POLICY).toBe("onDemand");
    expect(LYRA_BROWSER_SERVICE_TRANSPORT).toBe("cdp");
    expect(LYRA_BROWSER_SERVICE_API).toBe("LyraBrowserApi");
    expect(LYRA_BROWSER_SERVICE_CDP_PROTOCOL_VERSION).toBe(LYRA_BROWSER_CDP_PROTOCOL_VERSION);
    expect(LYRA_BROWSER_SERVICE_CDP_PROTOCOL_VERSION).toBe("1.3");
    expect(LYRA_BROWSER_SERVICE_CDP_INSPECTOR).toBe("@lyra/browser-automation");
    expect([...LYRA_BROWSER_SERVICE_EXCLUDED_COMPONENT_IDS]).toEqual([
      "lyra.runtime",
      "lyra.browser"
    ]);
    expect(isLyraBrowserServiceName(LYRA_BROWSER_SERVICE_NAME)).toBe(true);
    expect(isLyraBrowserServiceComponentId("lyra.runtime")).toBe(false);
    expect(isLyraBrowserServiceComponentId("lyra.browser")).toBe(false);
    expect(isLyraBrowserServiceComponentId(LYRA_BROWSER_SERVICE_NAME)).toBe(true);
  });

  test("CDP inspector stays Electron-free; Electron view manager remains the adapter", () => {
    const inspector = readRepoSource(
      "services/browser-automation/src/modules/cdp_inspector/index.ts"
    );
    expect(inspector).not.toMatch(/from\s+["']electron["']/);
    expect(LYRA_BROWSER_SERVICE_ELECTRON_ADAPTER).toBe(
      "apps/desktop/src/main/workbench-browser"
    );
    const debuggerSource = readRepoSource(
      "apps/desktop/src/main/workbench-browser/debugger.ts"
    );
    expect(debuggerSource).toMatch(/webContents:\s*WebContents/);
    const layoutSource = readRepoSource(
      "apps/desktop/src/main/workbench-browser/view-manager-runtime/layout-controller.ts"
    );
    expect(layoutSource).toMatch(/addChildView/);
    const contract = readRepoSource("docs/contracts/lyra-browser-service.md");
    expect(contract).toMatch(/lyra-browser-service/);
    expect(contract).toMatch(/lyra\.runtime/);
    expect(contract).toMatch(/lyra\.browser/);
  });
});
