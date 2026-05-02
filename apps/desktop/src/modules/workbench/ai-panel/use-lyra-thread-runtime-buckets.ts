import { useCallback, useEffect, useRef, useState } from "react";

import type {
  AgentPlanArtifact,
  AgentRuntimeEvent,
  AgentToolCall,
  AgentUsage,
} from "../../../shared/desktop-bridge";
import type { OptimisticUserMessage } from "./view-helpers";

export type LyraTurnPlanState = {
  readonly turnId: string;
  readonly artifact: AgentPlanArtifact;
  readonly updatedAt: number;
};

export type ThreadRuntimeBucket = {
  readonly optimisticUserMessages: readonly OptimisticUserMessage[];
  readonly liveToolCalls: readonly AgentToolCall[];
  readonly latestRuntimeEventByTurn: Readonly<Record<string, AgentRuntimeEvent>>;
  readonly turnUsageByTurn: Readonly<Record<string, AgentUsage>>;
  readonly planByTurn: Readonly<Record<string, LyraTurnPlanState>>;
  readonly streamingTurnId: string | null;
  readonly streamingAssistantText: string;
  readonly finalizingTurnId: string | null;
  readonly isSending: boolean;
  readonly isStreamActive: boolean;
  readonly followEnabled: boolean;
};

type RuntimeBucketUpdater = (current: ThreadRuntimeBucket) => ThreadRuntimeBucket;

const requestRuntimeAnimationFrame = (callback: FrameRequestCallback): number => {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => {
    callback(Date.now());
  }, 16) as unknown as number;
};

const cancelRuntimeAnimationFrame = (handle: number): void => {
  if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(handle);
    return;
  }
  globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
};

export const createEmptyRuntimeBucket = (): ThreadRuntimeBucket => ({
  optimisticUserMessages: [],
  liveToolCalls: [],
  latestRuntimeEventByTurn: {},
  turnUsageByTurn: {},
  planByTurn: {},
  streamingTurnId: null,
  streamingAssistantText: "",
  finalizingTurnId: null,
  isSending: false,
  isStreamActive: false,
  followEnabled: false,
});

export const EMPTY_RUNTIME_BUCKET = createEmptyRuntimeBucket();

export const mergeRuntimeBuckets = (
  target: ThreadRuntimeBucket,
  source: ThreadRuntimeBucket
): ThreadRuntimeBucket => ({
  optimisticUserMessages:
    source.optimisticUserMessages.length > 0
      ? source.optimisticUserMessages
      : target.optimisticUserMessages,
  liveToolCalls:
    source.liveToolCalls.length > 0
      ? source.liveToolCalls
      : target.liveToolCalls,
  latestRuntimeEventByTurn: {
    ...target.latestRuntimeEventByTurn,
    ...source.latestRuntimeEventByTurn,
  },
  turnUsageByTurn: {
    ...target.turnUsageByTurn,
    ...source.turnUsageByTurn,
  },
  planByTurn: {
    ...target.planByTurn,
    ...source.planByTurn,
  },
  streamingTurnId: source.streamingTurnId ?? target.streamingTurnId,
  streamingAssistantText:
    source.streamingAssistantText.length > 0
      ? source.streamingAssistantText
      : target.streamingAssistantText,
  finalizingTurnId: source.finalizingTurnId ?? target.finalizingTurnId,
  isSending: source.isSending || target.isSending,
  isStreamActive: source.isStreamActive || target.isStreamActive,
  followEnabled: source.followEnabled || target.followEnabled,
});

