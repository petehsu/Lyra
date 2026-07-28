import { useEffect, useState } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

export const useWorkbenchWindowState = (
  desktopApi: Pick<LyraDesktopApi, "shellEvents"> | null
): {
  readonly isMaximized: boolean;
  readonly isFullScreen: boolean;
} => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    if (desktopApi === null) {
      return;
    }
    return desktopApi.shellEvents.onWindowStateChange((state) => {
      setIsMaximized(state.isMaximized);
      setIsFullScreen(state.isFullScreen === true);
    });
  }, [desktopApi]);

  return { isMaximized, isFullScreen };
};
