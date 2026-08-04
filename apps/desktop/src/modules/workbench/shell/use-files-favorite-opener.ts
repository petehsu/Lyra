import { useCallback } from "react";

import type { FileManagerFavorite } from "../../../shared/file-manager";

export const useFilesFavoriteOpener = ({
  openAgentSession,
  openPage,
  isLeftPanelVisible,
  beginPanelAnimation,
  toggleLeftPanel
}: {
  readonly openAgentSession: (sessionId: string) => void;
  readonly openPage: (address: string, title?: string) => unknown;
  readonly isLeftPanelVisible: boolean;
  readonly beginPanelAnimation: () => void;
  readonly toggleLeftPanel: () => void;
}): ((favorite: FileManagerFavorite) => void) => useCallback((favorite) => {
  if (favorite.kind === "web") {
    const address = (favorite.url ?? favorite.path).trim();
    if (address.length > 0) {
      openPage(address, favorite.title);
    }
    return;
  }
  if (favorite.kind !== "agent-session") {
    return;
  }
  const sessionId = (favorite.sessionId
    ?? favorite.path.replace(/^agent-session:/u, "")).trim();
  if (sessionId.length === 0) {
    return;
  }
  openAgentSession(sessionId);
  if (!isLeftPanelVisible) {
    beginPanelAnimation();
    toggleLeftPanel();
  }
}, [
  beginPanelAnimation,
  isLeftPanelVisible,
  openAgentSession,
  openPage,
  toggleLeftPanel
]);
