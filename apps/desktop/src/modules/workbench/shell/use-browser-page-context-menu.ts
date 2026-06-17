import { useEffect, type MutableRefObject } from "react";

import type { AgentPageCitation } from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import { buildPageCitationFromContextMenu } from "../ai-panel/lyra-agents/features/chat/page-citation";

export type ComposerCitationSink = {
  readonly addPageCitation: (citation: AgentPageCitation) => void;
};

type UseBrowserPageContextMenuParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly composerCitationSinkRef: MutableRefObject<ComposerCitationSink | null>;
};

export const useBrowserPageContextMenu = ({
  desktopApi,
  composerCitationSinkRef
}: UseBrowserPageContextMenuParams): void => {
  useEffect(() => {
    if (desktopApi === null) return;
    return desktopApi.workbenchBrowser.onEvent((event) => {
      if (event.kind !== "page-context-menu-select" || event.itemId !== "cite-page") {
        return;
      }
      const tabTitle = event.tabTitle?.trim() || event.menu.pageTitle;
      composerCitationSinkRef.current?.addPageCitation(
        buildPageCitationFromContextMenu(event.menu, tabTitle)
      );
    });
  }, [composerCitationSinkRef, desktopApi]);
};