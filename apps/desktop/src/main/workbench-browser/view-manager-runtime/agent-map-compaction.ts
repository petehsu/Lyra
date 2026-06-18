import type {
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentMapCompaction,
  WorkbenchBrowserAgentObservation
} from "../types";

const elementCompactionKey = (element: WorkbenchBrowserAgentElement): string =>
  element.targetRef.length > 0
    ? element.targetRef
    : `${element.id}|${element.role}|${element.label}|${element.selectorPreview}`;

const elementSnapshot = (element: WorkbenchBrowserAgentElement): string =>
  [
    element.role,
    element.label,
    element.selectorPreview,
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height,
    element.disabled ? "1" : "0"
  ].join("|");

export const compactMapObservation = (
  previous: WorkbenchBrowserAgentObservation | undefined,
  next: WorkbenchBrowserAgentObservation
): {
  readonly observation: WorkbenchBrowserAgentObservation;
  readonly compaction?: WorkbenchBrowserAgentMapCompaction;
} => {
  if (
    previous === undefined
    || previous.url !== next.url
    || previous.elements.length === 0
    || next.elements.length === 0
  ) {
    return { observation: next };
  }

  const previousByKey = new Map(
    previous.elements.map((element) => [elementCompactionKey(element), element] as const)
  );
  const nextByKey = new Map(
    next.elements.map((element) => [elementCompactionKey(element), element] as const)
  );

  const deltas: WorkbenchBrowserAgentMapCompaction["deltas"][number][] = [];
  let unchangedCount = 0;
  let changedCount = 0;

  for (const element of next.elements) {
    const key = elementCompactionKey(element);
    const prior = previousByKey.get(key);
    if (prior === undefined) {
      deltas.push({
        id: element.id,
        targetRef: element.targetRef,
        role: element.role,
        label: element.label,
        change: "added"
      });
      continue;
    }
    if (elementSnapshot(prior) === elementSnapshot(element)) {
      unchangedCount += 1;
      continue;
    }
    changedCount += 1;
    deltas.push({
      id: element.id,
      targetRef: element.targetRef,
      role: element.role,
      label: element.label,
      change: "changed"
    });
  }

  let removedCount = 0;
  for (const element of previous.elements) {
    const key = elementCompactionKey(element);
    if (!nextByKey.has(key)) {
      removedCount += 1;
      deltas.push({
        id: element.id,
        targetRef: element.targetRef,
        role: element.role,
        label: element.label,
        change: "removed"
      });
    }
  }

  if (deltas.length === 0) {
    return { observation: next };
  }

  const overlap = unchangedCount / Math.max(1, previous.elements.length);
  if (overlap < 0.45) {
    return { observation: next };
  }

  const summary = [
    `Map delta for ${next.title || next.url}:`,
    `${unchangedCount} unchanged`,
    `${deltas.filter((entry) => entry.change === "added").length} added`,
    `${removedCount} removed`,
    `${changedCount} changed`
  ].join("; ");

  return {
    observation: {
      ...next,
      mapCompaction: {
        kind: "delta",
        previousObservationId: previous.observationId,
        unchangedCount,
        addedCount: deltas.filter((entry) => entry.change === "added").length,
        removedCount,
        changedCount,
        summary,
        deltas: deltas.slice(0, 40)
      }
    },
    compaction: {
      kind: "delta",
      previousObservationId: previous.observationId,
      unchangedCount,
      addedCount: deltas.filter((entry) => entry.change === "added").length,
      removedCount,
      changedCount,
      summary,
      deltas: deltas.slice(0, 40)
    }
  };
};