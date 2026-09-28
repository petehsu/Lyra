import type { WorkbenchBrowserViewManager } from "../workbench-browser/types";

/** Presentation compression only: the complete map remains available to explicit queries. */
export const enrichLumenStructure = async (
  browser: Pick<WorkbenchBrowserViewManager, "describeAgentScene">,
  method: string,
  payload: Record<string, unknown>,
  result: Record<string, unknown>,
) => {
  if (
    !browser.describeAgentScene ||
    !["lyraLumen.map", "lyraLumen.act"].includes(method) ||
    result.ok === false ||
    result.blocked ||
    result.needsUserAction ||
    result.status === "dialogPending" ||
    typeof result.tabId !== "string"
  )
    return result;
  if (payload.query || payload.region || payload.cursor) return result;
  const text = [result.mapAppendix, result.message]
    .filter((v) => typeof v === "string")
    .join("\n");
  // Ordinary forms keep the direct DOM path; rich structure is useful when
  // anonymous targets dominate or a rendered region cannot be read as text.
  if (
    (text.match(/unnamed /g)?.length ?? 0) < 9 &&
    !/\b(canvas|application|covered)\b/i.test(text)
  )
    return result;
  try {
    const observation = await browser.describeAgentScene(result.tabId, {
      targetMode: payload.targetMode === "isolated" ? "isolated" : "live",
    });
    if (!observation) return result;
    const refs = new Set(observation.groupedTargetRefs);
    const compact = (text: string) =>
      text
        .split("\n")
        .filter((line) => {
          const ref = /targetRef=([^\s\]]+)\]/.exec(line)?.[1];
          return !ref || !refs.has(ref);
        })
        .join("\n");
    const elements = Array.isArray(result.elements)
      ? result.elements.filter((e) => !refs.has(e.targetRef))
      : undefined;
    return {
      ...result,
      ...(typeof result.mapAppendix === "string"
        ? { mapAppendix: compact(result.mapAppendix) }
        : {}),
      ...(typeof result.message === "string"
        ? { message: compact(result.message) }
        : {}),
      ...(elements ? { elements, presentedCount: elements.length } : {}),
      scene: observation.scene,
      nextRecommendedAction:
        "Use returned structure/state and marked input; all targetRefs remain available through an explicit map query. Request pixels only for facts absent here.",
    };
  } catch (error) {
    // This can run after input. A read failure must never discard its receipt.
    return { ...result, structureObservationError: String(error) };
  }
};
