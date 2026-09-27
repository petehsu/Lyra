import { MAP_PRESENTATION_CHARS, presentBrowserMap } from "./agent-map-presentation";
import type { WorkbenchBrowserAgentObservation } from "../types";
import { formatAffordanceLine } from "./agent-affordance-lists";
import { formatPageNotes } from "./agent-page-semantics";

export const compactMapObservation = (
  previous: Pick<WorkbenchBrowserAgentObservation, "url" | "elements" | "pageNotes"> | undefined,
  next: WorkbenchBrowserAgentObservation
): { readonly observation: WorkbenchBrowserAgentObservation } => {
  if (previous === undefined || previous.url !== next.url || next.mapAppendix === undefined) {
    return { observation: next };
  }
  const before = new Map(previous.elements.map(element => [element.targetRef, element]));
  const after = new Set(next.elements.map(element => element.targetRef));
  const added = next.elements.filter(element => !before.has(element.targetRef));
  const removed = previous.elements.filter(element => !after.has(element.targetRef));
  // Compare exactly the facts we publish. Element IDs and layout can change
  // without changing the stable target or its meaning.
  const line = (element: WorkbenchBrowserAgentObservation["elements"][number], elements: WorkbenchBrowserAgentObservation["elements"]) =>
    formatAffordanceLine({ ...element, id: 0 }, elements);
  const changes = next.elements.flatMap(element => {
    const prior = before.get(element.targetRef);
    if (prior === undefined || line(prior, previous.elements) === line(element, next.elements)) return [];
    return [`Updated ${formatAffordanceLine(element, next.elements)}${element.disabled || element.cursorOnly ? "" : " enabled"}`];
  });
  const priorNotes = previous.pageNotes ?? [];
  const notes = next.pageNotes ?? [];
  const contextChanged = JSON.stringify(priorNotes) !== JSON.stringify(notes);
  const notesBefore = new Map(priorNotes.map(note => [note.id, note]));
  const changedNotes = notes.filter(note => JSON.stringify(notesBefore.get(note.id)) !== JSON.stringify(note));
  const removedNotes = priorNotes.filter(note => !notes.some(current => current.id === note.id));
  const lines = [
    ...(contextChanged ? [
      ...(changedNotes.length ? [formatPageNotes(changedNotes)] : []),
      ...(notes.length === 0 ? ["Read-only page context cleared."]
        : removedNotes.map(note => `Read-only context removed: ${note.kind}: ${note.text}`))
    ] : []),
    ...changes,
    ...added.map(element => `Added ${formatAffordanceLine(element, next.elements)}`),
    ...removed.map(element => `No longer mapped ${element.targetRef} ${JSON.stringify(element.label)} (may be hidden, covered, or detached)`)
  ];
  // Large transitions still need explicit removals and additions. A full map
  // alone loses the evidence that a sidebar opened or a conversation disappeared.
  const appendix = added.length + removed.length > 6
    ? [
        `Surface changes: ${added.length} added, ${removed.length} removed, ${changes.length} updated.`,
        ...(added.length ? [`Added targets: ${added.map(element => element.targetRef).join(", ")}`] : []),
        ...removed.map(element => `No longer mapped ${element.targetRef} ${JSON.stringify(element.label)} (may be hidden, covered, or detached)`),
        next.mapAppendix
      ].join("\n")
    : lines.length > 0 ? lines.join("\n") : "Controls unchanged. Use the same targetRefs.";
  const bounded = appendix.length <= MAP_PRESENTATION_CHARS ? appendix
    : `Surface changes: ${added.length} added, ${removed.length} removed, ${changes.length} updated.\n`
      + presentBrowserMap({ ...next, mapAppendix: "" });
  return { observation: { ...next, mapAppendix: bounded } };
};
