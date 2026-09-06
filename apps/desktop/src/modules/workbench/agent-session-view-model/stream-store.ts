/**
 * Stream Store — external mutable store for streaming text deltas.
 *
 * Decouples delta arrival rate from React render rate. Deltas are pushed into
 * per-message chunk arrays (O(1)) without triggering any React update. A
 * animation frame coalesces all deltas delivered before the next paint and
 * notifies subscribers once. This is deliberately frame based rather than a
 * microtask: a continuous IPC stream must not starve Chromium's paint queue.
 * Subscribers (via useStreamingMessageText)
 * feed the committed text into React through useSyncExternalStore.
 *
 * This replaces the previous per-delta reducer path that rebuilt the entire
 * session object with string concatenation (O(n²) per message) on every delta.
 */

type BlockState = {
  readonly id: string;
  /** Deltas received since the last IPC-batch commit. */
  chunks: string[];
  committedText: string;
  replacePending: boolean;
  replacementRevision: number;
  replacesFallback: boolean;
};

type MessageState = {
  readonly id: string;
  /** Visible text deltas pending the next commit. */
  textChunks: string[];
  textReplacePending: boolean;
  /** Reasoning deltas pending the next commit. */
  reasoningChunks: string[];
  /** Per-block chunk accumulation (text blocks keyed by blockId). */
  blocks: Map<string, BlockState>;
  /** Set when any delta arrived since the last commit. */
  dirty: boolean;
  /**
   * Cached joined text from the last commit. Kept as a stable reference so
   * useSyncExternalStore's getSnapshot can return the same string identity
   * when nothing changed (avoids infinite React render loops).
   */
  committedText: string;
  committedReasoning: string;
};

type SubscribeCallback = () => void;

const latestBlockState = (blocks: ReadonlyMap<string, BlockState>): BlockState | undefined => {
  let latest: BlockState | undefined;
  for (const block of blocks.values()) latest = block;
  return latest;
};

export class StreamStore {
  private readonly messages = new Map<string, MessageState>();
  private readonly subscribers = new Map<string, Set<SubscribeCallback>>();

  private rafId: number | null = null;
  private readonly dirtyMessages = new Set<string>();

  // ---- Public API ----

  /**
   * Append a visible text delta for a message. O(1) push, does not trigger React.
   * If `replace` is true, the chunk array is cleared before pushing (the delta
   * replaces the accumulated text, not appends to it).
   */
  appendDelta(messageId: string, blockId: string | null | undefined, delta: string, replace = false): boolean {
    const state = this.getOrCreate(messageId);
    const existingBlock = blockId === null || blockId === undefined
      ? undefined
      : state.blocks.get(blockId);
    const startsStreamBlock = blockId === null || blockId === undefined
      ? state.textChunks.length === 0 && state.committedText.length === 0
      : existingBlock === undefined ||
        (existingBlock.chunks.length === 0 && existingBlock.committedText.length === 0);
    if (replace) {
      state.textChunks = [delta];
      state.textReplacePending = true;
      // Replace also resets block chunks — the new delta is the full content.
      if (blockId !== null && blockId !== undefined) {
        let block = state.blocks.get(blockId);
        if (block === undefined) {
          block = {
            id: blockId,
            chunks: [],
            committedText: "",
            replacePending: true,
            replacementRevision: 0,
            replacesFallback: true
          };
          state.blocks.set(blockId, block);
        }
        block.chunks = [delta];
        block.replacePending = true;
        block.replacementRevision += 1;
        block.replacesFallback = true;
      }
    } else {
      state.textChunks.push(delta);
      if (blockId !== null && blockId !== undefined) {
        let block = state.blocks.get(blockId);
        if (block === undefined) {
          block = {
            id: blockId,
            chunks: [],
            committedText: "",
            replacePending: false,
            replacementRevision: 0,
            replacesFallback: false
          };
          state.blocks.set(blockId, block);
        }
        block.chunks.push(delta);
      }
    }
    state.dirty = true;
    this.dirtyMessages.add(messageId);
    this.scheduleCommit();
    return startsStreamBlock;
  }

  /**
   * Append a reasoning delta for a message. O(1) push, does not trigger React.
   */
  appendReasoningDelta(messageId: string, delta: string): void {
    const state = this.getOrCreate(messageId);
    state.reasoningChunks.push(delta);
    state.dirty = true;
    this.dirtyMessages.add(messageId);
    this.scheduleCommit();
  }

  /**
   * Get the current visible text for a message (joins chunks). This is the
   * snapshot used by useSyncExternalStore. Returns a stable reference when
   * the text hasn't changed since the last commit.
   */
  getMessageText(messageId: string): string {
    const state = this.messages.get(messageId);
    if (state === undefined) return "";
    return state.committedText;
  }

  /**
   * Get the text for one streamed Markdown block. Tool rounds can create
   * several text blocks in a single message; returning message-wide text to
   * the trailing block duplicates earlier narration. If an older backend did
   * not provide block ids, fall back to the message-wide stream.
   */
  getBlockText(messageId: string, blockId: string | null): string {
    const state = this.messages.get(messageId);
    if (state === undefined) return "";
    const block = blockId === null ? latestBlockState(state.blocks) : state.blocks.get(blockId);
    if (block !== undefined) return block.committedText;
    return state.blocks.size === 0 ? state.committedText : "";
  }

