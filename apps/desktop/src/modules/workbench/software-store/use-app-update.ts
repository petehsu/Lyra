import { useCallback, useEffect, useState } from "react";

import type { AppUpdateStatus, LyraDesktopApi } from "../../../shared/desktop-bridge";

export const useAppUpdate = (desktopApi: LyraDesktopApi | null) => {
  const [status, setStatus] = useState<AppUpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const api = desktopApi?.appUpdate;
    if (api === undefined) return undefined;
    void api.readStatus().then(setStatus).catch((error: unknown) => {
      console.warn("[lyra-software-store] failed to read app update status", error);
    });
    return api.onStatusChanged(setStatus);
  }, [desktopApi?.appUpdate]);
  const run = useCallback(async (operation: "check" | "download"): Promise<void> => {
    const api = desktopApi?.appUpdate;
    if (api === undefined) return;
    setBusy(true);
    try { setStatus(await api[operation]()); } finally { setBusy(false); }
  }, [desktopApi?.appUpdate]);
  const install = useCallback((): void => { void desktopApi?.appUpdate?.install(); }, [desktopApi?.appUpdate]);
  return { status, busy, check: () => run("check"), download: () => run("download"), install };
};
