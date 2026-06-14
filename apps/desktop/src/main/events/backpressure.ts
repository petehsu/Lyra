type TimerHandle = ReturnType<typeof setTimeout>;

export type BackpressureMetricsSnapshot = {
  readonly name: string;
  readonly intervalMs: number;
  readonly maxQueueSize: number;
  readonly receivedEvents: number;
  readonly sentEvents: number;
  readonly coalescedEvents: number;
  readonly forcedFlushes: number;
  readonly flushCount: number;
  readonly errorCount: number;
  readonly maxQueueDepth: number;
  readonly maxPayloadBytes: number;
  readonly maxSendDurationMs: number;
  readonly lastReceivedAt: number | null;
  readonly lastFlushedAt: number | null;
};

export type BackpressuredEventSender<T> = {
  readonly enqueue: (event: T) => void;
  readonly flush: () => void;
  readonly metrics: () => BackpressureMetricsSnapshot;
  readonly dispose: () => void;
};

export type BackpressuredEventSenderOptions<T> = {
  readonly name: string;
  readonly intervalMs: number;
  readonly maxQueueSize: number;
  readonly send: (event: T) => void;
  readonly keyFor?: (event: T) => string | null;
  readonly merge?: (current: T, incoming: T) => T;
  readonly coalesceMode?: "key" | "consecutive";
  readonly leading?: boolean;
  readonly estimateBytes?: (event: T) => number;
  readonly onError?: (error: unknown, event: T) => void;
  readonly now?: () => number;
};

type QueueEntry<T> = {
  readonly mergeKey: string | null;
  readonly event: T;
};

const metricReaders = new Set<() => BackpressureMetricsSnapshot>();

export const estimateSerializedBytes = (value: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
};

export const readBackpressureMetrics = (): readonly BackpressureMetricsSnapshot[] =>
  [...metricReaders].map((read) => read());

export const createBackpressuredEventSender = <T>({
  name,
  intervalMs,
  maxQueueSize,
  send,
  keyFor,
  merge,
  coalesceMode = "key",
  leading = true,
  estimateBytes,
  onError,
  now = Date.now
}: BackpressuredEventSenderOptions<T>): BackpressuredEventSender<T> => {
  if (intervalMs < 0 || Number.isFinite(intervalMs) === false) {
    throw new Error("intervalMs must be a finite non-negative number");
  }
  if (maxQueueSize <= 0 || Number.isFinite(maxQueueSize) === false) {
    throw new Error("maxQueueSize must be a finite positive number");
  }

  let sequence = 0;
  let flushTimer: TimerHandle | null = null;
  let disposed = false;
  const queue = new Map<string, QueueEntry<T>>();
  const order: string[] = [];
  const metricsState = {
    receivedEvents: 0,
    sentEvents: 0,
    coalescedEvents: 0,
    forcedFlushes: 0,
    flushCount: 0,
    errorCount: 0,
    maxQueueDepth: 0,
    maxPayloadBytes: 0,
    maxSendDurationMs: 0,
    lastReceivedAt: null as number | null,
    lastFlushedAt: null as number | null
  };

  const readMetrics = (): BackpressureMetricsSnapshot => ({
    name,
    intervalMs,
    maxQueueSize,
    ...metricsState
  });

  metricReaders.add(readMetrics);

  const cancelTimer = (): void => {
    if (flushTimer === null) {
      return;
    }
    clearTimeout(flushTimer);
    flushTimer = null;
  };

  const flush = (): void => {
    if (disposed) {
      return;
    }
    cancelTimer();
    if (queue.size === 0) {
      return;
    }

    const entries = order
      .map((queueKey) => queue.get(queueKey))
      .filter((entry): entry is QueueEntry<T> => entry !== undefined);
    queue.clear();
    order.length = 0;
    metricsState.flushCount += 1;
    metricsState.lastFlushedAt = now();

    for (const entry of entries) {
      const payloadBytes = estimateBytes?.(entry.event) ?? 0;
      metricsState.maxPayloadBytes = Math.max(metricsState.maxPayloadBytes, payloadBytes);
      const sendStartedAt = now();
      try {
        send(entry.event);
        metricsState.sentEvents += 1;
      } catch (error) {
        metricsState.errorCount += 1;
        onError?.(error, entry.event);
      } finally {
        metricsState.maxSendDurationMs = Math.max(
          metricsState.maxSendDurationMs,
          Math.max(0, now() - sendStartedAt)
        );
      }
    }
  };

  const scheduleFlush = (): void => {
    if (flushTimer !== null || queue.size === 0 || disposed) {
      return;
    }
    const lastFlushedAt = metricsState.lastFlushedAt;
    const delayMs = lastFlushedAt === null
      ? intervalMs
      : Math.max(0, intervalMs - Math.max(0, now() - lastFlushedAt));
    flushTimer = setTimeout(flush, delayMs);
  };

  const enqueue = (event: T): void => {
    if (disposed) {
      return;
    }
    metricsState.receivedEvents += 1;
    metricsState.lastReceivedAt = now();

    const rawMergeKey = keyFor?.(event);
    const mergeKey =
      typeof rawMergeKey === "string" && rawMergeKey.length > 0
        ? rawMergeKey
        : null;
    const lastQueueKey = order[order.length - 1];
    const consecutiveEntry = lastQueueKey === undefined ? undefined : queue.get(lastQueueKey);
    const queueKey = mergeKey === null
      ? `event:${sequence += 1}`
      : coalesceMode === "consecutive"
        ? consecutiveEntry?.mergeKey === mergeKey
          ? lastQueueKey!
          : `${mergeKey}:${sequence += 1}`
        : mergeKey;
    const existing = queue.get(queueKey);
    if (existing !== undefined) {
      queue.set(queueKey, {
        mergeKey,
        event: merge?.(existing.event, event) ?? event
      });
      metricsState.coalescedEvents += 1;
      scheduleFlush();
      return;
    }

    if (queue.size >= maxQueueSize) {
      metricsState.forcedFlushes += 1;
      flush();
    }

    queue.set(queueKey, { mergeKey, event });
    order.push(queueKey);
    metricsState.maxQueueDepth = Math.max(metricsState.maxQueueDepth, queue.size);

    const lastFlushedAt = metricsState.lastFlushedAt;
    const canFlushLeading =
      leading
      && queue.size === 1
      && flushTimer === null
      && (
        lastFlushedAt === null
        || intervalMs === 0
        || now() - lastFlushedAt >= intervalMs
      );
    if (canFlushLeading) {
      flush();
      return;
    }

    scheduleFlush();
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    cancelTimer();
    queue.clear();
    order.length = 0;
    metricReaders.delete(readMetrics);
  };

  return {
    enqueue,
    flush,
    metrics: readMetrics,
    dispose
  };
};