  blockReplacesFallback(messageId: string, blockId: string | null): boolean {
    const state = this.messages.get(messageId);
    if (state === undefined) return false;
    const block = blockId === null ? latestBlockState(state.blocks) : state.blocks.get(blockId);
    return block?.replacesFallback === true;
  }

  getBlockReplacementRevision(messageId: string, blockId: string | null): number {
    const state = this.messages.get(messageId);
    if (state === undefined) return 0;
    const block = blockId === null ? latestBlockState(state.blocks) : state.blocks.get(blockId);
    return block?.replacementRevision ?? 0;
  }

  /**
   * Get the current reasoning text for a message (joins chunks). Returns a
   * stable reference when unchanged.
   */
  getMessageReasoning(messageId: string): string {
    const state = this.messages.get(messageId);
    if (state === undefined) return "";
    return state.committedReasoning;
  }

  /**
   * Subscribe to commit notifications for a message. The callback is called
   * after a batched commit when the message's text changes. Returns an unsubscribe
   * function.
   */
  subscribe(messageId: string, callback: SubscribeCallback): () => void {
    let subs = this.subscribers.get(messageId);
    if (subs === undefined) {
      subs = new Set();
      this.subscribers.set(messageId, subs);
    }
    subs.add(callback);
    return () => {
      const s = this.subscribers.get(messageId);
      if (s !== undefined) {
        s.delete(callback);
        if (s.size === 0) {
          this.subscribers.delete(messageId);
        }
      }
    };
  }

  /**
   * Reset a message's chunk accumulation, releasing memory. Called when the
   * message is committed (messageCommitted event brings the final text) or
   * when the turn ends. After reset, getMessageText returns "" until new
   * deltas arrive.
   */
  reset(messageId: string): void {
    this.messages.delete(messageId);
    this.dirtyMessages.delete(messageId);
  }

  /**
   * Remove all state for a message (stronger than reset). Used when a message
   * is deleted or the session is cleared.
   */
  remove(messageId: string): void {
    this.messages.delete(messageId);
    this.subscribers.delete(messageId);
    this.dirtyMessages.delete(messageId);
  }

  /** Clear all state (session switch, etc.). */
  clear(): void {
    this.messages.clear();
    this.subscribers.clear();
    this.dirtyMessages.clear();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Force an immediate commit of all dirty messages (synchronous). Used when
   * switching to a background session tab — ensures the latest text is
   * visible without waiting for the pending microtask.
   */
  flush(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.commit();
  }

  // ---- Internal ----

  private getOrCreate(messageId: string): MessageState {
    let state = this.messages.get(messageId);
    if (state === undefined) {
      state = {
        id: messageId,
        textChunks: [],
        textReplacePending: false,
        reasoningChunks: [],
        blocks: new Map(),
        dirty: false,
        committedText: "",
        committedReasoning: ""
      };
      this.messages.set(messageId, state);
    }
    return state;
  }

  private scheduleCommit(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.commit();
    });
  }

  private commit(): void {
    if (this.dirtyMessages.size === 0) return;
    const dirty = [...this.dirtyMessages];
    this.dirtyMessages.clear();

    for (const messageId of dirty) {
      const state = this.messages.get(messageId);
      if (state === undefined) continue;
      if (!state.dirty) continue;

      // Merge only this IPC batch. Long answers stay O(new delta bytes) rather
      // than rejoining the entire answer every frame.
      const textDelta = state.textChunks.join("");
      state.committedText = state.textReplacePending
        ? textDelta
        : `${state.committedText}${textDelta}`;
      state.textChunks = [];
      state.textReplacePending = false;
      state.committedReasoning = `${state.committedReasoning}${state.reasoningChunks.join("")}`;
      state.reasoningChunks = [];
      for (const block of state.blocks.values()) {
        if (block.chunks.length === 0 && !block.replacePending) continue;
        const blockDelta = block.chunks.join("");
        block.committedText = block.replacePending
          ? blockDelta
          : `${block.committedText}${blockDelta}`;
        block.chunks = [];
        block.replacePending = false;
      }
      state.dirty = false;

      const subs = this.subscribers.get(messageId);
      if (subs !== undefined) {
        for (const callback of subs) {
          callback();
        }
      }
    }
  }
}

/**
 * Global singleton stream store. One instance serves all sessions — messages
 * are keyed by messageId which is globally unique.
 */
let globalStreamStore: StreamStore | null = null;

export function getStreamStore(): StreamStore {
  if (globalStreamStore === null) {
    globalStreamStore = new StreamStore();
  }
  return globalStreamStore;
}

/**
 * Reset the global stream store (for testing or session switch).
 */
export function resetStreamStore(): void {
  if (globalStreamStore !== null) {
    globalStreamStore.clear();
  }
  globalStreamStore = null;
}
