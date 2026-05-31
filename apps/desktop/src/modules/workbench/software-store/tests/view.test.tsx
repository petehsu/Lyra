import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  LyraSoftwareManifest,
  LyraDesktopApi,
  UiuxListPacksResponse
} from "../../../../shared/desktop-bridge";
import { createTranslator } from "../../i18n";
import { useWorkbenchLabels } from "../../shell/use-workbench-labels";
import { SoftwareStoreSurface } from "../view";
import type { SoftwareStoreSurfaceProps } from "../types";
import type { SoftwareCapabilitiesRegistryModel } from "../../software-capabilities";

const createLabels = () => {
  const { result } = renderHook(() => useWorkbenchLabels(createTranslator("en-US")));
  return result.current.softwareStore;
};

const createResponse = (
  installed: UiuxListPacksResponse["installed"] = []
): UiuxListPacksResponse => ({
  builtin: [
    {
      id: "classic",
      name: "Classic",
      description: "Current Lyra desktop layout and visual language."
    }
  ],
  installed
});

const createInstalledPack = (
  trustState: "trusted" | "untrusted" | "revoked"
): UiuxListPacksResponse["installed"][number] => ({
  id: "external:ocean.ui",
  manifest: {
    id: "external:ocean.ui",
    name: "Ocean UI",
    version: "1.2.3",
    description: "Ocean theme",
    entry: "entry.js",
    workbenchUiApi: "1",
    permissions: ["workbench.ui"],
    software: []
  },
  source: {
    kind: "git",
    url: "https://example.test/ocean.git"
  },
  packagePath: "/packs/ocean",
  entryPath: "/packs/ocean/entry.js",
  sourceFingerprint: "abc123",
  trustState,
  installedAt: "2026-05-25T00:00:00Z",
  updatedAt: "2026-05-25T00:05:00Z"
});

const createDesktopApi = (
  response: UiuxListPacksResponse
): {
  readonly api: LyraDesktopApi;
  readonly listPacks: ReturnType<typeof vi.fn>;
  readonly installFromLocal: ReturnType<typeof vi.fn>;
  readonly setTrustState: ReturnType<typeof vi.fn>;
  readonly requestActivation: ReturnType<typeof vi.fn>;
} => {
  const listPacks = vi.fn(async () => response);
  const installFromLocal = vi.fn(async () => createInstalledPack("untrusted"));
  const setTrustState = vi.fn(async () => createInstalledPack("trusted"));
  const uninstall = vi.fn(async ({ packId }: { readonly packId: string }) => ({
    packId,
    removed: true
  }));
  const requestActivation = vi.fn(async ({ packId }: { readonly packId: string }) => ({
    packId,
    reloadRequired: packId !== "classic",
    activated: packId === "classic"
  }));
  return {
    api: {
      files: {
        selectDirectories: vi.fn(async () => [
          {
            name: "pack",
            path: "/Users/tester/pack",
            kind: "directory" as const
          }
        ])
      },
      uiux: {
        listPacks,
        installFromLocal,
        installFromGit: vi.fn(),
        installFromNpm: vi.fn(),
        setTrustState,
        uninstall,
        requestActivation,
        resolveRuntime: vi.fn()
      }
    } as unknown as LyraDesktopApi,
    listPacks,
    installFromLocal,
    setTrustState,
    requestActivation
  };
};

const createSoftwareCapabilities = (
  labels: ReturnType<typeof createLabels>
): SoftwareCapabilitiesRegistryModel => {
  const software: readonly LyraSoftwareManifest[] = labels.builtinApps.map((app) => ({
    id: app.id,
    title: app.title,
    description: app.description,
    category: app.category,
    version: "1.0.0",
    source: "builtin" as const,
    actions: app.id === "file-manager"
      ? [{
          id: "file-manager.openHome",
          title: "Open Home",
          description: "Open home",
          risk: "navigate" as const
        }]
      : []
  }));
  return {
    software,
    loading: false,
    error: null,
    refresh: vi.fn(async () => undefined),
    handleBridgeQuery: vi.fn(),
    createUiPackCapabilities: vi.fn(() => ({
      software: [],
      registerActionHandler: vi.fn(() => vi.fn())
    }))
  };
};

const renderStore = (
  response: UiuxListPacksResponse,
  overrides: Partial<SoftwareStoreSurfaceProps> = {}
) => {
  const { api, ...calls } = createDesktopApi(response);
  const labels = createLabels();
  const props: SoftwareStoreSurfaceProps = {
    desktopApi: api,
    labels,
    softwareCapabilities: createSoftwareCapabilities(labels),
    activeUiPackId: "classic",
    onUiPackIdChange: vi.fn(),
    onOpenBuiltinApp: vi.fn(),
    ...overrides
  };
  render(<SoftwareStoreSurface {...props} />);
  return { props, ...calls };
};

describe("SoftwareStoreSurface", () => {
  test("shows built-in software and opens supported built-in apps", async () => {
    const onOpenBuiltinApp = vi.fn();
    renderStore(createResponse(), { onOpenBuiltinApp });

    fireEvent.click(await screen.findByRole("button", { name: /File Manager/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    expect(onOpenBuiltinApp).toHaveBeenCalledWith("file-manager");
  });

  test("installs a local UIUX pack through the existing bridge", async () => {
    const { installFromLocal } = renderStore(createResponse());

    fireEvent.click(await screen.findByRole("button", { name: "Install local pack" }));

    await waitFor(() => {
      expect(installFromLocal).toHaveBeenCalledWith({
        sourcePath: "/Users/tester/pack"
      });
    });
  });

  test("trusts and activates installed UIUX packs", async () => {
    const setUiPackId = vi.fn();
    const { setTrustState, requestActivation } = renderStore(
      createResponse([createInstalledPack("trusted")]),
      { onUiPackIdChange: setUiPackId }
    );

    fireEvent.click(await screen.findByRole("button", { name: /Ocean UI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke trust" }));

    await waitFor(() => {
      expect(setTrustState).toHaveBeenCalledWith({
        packId: "external:ocean.ui",
        trustState: "revoked"
      });
    });
    await screen.findByText("Operation completed.");

    fireEvent.click(screen.getByRole("button", { name: "Activate" }));

    await waitFor(() => {
      expect(requestActivation).toHaveBeenCalledWith({
        packId: "external:ocean.ui"
      });
      expect(setUiPackId).toHaveBeenCalledWith("external:ocean.ui");
    });
  });
});
