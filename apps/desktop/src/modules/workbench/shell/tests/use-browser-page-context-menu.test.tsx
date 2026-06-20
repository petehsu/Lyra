import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import type { WorkbenchBrowserEvent } from "../../../../shared/workbench-browser";
import type { ComposerCitationSink } from "../use-browser-page-context-menu";
import { useBrowserPageContextMenu } from "../use-browser-page-context-menu";

describe("useBrowserPageContextMenu", () => {
  test("adds element picker selections to the composer as page citations", () => {
    const listeners: Array<(event: WorkbenchBrowserEvent) => void> = [];
    const addPageCitation = vi.fn();
    const desktopApi = {
      workbenchBrowser: {
        onEvent: vi.fn((nextListener: (event: WorkbenchBrowserEvent) => void) => {
          listeners.push(nextListener);
          return () => undefined;
        })
      }
    } as unknown as LyraDesktopApi;
    const composerCitationSinkRef = {
      current: { addPageCitation }
    } satisfies { current: ComposerCitationSink | null };

    renderHook(() =>
      useBrowserPageContextMenu({
        desktopApi,
        composerCitationSinkRef
      })
    );

    const listener = listeners[0];
    if (listener === undefined) {
      throw new Error("workbench browser listener was not registered");
    }

    listener({
      kind: "element-picker-select",
      tabTitle: "Docs",
      menu: {
        tabId: "browser-tab-1",
        anchorX: 10,
        anchorY: 20,
        pageUrl: "https://example.com/docs",
        pageTitle: "Docs",
        frameUrl: "https://example.com/docs",
        mediaType: "none",
        isEditable: false,
        canGoBack: false,
        canGoForward: false,
        selectionText: "Install Lyra",
        elementTag: "button",
        elementSelector: "#app > button:nth-of-type(1)",
        elementRole: "button",
        elementAriaLabel: "Install"
      }
    });

    expect(addPageCitation).toHaveBeenCalledTimes(1);
    expect(addPageCitation.mock.calls[0]?.[0]).toMatchObject({
      tabId: "browser-tab-1",
      tabTitle: "Docs",
      pageUrl: "https://example.com/docs",
      excerptKind: "selection",
      quotedText: "Install Lyra",
      elementSelector: "#app > button:nth-of-type(1)",
      sourceKind: "browser"
    });
  });
});
