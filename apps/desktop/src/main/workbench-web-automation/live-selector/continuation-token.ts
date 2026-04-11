export type LiveSelectorContinuationState = {
  readonly scope: "visible" | "nearby" | "expanded";
  readonly offset: number;
};

export const encodeLiveSelectorContinuationToken = (
  state: LiveSelectorContinuationState
): string => Buffer.from(JSON.stringify(state), "utf8").toString("base64url");

export const decodeLiveSelectorContinuationToken = (
  value: string | undefined
): LiveSelectorContinuationState | null => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    const scope = typeof parsed.scope === "string" ? parsed.scope : null;
    const offset = typeof parsed.offset === "number" && Number.isFinite(parsed.offset)
      ? Math.max(0, Math.round(parsed.offset))
      : null;
    if ((scope === "visible" || scope === "nearby" || scope === "expanded") && offset !== null) {
      return { scope, offset };
    }
  } catch (_error) {
    return null;
  }
  return null;
};
