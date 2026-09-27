import type { WorkbenchBrowserAgentObservation } from "../workbench-browser/types";
import { indexedMapElements } from "../workbench-browser/view-manager-runtime/agent-map-presentation";

/** The controller owns the full index. The tool transport owns only this view. */
export const lumenMapResult = (observation: WorkbenchBrowserAgentObservation, mapAppendix: string) => {
  const { elements: _elements, targets: _targets, inViewport: _viewport, needsScroll: _outside,
    semanticTree: _tree, focusOrder: _focusOrder, ...metadata } = observation;
  const refs = new Set([...mapAppendix.matchAll(/targetRef=([^\s\]]+)\]/g)].map(match => match[1]));
  const all = indexedMapElements(observation);
  const shown = all.filter(element => refs.has(element.targetRef));
  return {
    ...metadata,
    mapAppendix,
    indexCount: all.length,
    presentedCount: shown.length,
    elements: shown.map(element => ({
      id: element.id, targetRef: element.targetRef, role: element.role, label: element.label,
      bounds: element.bounds, disabled: element.disabled, editable: element.editable
    }))
  };
};
