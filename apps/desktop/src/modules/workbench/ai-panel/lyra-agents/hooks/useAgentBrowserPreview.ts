import { useCallback, useEffect, useState } from "react";

import type { AgentBrowserPreviewSnapshot } from "../../../../../shared/agent";
import type { LyraDesktopApi } from "../../../../../shared/desktop-bridge";
import {
  destroyAgentBrowserPreviewWatch,
  ensureParkedAgentBrowserPage,
  setAgentBrowserPreviewWatchTabIds
} from "./agent-browser-preview-workspace";

const PREVIEW_POLL_MS = 500;

export const openAgentBrowserPreviewTarget = (
  preview: AgentBrowserPreviewSnapshot,
  handlers: {
    readonly setActiveBrowserTab: (tabId: string) => boolean;
    readonly openUrlInWorkbench: (url: string, title?: string) => Promise<void> | void;
  }
): void => {
  if (preview.targetMode === "live") {
    if (handlers.setActiveBrowserTab(preview.tabId)) {
      return;
    }
    if (preview.url.length === 0) {
      return;
    }
    ensureParkedAgentBrowserPage({
      tabId: preview.tabId,
      address: preview.url,
      ...(preview.title.length === 0 ? {} : { titleHint: preview.title })
    });
    handlers.setActiveBrowserTab(preview.tabId);
    return;
  }
  if (preview.url.length === 0) {
    return;
  }
  void handlers.openUrlInWorkbench(
    preview.url,
    preview.title.length > 0 ? preview.title : undefined
  );
};

export type AgentBrowserPreviewView = {
  readonly items: readonly AgentBrowserPreviewSnapshot[];
  readonly promote: (tabId: string) => void;
  readonly dismiss: () => void;
};

export const useAgentBrowserPreview = ({
  desktopApi,
  isTurnRunning
}: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly isTurnRunning: boolean;
}): AgentBrowserPreviewView => {
  const [items, setItems] = useState<readonly AgentBrowserPreviewSnapshot[]>([]);

  useEffect(() => {
    const visible = isTurnRunning ? items : items.slice(0, 1);
    setAgentBrowserPreviewWatchTabIds(visible.map((item) => item.tabId));
  }, [isTurnRunning, items]);

  useEffect(() => () => {
    setAgentBrowserPreviewWatchTabIds([]);
  }, []);

  useEffect(() => {
    if (!isTurnRunning || desktopApi?.agent?.readAgentBrowserPreview === undefined) {
      return;
    }
    const readPreview = desktopApi.agent.readAgentBrowserPreview;
    let disposed = false;
    const poll = (): void => {
      void readPreview().then(
        (snapshots) => {
          if (!disposed) {
            setItems(Array.isArray(snapshots) ? snapshots : []);
          }
        },
        () => {
          if (!disposed) {
            setItems([]);
          }
        }
      );
    };
    poll();
    const timer = window.setInterval(poll, PREVIEW_POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [desktopApi, isTurnRunning]);

  const promote = useCallback((tabId: string): void => {
    setItems((current) => {
      const found = current.find((item) => item.tabId === tabId);
      if (found === undefined) {
        return current;
      }
      return [found, ...current.filter((item) => item.tabId !== tabId)];
    });
    void desktopApi?.agent?.promoteAgentBrowserPreview?.({ tabId });
  }, [desktopApi]);

  const dismiss = useCallback((): void => {
    const tabIds = items.map((item) => item.tabId);
    setItems([]);
    setAgentBrowserPreviewWatchTabIds([]);
    destroyAgentBrowserPreviewWatch(tabIds);
    void desktopApi?.agent?.dismissAgentBrowserPreview?.();
  }, [desktopApi, items]);

  return {
    items: isTurnRunning ? items : items.slice(0, 1),
    promote,
    dismiss
  };
};
