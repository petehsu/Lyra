import type { WorkbenchBrowserAgentScrollHint } from "../types";

export const formatScrollHintsForMap = (
  hints: readonly WorkbenchBrowserAgentScrollHint[],
  totalHiddenCount: number
): string => {
  if (hints.length === 0 || totalHiddenCount <= 0) {
    return "";
  }
  const remaining = Math.max(0, totalHiddenCount - hints.length);
  const header = remaining > 0
    ? `... (${remaining} more element${remaining === 1 ? "" : "s"} below - scroll to reveal):`
    : "... (scroll to reveal hidden iframe controls):";
  const lines = hints.map((hint) => {
    const label = hint.text.length > 0 ? `"${hint.text}"` : "(no label)";
    const pages = hint.pagesDown > 0 ? ` ~${hint.pagesDown} page${hint.pagesDown === 1 ? "" : "s"} down` : "";
    return `  [${hint.frameRef}] <${hint.tag}> ${label}${pages}`;
  });
  return [header, ...lines].join("\n");
};