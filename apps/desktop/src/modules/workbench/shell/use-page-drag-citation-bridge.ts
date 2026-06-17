import { useEffect } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import {
  clearPageDragCitationPayload,
  registerPageDragCitationMainBridge,
  setActivePageDragCitationPayload
} from "../browser-tabs/page-drag-transfer";
import { setPageDragCitationSessionActive } from "../browser-tabs/page-drag-citation-session";

type UsePageDragCitationBridgeParams = {
  readonly desktopApi: LyraDesktopApi | null;
};

export const usePageDragCitationBridge = ({
  desktopApi
}: UsePageDragCitationBridgeParams): void => {
  useEffect(() => {
    if (desktopApi === null) {
      registerPageDragCitationMainBridge(null);
      setPageDragCitationSessionActive(false);
      return;
    }

    registerPageDragCitationMainBridge({
      readActive: () => desktopApi.workbenchBrowser.readActivePageDragCitation(),
      consume: () => {
        desktopApi.workbenchBrowser.consumePageDragCitation();
      }
    });

    const hydrateFromMain = (): void => {
      const payload = desktopApi.workbenchBrowser.readActivePageDragCitation();
      if (payload === null) {
        clearPageDragCitationPayload();
        setPageDragCitationSessionActive(false);
        return;
      }
      setActivePageDragCitationPayload(payload);
    };

    hydrateFromMain();

    return desktopApi.workbenchBrowser.onEvent((event) => {
      if (event.kind === "page-drag-citation-active") {
        setActivePageDragCitationPayload(event.payload);
        return;
      }
      if (event.kind === "page-drag-citation-clear") {
        clearPageDragCitationPayload();
      }
    });
  }, [desktopApi]);
};