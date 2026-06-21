import { buildElementDiff, diffElementStates, elementStateFromCached } from "./agent-element-probe";
import type {
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentElementDiff,
  WorkbenchBrowserAgentElementState,
  WorkbenchBrowserAgentObservation
} from "../types";

export type AgentObservationDiff = {
  readonly added: readonly WorkbenchBrowserAgentElement[];
  readonly removed: readonly WorkbenchBrowserAgentElement[];
  readonly changed: readonly {
    readonly targetRef: string;
    readonly changes: readonly string[];
  }[];
};

export type ActionOutcomeVerification = {
  readonly verified: boolean;
  readonly signals: readonly string[];
  readonly elementDiff?: WorkbenchBrowserAgentElementDiff;
  readonly observationDiff?: AgentObservationDiff;
};

const observationElementKey = (element: WorkbenchBrowserAgentElement): string =>
  element.targetRef.length > 0
    ? element.targetRef
    : `${element.id}|${element.role}|${element.label}|${element.selectorPreview}`;

const observationElementSnapshot = (element: WorkbenchBrowserAgentElement): string =>
  [
    element.role,
    element.label,
    element.selectorPreview,
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height,
    element.disabled ? "1" : "0",
    element.textSnippet ?? "",
    element.editable === true ? "1" : "0"
  ].join("|");

export const buildObservationDiff = (
  priorElements: readonly WorkbenchBrowserAgentElement[],
  nextElements: readonly WorkbenchBrowserAgentElement[]
): AgentObservationDiff => {
  const priorByKey = new Map(
    priorElements.map((element) => [observationElementKey(element), element] as const)
  );
  const nextByKey = new Map(
    nextElements.map((element) => [observationElementKey(element), element] as const)
  );

  const added: WorkbenchBrowserAgentElement[] = [];
  const changed: AgentObservationDiff["changed"][number][] = [];

  for (const element of nextElements) {
    const key = observationElementKey(element);
    const prior = priorByKey.get(key);
    if (prior === undefined) {
      added.push(element);
      continue;
    }
    if (observationElementSnapshot(prior) !== observationElementSnapshot(element)) {
      changed.push({
        targetRef: element.targetRef,
        changes: diffElementStates(elementStateFromCached(prior), elementStateFromCached(element))
      });
    }
  }

  const removed = priorElements.filter((element) => !nextByKey.has(observationElementKey(element)));

  return { added, removed, changed };
};

export const verifyActionOutcome = (input: {
  readonly interaction?: string;
  readonly targetRef?: string;
  readonly priorUrl?: string;
  readonly priorElement?: WorkbenchBrowserAgentElementState;
  readonly priorObservation?: Pick<WorkbenchBrowserAgentObservation, "elements" | "url">;
  readonly observation: WorkbenchBrowserAgentObservation;
}): ActionOutcomeVerification => {
  const signals: string[] = [];

  if (
    input.priorUrl !== undefined
    && input.priorUrl.length > 0
    && input.priorUrl !== input.observation.url
  ) {
    signals.push("page_url_changed");
  }

  if (input.targetRef !== undefined && input.priorElement !== undefined) {
    const target = input.observation.elements.find(
      (element) => element.targetRef === input.targetRef
    );
    if (target !== undefined) {
      const diff = buildElementDiff(input.priorElement, elementStateFromCached(target));
      if ("changed" in diff && diff.changed.length > 0) {
        return {
          verified: true,
          signals: ["target_element_changed", ...signals],
          elementDiff: diff
        };
      }
      if ("noObservableChange" in diff) {
        signals.push("target_element_unchanged");
      }
    } else {
      signals.push("target_element_absent");
    }
  }

  if (
    input.interaction === "click"
    && input.priorElement?.value !== undefined
    && input.priorElement.value.length > 0
  ) {
    const clearedEditable = input.observation.elements.find(
      (element) =>
        element.editable === true
        && (element.textSnippet ?? "").length === 0
        && element.disabled !== true
    );
    if (clearedEditable !== undefined) {
      return {
        verified: true,
        signals: ["editable_field_cleared", ...signals]
      };
    }
  }

  if (input.priorObservation !== undefined) {
    const samePage = input.priorObservation.url === input.observation.url
      || input.priorObservation.url.length === 0;
    if (samePage) {
      const observationDiff = buildObservationDiff(
        input.priorObservation.elements,
        input.observation.elements
      );
      if (observationDiff.added.length > 0) {
        return {
          verified: true,
          signals: ["observation_elements_added", ...signals],
          observationDiff
        };
      }
      if (observationDiff.changed.length > 0) {
        return {
          verified: true,
          signals: ["observation_elements_changed", ...signals],
          observationDiff
        };
      }
      if (observationDiff.removed.length > 0) {
        signals.push("observation_elements_removed");
      }
    }
  }

  return {
    verified: signals.includes("page_url_changed") || signals.includes("target_element_absent"),
    signals
  };
};