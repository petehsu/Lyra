import { session } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  WORKBENCH_BROWSER_ISOLATED_PROFILE_PARTITION,
  WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION
} from "../../shared/workbench-browser";

const BROWSER_PAGE_FRAME_PRELOAD_ID = "lyra-browser-page-frame";

export const resolveBrowserPageFramePreloadPath = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), "../preload/browser-page-frame.cjs");

export const registerBrowserPageFramePreload = (): void => {
  const filePath = resolveBrowserPageFramePreloadPath();
  const partitions = [
    WORKBENCH_BROWSER_LIVE_PROFILE_PARTITION,
    WORKBENCH_BROWSER_ISOLATED_PROFILE_PARTITION
  ] as const;

  for (const partition of partitions) {
    const browserSession = session.fromPartition(partition);
    try {
      browserSession.unregisterPreloadScript(`${BROWSER_PAGE_FRAME_PRELOAD_ID}:${partition}`);
    } catch (_error) {
      // First boot: nothing to unregister.
    }
    browserSession.registerPreloadScript({
      id: `${BROWSER_PAGE_FRAME_PRELOAD_ID}:${partition}`,
      type: "frame",
      filePath
    });
  }
};