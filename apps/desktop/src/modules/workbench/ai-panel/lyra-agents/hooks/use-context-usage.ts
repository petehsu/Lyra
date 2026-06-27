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

export const useContextUsage = (): ContextUsageState => {
  const { session, modelControls } = useData();

  const contextWindow = useMemo(() => {
    const models = modelControls?.models ?? [];
    const selected =
      models.find((m) => m.id === modelControls?.currentModel)
      ?? models.find((m) => m.model === modelControls?.currentModel)
      ?? models.find((m) => m.available && m.enabled);
    return selected?.contextWindow ?? null;
  }, [modelControls?.models, modelControls?.currentModel]);

  const [status, setStatus] = useState<ContextUsageStatus>("idle");

  useEffect(() => {
    const api = getDesktopApi();
    if (api?.agent === undefined) return;
    const unsubscribe = api.agent.onEvent((event) => {
      if (event.kind !== "contextCompressionProgress") return;
      if (event.status === "started") {
        setStatus("compressing");
      } else if (event.status === "completed") {
        setStatus("compressed");
      } else if (event.status === "failed") {
        setStatus("failed");
      }
    });
    return unsubscribe;
  }, []);

  const tokenEstimate = session.tokenEstimate ?? 0;
  const effectiveWindow = contextWindow ?? FALLBACK_CONTEXT_WINDOW;
  const rate = Math.min(tokenEstimate / effectiveWindow, 1);

  return { rate, tokenEstimate, contextWindow: effectiveWindow, status };
};