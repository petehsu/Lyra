import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { LyraSoftwareManifest } from "../../../../shared/desktop-bridge";
import { createTranslator } from "../../i18n";
import { useWorkbenchLabels } from "../../shell/use-workbench-labels";
import { useSoftwareCapabilitiesRegistry } from "../service";

const createLabels = () => {
  const { result } = renderHook(() => useWorkbenchLabels(createTranslator("en-US")));
  return result.current.softwareStore;
};

const createRegistry = () => {
  const labels = createLabels();
  return renderHook(() =>
    useSoftwareCapabilitiesRegistry({
      desktopApi: null,
      labels,
      activeUiPackId: "external:acme.tools",
      tabsModel: {
        openPageInNewTab: vi.fn(),
        navigateResolvedInput: vi.fn(),
        openAppTab: vi.fn()
      } as never,
      fileManagerModel: {
        createInstance: vi.fn(),
        openHome: vi.fn(),
        openDirectory: vi.fn()
      } as never,
      onOpenSettingsSection: vi.fn()
    })
  );
};

describe("software capability registry", () => {
  test("rejects external handlers for undeclared actions", () => {
    const { result } = createRegistry();
    const software: readonly LyraSoftwareManifest[] = [
      {
        id: "external:acme.tools:mail",
        title: "Mail",
        description: "Mail tools",
        source: "uiux",
        sourceId: "external:acme.tools",
        actions: [
          {
            id: "external:acme.tools:mail.open",
            title: "Open",
            description: "Open mailbox",
            risk: "navigate"
          }
        ]
      }
    ];
    const capabilities = result.current.createUiPackCapabilities(
      "external:acme.tools",
      software
    );

    expect(() => {
      capabilities.registerActionHandler("external:acme.tools:mail.delete", vi.fn());
    }).toThrow("Action is not declared");

    let dispose: (() => void) | undefined;
    act(() => {
      dispose = capabilities.registerActionHandler(
        "external:acme.tools:mail.open",
        vi.fn()
      );
    });
    act(() => {
      dispose?.();
    });
  });
});
