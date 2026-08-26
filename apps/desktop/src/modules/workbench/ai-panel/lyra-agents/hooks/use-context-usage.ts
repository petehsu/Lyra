import { useState, useEffect, useMemo } from "react";
import { useData } from "../data/DataProvider";
import { getDesktopApi } from "../../../shell/service";

export type ContextUsageStatus = "idle" | "compressing" | "compressed" | "failed";

export type ContextUsageState = {
  rate: number;
  tokenEstimate: number;
  contextWindow: number;
  status: ContextUsageStatus;
};

// ponytail: fallback 128K when contextWindow is unknown — conservative default,
// upgrade path: omit ring when contextWindow is null instead of guessing.
const FALLBACK_CONTEXT_WINDOW = 128_000;

// Once the runtime has flushed the post-compaction snapshot, its `tokenEstimate`
// should drop near the `tokenAfter` value reported on completion. Allow a 5%
// fuzz band so a one-message-around rounding noise doesn't keep the optimistic
// mask live forever.
const POST_COMPRESSION_FUZZ_RATIO = 0.05;

export const useContextUsage = (): ContextUsageState => {
  const { session, modelControls } = useData();

  const contextWindow = useMemo(() => {
    const models = modelControls?.models ?? [];
    const selected =
      models.find((m) => m.selected)
      ?? models.find((m) => m.available && m.enabled);
    return selected?.contextWindow ?? null;
  }, [modelControls?.models, modelControls?.currentModel]);

  const [status, setStatus] = useState<ContextUsageStatus>("idle");
  // jcode `streaming_context_stale` / mimocode-opencode "ring is pure derived"
  // — after "completed" the session snapshot may still carry the pre-compaction
  // `tokenEstimate` because `refresh_token_estimate_if_stale` is time-throttled
  // and was just stamped milliseconds before. We mask the ring with the
  // compacted `tokenAfter` until the fresh snapshot (force-refreshed on the
  // runtime side) arrives and the derived count drops to ≤ optimistic. Without
  // this guard the ring stays red/full for up to the next session touch, even
  // though compaction succeeded.
  const [optimisticTokenAfter, setOptimisticTokenAfter] = useState<number | null>(null);

  useEffect(() => {
    const api = getDesktopApi();
    if (api?.agent === undefined) return;
    const unsubscribe = api.agent.onEvent((event) => {
      if (event.kind !== "contextCompressionProgress") return;
      if (event.status === "started") {
        setStatus("compressing");
        setOptimisticTokenAfter(null);
      } else if (event.status === "completed") {
        setStatus("compressed");
        setOptimisticTokenAfter(
          event.tokenAfter != null && event.tokenAfter >= 0 ? event.tokenAfter : null,
        );
      } else if (event.status === "failed") {
        setStatus("failed");
        setOptimisticTokenAfter(null);
      }
    });
    return unsubscribe;
  }, []);

  const derivedTokenEstimate = session.tokenEstimate ?? 0;
  const effectiveWindow = contextWindow ?? FALLBACK_CONTEXT_WINDOW;

  // stale guard: when the post-compaction snapshot has caught up, the derived
  // estimate drops to at-or-below the optimistic value (within a fuzz band).
  // Once it does, drop the mask and let the ring run free from `session`.
  const staleResolved =
    status === "compressed"
    && optimisticTokenAfter != null
    && optimisticTokenAfter > 0
    && derivedTokenEstimate <= optimisticTokenAfter * (1 + POST_COMPRESSION_FUZZ_RATIO);

  useEffect(() => {
    if (staleResolved) {
      setOptimisticTokenAfter(null);
      setStatus("idle");
    }
  }, [staleResolved]);

  // While masking, the runtime snapshot is stale (still reports the
  // pre-compaction count), so the optimistic value is closer to truth. After the
  // mask resolves the derived count is already authoritative.
  const tokenEstimate =
    optimisticTokenAfter != null && derivedTokenEstimate > optimisticTokenAfter
      ? optimisticTokenAfter
      : derivedTokenEstimate;
  const rate = Math.min(tokenEstimate / effectiveWindow, 1);

  return { rate, tokenEstimate, contextWindow: effectiveWindow, status };
};