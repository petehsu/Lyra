import type { AgentPageCitation, AgentTurnSendRequest } from "../../shared/agent";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";

const SURFACE_MAP_CHARS = 8_000;

const isWholePage = (citation: AgentPageCitation): boolean => {
  if (citation.excerptKind !== "page") return false;
  if (citation.sourceKind === "terminal-tab") return false;
  return citation.pageUrl.startsWith("lyra://terminal/") === false;
};

export const attachPageCitationMaps = (
  payload: AgentTurnSendRequest,
  _browser: WorkbenchBrowserIpcBridge | null
): AgentTurnSendRequest => {
  const citations = payload.pageCitations;
  if (citations === undefined || citations.length === 0) return payload;
  const pageCitations = citations.map((citation) => {
    if (isWholePage(citation) === false) return citation;
    const map = citation.surfaceMap?.trim() ?? "";
    if (map.length === 0 || map.length <= SURFACE_MAP_CHARS) return citation;
    return { ...citation, surfaceMap: map.slice(0, SURFACE_MAP_CHARS) };
  });
  return { ...payload, pageCitations };
};
