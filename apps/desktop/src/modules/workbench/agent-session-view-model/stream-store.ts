/**
 * Stream Store — external mutable store for streaming text deltas.
 *
 * Decouples delta arrival rate from React render rate. Deltas are pushed into
 * per-message chunk arrays (O(1)) without triggering any React update. A
 * requestAnimationFrame loop coalesces dirty messages and notifies subscribers
 * at most once per frame (~60fps). Subscribers (via useStreamingMessageText)
 * feed the committed text into React through useSyncExternalStore.
 *
 * This replaces the previous per-delta reducer path that rebuilt the entire
 * session object with string concatenation (O(n²) per message) on every delta.
 */

type BlockState = {
  readonly id: string;
  chunks: string[];
  /** When true, the next delta replaces rather than appends. */
  replace: boolean;
};

type MessageState = {
  readonly id: string;
  /** Visible text deltas — appended in order. */
  textChunks: string[];
  /** Reasoning deltas — appended separately. */
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
  appendDelta(messageId: string, blockId: string | null | undefined, delta: string, replace = false): void {
    const state = this.getOrCreate(messageId);
    if (replace) {
      state.textChunks = [delta];
      // Replace also resets block chunks — the new delta is the full content.
      if (blockId !== null && blockId !== undefined) {
        const block = state.blocks.get(blockId);
        if (block !== undefined) {
          block.chunks = [delta];
          block.replace = true;
        }
      }
    } else {
      state.textChunks.push(delta);
      if (blockId !== null && blockId !== undefined) {
        let block = state.blocks.get(blockId);
        if (block === undefined) {
          block = { id: blockId, chunks: [], replace: false };
          state.blocks.set(blockId, block);
        }
        block.chunks.push(delta);
      }
    }
    state.dirty = true;
    this.dirtyMessages.add(messageId);
    this.scheduleCommit();
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
   * (inside a RAF) when the message's text changes. Returns an unsubscribe
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
    const state = this.messages.get(messageId);
    if (state !== undefined) {
      state.textChunks = [];
      state.reasoningChunks = [];
      state.blocks.clear();
      state.dirty = false;
      state.committedText = "";
      state.committedReasoning = "";
    }
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
   * visible without waiting for the next animation frame.
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

      // Join chunks once per frame — O(n) but only once, not per-delta.
      state.committedText = state.textChunks.join("");
      state.committedReasoning = state.reasoningChunks.join("");
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