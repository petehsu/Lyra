import { useEffect, useRef, useState } from "react";

import type { WorkspaceTab } from "../workspace-tabs/types";

const NEW_TAB_ANIMATION_MS = 180;

export const useBrowserTabStripAnimationState = (
  tabs: readonly WorkspaceTab[]
): {
  readonly newlyAddedTabIds: ReadonlySet<string>;
} => {
  const knownTabIdsRef = useRef<ReadonlySet<string> | null>(null);
  const clearTimersRef = useRef<readonly number[]>([]);
  const [newlyAddedTabIds, setNewlyAddedTabIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  useEffect(() => {
    const currentIds = new Set(tabs.map((tab) => tab.id));
    const previousIds = knownTabIdsRef.current;
    knownTabIdsRef.current = currentIds;
    if (previousIds === null) {
      return;
    }

    const addedIds = [...currentIds].filter((tabId) => !previousIds.has(tabId));
    if (addedIds.length === 0) {
      return;
    }

    setNewlyAddedTabIds((current) => new Set([...current, ...addedIds]));
    const timer = window.setTimeout(() => {
      setNewlyAddedTabIds((current) => {
        const next = new Set(current);
        for (const tabId of addedIds) {
          next.delete(tabId);
        }
        return next;
      });
    }, NEW_TAB_ANIMATION_MS);
    clearTimersRef.current = [...clearTimersRef.current, timer];
  }, [tabs]);

  useEffect(
    () => () => {
      for (const timer of clearTimersRef.current) {
        window.clearTimeout(timer);
      }
    },
    []
  );

  return { newlyAddedTabIds };
};
