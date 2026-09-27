import type { WorkbenchBrowserAgentElement, WorkbenchBrowserAgentObservation } from "../types";
import { fieldCurrentValue } from "./agent-affordance-lists";

export type SurfaceSnapshot = Pick<WorkbenchBrowserAgentObservation, "url" | "elements" | "pageNotes">;

// Focus and layout belong in the map but do not prove that an action took effect.
export const surfaceControlFacts = (element: WorkbenchBrowserAgentElement): string => JSON.stringify({
  role: element.role, label: element.label, disabled: element.disabled, editable: element.editable,
  checked: element.checked, expanded: element.expanded, stateHint: element.stateHint,
  semantics: { ...element.semantics, focused: undefined }, value: fieldCurrentValue(element),
  tooltipText: element.tooltipText, href: element.href, ancestors: element.ancestorTargetRefs
});
const context = (snapshot: SurfaceSnapshot) => (snapshot.pageNotes ?? []).filter(note => note.kind !== "focus" && note.kind !== "cursor");

export const compareSurface = (before: SurfaceSnapshot | undefined, after: SurfaceSnapshot) => {
  const prior = new Map((before?.elements ?? []).map(element => [element.targetRef, element]));
  const current = new Set(after.elements.map(element => element.targetRef));
  const addedTargetRefs = after.elements.filter(element => !prior.has(element.targetRef)).map(element => element.targetRef);
  const removedTargetRefs = (before?.elements ?? []).filter(element => !current.has(element.targetRef)).map(element => element.targetRef);
  const updatedTargetRefs = after.elements.filter(element => {
    const old = prior.get(element.targetRef);
    return old !== undefined && surfaceControlFacts(old) !== surfaceControlFacts(element);
  }).map(element => element.targetRef);
  const contextChanged = JSON.stringify(before ? context(before) : []) !== JSON.stringify(context(after));
  const cursorKey = (element: WorkbenchBrowserAgentElement) => JSON.stringify(element.cursor && [element.cursor.keyword, element.cursor.customImage]);
  const cursorChanged = after.elements.some(element => {
    const old = prior.get(element.targetRef);
    return old !== undefined && cursorKey(old) !== cursorKey(element);
  }) || JSON.stringify(before?.pageNotes?.filter(note => note.kind === "cursor") ?? [])
    !== JSON.stringify(after.pageNotes?.filter(note => note.kind === "cursor") ?? []);
  return {
    changed: before !== undefined && (before.url !== after.url || contextChanged
      || addedTargetRefs.length > 0 || removedTargetRefs.length > 0 || updatedTargetRefs.length > 0),
    addedTargetRefs, removedTargetRefs, updatedTargetRefs, contextChanged, cursorChanged
  };
};

/** Observe asynchronous UI updates in this tool call; never dispatch another input. */
export const observeActionSurface = async (
  before: SurfaceSnapshot | undefined,
  observe: () => Promise<WorkbenchBrowserAgentObservation>,
  options: {
    timeoutMs?: number;
    focusOnly?: boolean;
    acceptCursorChange?: boolean;
    settle: (remainingMs: number, requireChange: boolean) => Promise<boolean>;
  }
) => {
  const deadline = Date.now() + Math.min(1000, Math.max(0, options.timeoutMs ?? 800));
  let settled = await options.settle(Math.max(0, deadline - Date.now()), false);
  let after = await observe();
  let change = compareSurface(before, after);
  if (!change.changed && !options.focusOnly && !(options.acceptCursorChange && change.cursorChanged) && Date.now() < deadline) {
    // A delayed menu may not exist at the first quiet interval. Wait on the
    // journal, then collect once more instead of remapping every 80ms.
    settled = await options.settle(Math.max(0, deadline - Date.now()), true);
    after = await observe();
    change = compareSurface(before, after);
  }
  const busy = after.elements.some(element => element.semantics?.busy)
    || after.pageNotes?.some(note => note.kind === "busy");
  return { after, surfaceChange: { ...change,
    settled: settled && !busy && (change.changed || !!options.focusOnly || !!options.acceptCursorChange && change.cursorChanged)
  } };
};
