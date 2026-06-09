import { useEffect, useRef, useState } from "react";

import type {
  LyraDesktopApi,
  SearchIndexState,
  SearchIndexStatusResponse
} from "../../../shared/desktop-bridge";
import { isSearchIndexReady } from "../browser-search/service";
import type { createTranslator } from "../i18n";
import type { WorkbenchNotificationModel } from "../notifications";

type UseLocalSearchIndexStatusParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly publishNotification: WorkbenchNotificationModel["publishNotification"];
  readonly t: ReturnType<typeof createTranslator>;
};

type LocalSearchIndexStatusModel = {
  readonly status: SearchIndexStatusResponse | null;
  readonly ready: boolean;
};

const ACTIVE_POLL_INTERVAL_MS = 2_000;
const READY_POLL_INTERVAL_MS = 15_000;

export const useLocalSearchIndexStatus = ({
  desktopApi,
  publishNotification,
  t
}: UseLocalSearchIndexStatusParams): LocalSearchIndexStatusModel => {
  const [status, setStatus] = useState<SearchIndexStatusResponse | null>(null);
  const previousStateRef = useRef<SearchIndexState | null>(null);

  useEffect(() => {
    const searchApi = desktopApi?.search;
    if (searchApi === undefined) {
      setStatus(null);
      previousStateRef.current = null;
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const publishStateTransition = (nextStatus: SearchIndexStatusResponse): void => {
      const previousState = previousStateRef.current;
      if (nextStatus.state === "building" && previousState !== "building") {
        publishNotification({
          id: "local-search-index-building",
          title: t("browser.localIndexBuildStartedTitle"),
          preview: t("browser.localIndexBuildStartedPreview"),
          level: "info",
          source: {
            id: "local-search-index",
            title: t("browser.localIndexNotificationSource"),
            iconKey: "system"
          },
          target: { kind: "none" }
        });
      }
      if (previousState === "building" && nextStatus.state === "ready") {
        publishNotification({
          id: "local-search-index-ready",
          title: t("browser.localIndexBuildCompleteTitle"),
          preview: t("browser.localIndexBuildCompletePreview"),
          level: "success",
          source: {
            id: "local-search-index",
            title: t("browser.localIndexNotificationSource"),
            iconKey: "system"
          },
          target: { kind: "none" }
        });
      }
      if (previousState === "building" && nextStatus.state === "failed") {
        publishNotification({
          id: "local-search-index-failed",
          title: t("browser.localIndexBuildFailedTitle"),
          preview: nextStatus.error ?? t("browser.localIndexBuildFailedPreview"),
          level: "error",
          source: {
            id: "local-search-index",
            title: t("browser.localIndexNotificationSource"),
            iconKey: "system"
          },
          target: { kind: "none" }
        });
      }
      previousStateRef.current = nextStatus.state;
    };

    const scheduleNextPoll = (nextStatus: SearchIndexStatusResponse | null): void => {
      const delay =
        nextStatus?.state === "ready"
          ? READY_POLL_INTERVAL_MS
          : ACTIVE_POLL_INTERVAL_MS;
      timer = window.setTimeout(() => {
        void poll();
      }, delay);
    };

    const poll = async (): Promise<void> => {
      try {
        const nextStatus = await searchApi.readIndexStatus();
        if (cancelled) {
          return;
        }
        setStatus(nextStatus);
        publishStateTransition(nextStatus);
        scheduleNextPoll(nextStatus);
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        console.warn(`[lyra-local-search] index status read failed ${String(error)}`);
        scheduleNextPoll(null);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [desktopApi?.search, publishNotification, t]);

  return {
    status,
    ready: isSearchIndexReady(status)
  };
};
