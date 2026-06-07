import { describe, expect, test } from "vitest";

import {
  DEFAULT_WORKBENCH_UI_PACK_ID,
  createWorkbenchUiPackOptions,
  isBuiltinWorkbenchUiPackId,
  isExternalWorkbenchUiPackId,
  isWorkbenchUiPackId,
  resolveWorkbenchUiPack,
  resolveWorkbenchUiPackId,
  syncWorkbenchUiPackToDocument,
  validateWorkbenchUiPack
} from "../service";

describe("workbench ui platform service", () => {
  test("resolves the built-in classic UI pack", () => {
    const pack = resolveWorkbenchUiPack();

    expect(DEFAULT_WORKBENCH_UI_PACK_ID).toBe("classic");
    expect(pack.manifest.id).toBe("classic");
    expect(pack.manifest.source.type).toBe("builtin");
    expect(pack.manifest.compatibility.workbenchUiApi).toBe("1");
    expect(pack.style.id).toBe("classic");
    expect(pack.adapters.shell).toBeTypeOf("function");
    expect(pack.adapters.workspaceTabs).toBeTypeOf("function");
    expect(pack.adapters.aiPanel).toBeTypeOf("function");
    expect(pack.adapters.terminalDock).toBeTypeOf("function");
    expect(pack.adapters.workspaceSurface).toBeTypeOf("function");
    expect(Object.keys(pack.adapters.surfaces).sort()).toEqual([
      "agentGit",
      "agentOvernight",
      "agentProjectTree",
      "agentSelfDev",
      "agentSessionHistory",
      "browserPage",
      "fileEditor",
      "fileManager",
      "imageViewer",
      "loginManager",
      "notificationCenter",
      "searchHome",
      "searchResults",
      "settings",
      "terminalWorkspace"
    ]);
    expect(pack.manifest.capabilities.supportsWorkbenchSurfaceAdapters).toBe(true);
    expect(pack.interactions.workspaceTabs.supportsRightDragSplit).toBe(true);
    expect(validateWorkbenchUiPack(pack)).toEqual({ valid: true, errors: [] });
  });

  test("validates and falls back UI pack ids", () => {
    expect(isWorkbenchUiPackId("classic")).toBe(true);
    expect(isBuiltinWorkbenchUiPackId("classic")).toBe(true);
    expect(isExternalWorkbenchUiPackId("external:acme.theme")).toBe(true);
    expect(isWorkbenchUiPackId("external:acme.theme")).toBe(true);
    expect(isWorkbenchUiPackId("unknown")).toBe(false);
    expect(resolveWorkbenchUiPackId("unknown")).toBe("classic");
    expect(resolveWorkbenchUiPackId("external:acme.theme")).toBe("external:acme.theme");
    expect(resolveWorkbenchUiPack("unknown").manifest.id).toBe("classic");
    expect(resolveWorkbenchUiPack("external:missing").manifest.id).toBe("classic");
  });

  test("builds localized UI pack options", () => {
    const options = createWorkbenchUiPackOptions((key) => key);

    expect(options).toEqual([
      {
        value: "classic",
        label: "settings.uiStyle.classic",
        description: "settings.uiStyleDescription.classic"
      }
    ]);
  });

  test("syncs UI pack identity to the document root", () => {
    syncWorkbenchUiPackToDocument(resolveWorkbenchUiPack("classic"));

    expect(document.documentElement).toHaveClass("lyra-style-classic");
    expect(document.documentElement.dataset.lyraUiPack).toBe("classic");
    expect(document.documentElement.dataset.lyraUiStyle).toBe("classic");
  });

  test("reports incomplete UI pack adapter contracts", () => {
    const pack = resolveWorkbenchUiPack("classic");
    const invalid = {
      ...pack,
      adapters: {
        ...pack.adapters,
        surfaces: {
          ...pack.adapters.surfaces,
          browserPage: undefined
        }
      }
    } as unknown as typeof pack;

    expect(validateWorkbenchUiPack(invalid)).toEqual({
      valid: false,
      errors: ["Missing surface adapter: browserPage"]
    });
  });

  test("reports required capability mismatches", () => {
    const pack = resolveWorkbenchUiPack("classic");
    const invalid = {
      ...pack,
      manifest: {
        ...pack.manifest,
        capabilities: {
          ...pack.manifest.capabilities,
          supportsShellAdapter: false
        }
      }
    };

    expect(validateWorkbenchUiPack(invalid)).toEqual({
      valid: false,
      errors: ["Missing required capability: supportsShellAdapter"]
    });
  });
});