export const useLyraThreadRuntimeBuckets = () => {
  const [runtimeByKey, setRuntimeByKey] = useState<Readonly<Record<string, ThreadRuntimeBucket>>>({});
  const runtimeByKeyRef = useRef<Readonly<Record<string, ThreadRuntimeBucket>>>({});
  const queuedRuntimePatchesRef = useRef<Record<string, RuntimeBucketUpdater[]>>({});
  const queuedRuntimePatchFrameRef = useRef<number | null>(null);

  useEffect(() => {
    runtimeByKeyRef.current = runtimeByKey;
  }, [runtimeByKey]);

  const commitRuntimeByKey = useCallback((
    updater: (
      current: Readonly<Record<string, ThreadRuntimeBucket>>
    ) => Readonly<Record<string, ThreadRuntimeBucket>>
  ): void => {
    const next = updater(runtimeByKeyRef.current);
    runtimeByKeyRef.current = next;
    setRuntimeByKey(next);
  }, []);

  const flushQueuedRuntimeBucketPatches = useCallback((): void => {
    if (queuedRuntimePatchFrameRef.current !== null) {
      cancelRuntimeAnimationFrame(queuedRuntimePatchFrameRef.current);
      queuedRuntimePatchFrameRef.current = null;
    }
    const queued = queuedRuntimePatchesRef.current;
    queuedRuntimePatchesRef.current = {};
    if (Object.keys(queued).length === 0) {
      return;
    }
    commitRuntimeByKey((current) => {
      const next: Record<string, ThreadRuntimeBucket> = { ...current };
      for (const [key, updaters] of Object.entries(queued)) {
        let bucket = next[key] ?? EMPTY_RUNTIME_BUCKET;
        for (const updater of updaters) {
          bucket = updater(bucket);
        }
        next[key] = bucket;
      }
      return next;
    });
  }, [commitRuntimeByKey]);

  useEffect(() => () => {
    if (queuedRuntimePatchFrameRef.current !== null) {
      cancelRuntimeAnimationFrame(queuedRuntimePatchFrameRef.current);
      queuedRuntimePatchFrameRef.current = null;
    }
    queuedRuntimePatchesRef.current = {};
  }, []);

  const patchRuntimeBucket = useCallback((key: string, updater: RuntimeBucketUpdater): void => {
    commitRuntimeByKey((current) => ({
      ...current,
      [key]: updater(current[key] ?? EMPTY_RUNTIME_BUCKET),
    }));
  }, [commitRuntimeByKey]);

  const queueRuntimeBucketPatch = useCallback((
    key: string,
    updater: RuntimeBucketUpdater
  ): void => {
    const queued = queuedRuntimePatchesRef.current[key] ?? [];
    queuedRuntimePatchesRef.current = {
      ...queuedRuntimePatchesRef.current,
      [key]: [...queued, updater],
    };
    if (queuedRuntimePatchFrameRef.current !== null) {
      return;
    }
    queuedRuntimePatchFrameRef.current = requestRuntimeAnimationFrame(() => {
      queuedRuntimePatchFrameRef.current = null;
      flushQueuedRuntimeBucketPatches();
    });
  }, [flushQueuedRuntimeBucketPatches]);

  const resetRuntimeBucket = useCallback((key: string): void => {
    flushQueuedRuntimeBucketPatches();
    commitRuntimeByKey((current) => ({ ...current, [key]: createEmptyRuntimeBucket() }));
  }, [commitRuntimeByKey, flushQueuedRuntimeBucketPatches]);

  const forgetRuntimeBucket = useCallback((key: string): void => {
    commitRuntimeByKey((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, [commitRuntimeByKey]);

  const bindRuntimeBucketToThread = useCallback((draftKey: string, threadId: string): void => {
    commitRuntimeByKey((current) => {
      if (draftKey === threadId) {
        return current;
      }
      const draftBucket = current[draftKey];
      if (draftBucket === undefined) {
        return current;
      }
      const existingBucket = current[threadId] ?? EMPTY_RUNTIME_BUCKET;
      const next = { ...current };
      delete next[draftKey];
      next[threadId] = mergeRuntimeBuckets(existingBucket, draftBucket);
      return next;
    });
  }, [commitRuntimeByKey]);

  const stopAllRuntimeBuckets = useCallback((): void => {
    commitRuntimeByKey((current) => {
      const next: Record<string, ThreadRuntimeBucket> = {};
      for (const [key, bucket] of Object.entries(current)) {
        next[key] = { ...bucket, isStreamActive: false, isSending: false };
      }
      return next;
    });
  }, [commitRuntimeByKey]);

  return {
    runtimeByKey,
    runtimeByKeyRef,
    patchRuntimeBucket,
    queueRuntimeBucketPatch,
    flushQueuedRuntimeBucketPatches,
    resetRuntimeBucket,
    forgetRuntimeBucket,
    bindRuntimeBucketToThread,
    stopAllRuntimeBuckets,
  };
};
