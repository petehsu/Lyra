import { createClient } from "@supabase/supabase-js";
import { BrowserWindow, ipcMain } from "electron";

import {
  LYRA_CHANNELS,
  type ProductAnnouncement
} from "../../shared/desktop-bridge";
import { parseProductAnnouncementList } from "../../shared/product-announcements";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../auth/config";

const REFRESH_INTERVAL_MS = 60_000;

type ProductAnnouncementsIpcBridgeParams = {
  readonly getWindow: () => BrowserWindow | null;
};

export type ProductAnnouncementsIpcBridge = {
  readonly dispose: () => void;
};

export const createProductAnnouncementsIpcBridge = ({
  getWindow
}: ProductAnnouncementsIpcBridgeParams): ProductAnnouncementsIpcBridge => {
  const client = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false
        }
      })
    : null;

  let cache: readonly ProductAnnouncement[] = [];
  let disposed = false;
  let inflight: Promise<readonly ProductAnnouncement[]> | null = null;

  const publish = (items: readonly ProductAnnouncement[]): void => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.productAnnouncementsChanged, items);
  };

  const refresh = async (): Promise<readonly ProductAnnouncement[]> => {
    if (client === null || disposed) {
      return cache;
    }
    if (inflight !== null) {
      return inflight;
    }
    inflight = (async () => {
      const result = await client
        .from("product_announcements")
        .select("id,title,preview,body,body_kind,page_url,image_url,level,locale,published_at")
        .order("published_at", { ascending: false })
        .limit(50);
      if (result.error) {
        console.warn(`[lyra-announcements] fetch failed: ${result.error.message}`);
        return cache;
      }
      cache = parseProductAnnouncementList(result.data);
      publish(cache);
      return cache;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  };

  const channel = client === null
    ? null
    : client
      .channel("product-announcements")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_announcements" },
        () => {
          void refresh();
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn("[lyra-announcements] realtime channel error");
        }
      });

  const timer = setInterval(() => {
    void refresh();
  }, REFRESH_INTERVAL_MS);
  timer.unref();

  ipcMain.handle(LYRA_CHANNELS.productAnnouncementsRead, () => refresh());
  void refresh();

  return {
    dispose: () => {
      disposed = true;
      clearInterval(timer);
      ipcMain.removeHandler(LYRA_CHANNELS.productAnnouncementsRead);
      if (client !== null && channel !== null) {
        void client.removeChannel(channel);
      }
    }
  };
};
