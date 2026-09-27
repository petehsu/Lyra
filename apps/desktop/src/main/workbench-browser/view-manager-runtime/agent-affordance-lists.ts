import type { WorkbenchBrowserAgentElement, WorkbenchBrowserAgentScrollHint } from "../types";
import { formatCursorHint } from "./agent-cursor-semantics";

const STRICT_TAGS = new Set(["button", "a", "input", "select", "textarea", "summary"]);
const STRICT_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "tab",
  "menuitem",
  "textbox",
  "searchbox",
  "combobox",
  "switch",
  "slider",
  "spinbutton",
  "option",
  "treeitem",
  "menuitemcheckbox",
  "menuitemradio"
]);
const FORM_TAGS = new Set(["input", "select", "textarea"]);

export type AffordanceListFields = Pick<
  WorkbenchBrowserAgentElement,
  "id" | "frameRef" | "tagName" | "role" | "label" | "bounds"
> & {
  readonly targetRef?: string;
  readonly cursor?: WorkbenchBrowserAgentElement["cursor"];
  readonly cursorOnly?: boolean;
  readonly ancestorTargetRefs?: readonly string[];
  readonly stateHint?: string;
  readonly semantics?: WorkbenchBrowserAgentElement["semantics"];
  readonly expanded?: boolean;
  readonly tooltipText?: string;
  readonly tooltipProbe?: "found" | "empty";
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly editable?: boolean;
  readonly textSnippet?: string;
  readonly inputType?: string;
  readonly formGroup?: string;
  readonly href?: string;
  readonly xpath?: string;
  readonly controlKind?: WorkbenchBrowserAgentElement["controlKind"];
  readonly hostChainFingerprint?: string;
  readonly discoveryScope?: WorkbenchBrowserAgentElement["discoveryScope"];
  readonly visibility?: WorkbenchBrowserAgentElement["visibility"];
  readonly selectorPreview?: string;
  readonly sameActionGroup?: string;
  readonly menuItems?: readonly string[];
  readonly menuSameAs?: string;
};

const areaOf = (bounds: AffordanceListFields["bounds"]): number =>
  Math.max(0, bounds.width) * Math.max(0, bounds.height);

export const isStrictAffordance = (element: AffordanceListFields): boolean => {
  const tag = element.tagName.toLowerCase();
  if (STRICT_TAGS.has(tag) || element.editable === true) {
    return true;
  }
  if (
    element.controlKind === "button"
    || element.controlKind === "link"
    || element.controlKind === "input"
    || element.controlKind === "select"
    || element.controlKind === "textarea"
    || element.controlKind === "editable"
  ) {
    return true;
  }
  return STRICT_ROLES.has(element.role.toLowerCase());
};

export const isFormField = (element: AffordanceListFields): boolean => {
  if (element.controlKind === "input" || element.controlKind === "select" || element.controlKind === "textarea" || element.controlKind === "editable") {
    return true;
  }
  return FORM_TAGS.has(element.tagName.toLowerCase()) || element.editable === true;
};

const sameShadowContext = (left: AffordanceListFields, right: AffordanceListFields): boolean =>
  (left.hostChainFingerprint ?? "") === (right.hostChainFingerprint ?? "");

const xpathDescendant = (inner: AffordanceListFields, outer: AffordanceListFields): boolean => {
  const innerPath = inner.xpath ?? "";
  const outerPath = outer.xpath ?? "";
  if (innerPath.length === 0 || outerPath.length === 0 || innerPath === outerPath) {
    return false;
  }
  return innerPath.startsWith(`${outerPath}/`);
};

const boundsContains = (outer: AffordanceListFields, inner: AffordanceListFields, pad = 2): boolean => {
  const o = outer.bounds;
  const i = inner.bounds;
  return (
    i.x >= o.x - pad
    && i.y >= o.y - pad
    && i.x + i.width <= o.x + o.width + pad
    && i.y + i.height <= o.y + o.height + pad
  );
};

export const isNestedAffordance = (inner: AffordanceListFields, outer: AffordanceListFields): boolean => {
  if (inner.id === outer.id || inner.frameRef !== outer.frameRef) {
    return false;
  }
  if (inner.ancestorTargetRefs !== undefined) {
    return outer.targetRef !== undefined && inner.ancestorTargetRefs.includes(outer.targetRef);
  }
  return sameShadowContext(inner, outer) && xpathDescendant(inner, outer);
};

const isDistinctNestedControl = (parent: AffordanceListFields, child: AffordanceListFields): boolean => {
  if (isFormField(child)) {
    return true;
  }
  const parentHref = parent.href ?? "";
  const childHref = child.href ?? "";
  return childHref.length > 0 && childHref !== parentHref && isStrictAffordance(child);
};

export const isRowEdgeIcon = (inner: AffordanceListFields, outer: AffordanceListFields): boolean =>
  isNestedAffordance(inner, outer) && iconPieceOf(inner, outer)
  && inner.bounds.x + inner.bounds.width >= outer.bounds.x + outer.bounds.width - 48;

const rowTitleForEdgeIcon = (
  element: AffordanceListFields,
  elements: readonly AffordanceListFields[]
): string | null => {
  let bestLabel: string | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  const centerX = element.bounds.x + element.bounds.width / 2;
  const centerY = element.bounds.y + element.bounds.height / 2;
  for (const other of elements) {
    if (other.id === element.id || !isRowEdgeIcon(element, other)) continue;
    const label = other.label.trim();
    if (label.length === 0 || label === "(no label)" || label === "image") continue;
    const box = other.bounds;
    if (centerX < box.x || centerY < box.y || centerX > box.x + box.width || centerY > box.y + box.height) continue;
    const area = box.width * box.height;
    if (area >= bestArea) continue;
    bestArea = area;
    bestLabel = label;
  }
  return bestLabel;
};

const iconPieceOf = (inner: AffordanceListFields, outer: AffordanceListFields): boolean => {
  const width = inner.bounds.width;
  const height = inner.bounds.height;
  return width > 0
    && height > 0
    && width <= 48
    && height <= 48
    && width < outer.bounds.width * 0.5
    && !isFormField(inner);
};

export const collapseNestedAffordances = <T extends AffordanceListFields>(
  elements: readonly T[]
): T[] => {
  const drop = new Set<number>();
  const groupOf = new Map<number, number>();
  const link = (outerId: number, innerId: number): void => {
    const root = groupOf.get(outerId) ?? outerId;
    groupOf.set(outerId, root);
    groupOf.set(innerId, root);
  };
  for (const outer of elements) {
    for (const inner of elements) {
      if (!isNestedAffordance(inner, outer)) {
        continue;
      }
      if (inner.stateHint === "hover" || outer.stateHint === "hover") {
        continue;
      }
      const graphic = new Set(["path", "g", "circle", "rect", "line", "polyline", "polygon", "use"]);
      if (graphic.has(inner.tagName.toLowerCase())) {
        drop.add(inner.id);
        continue;
      }
      if (isStrictAffordance(inner) && iconPieceOf(inner, outer)) {
        continue;
      }
      if (inner.tagName.toLowerCase() === "svg" && iconPieceOf(inner, outer)) {
        continue;
      }
      if (isRowEdgeIcon(inner, outer)) {
        continue;
      }
      if (isDistinctNestedControl(outer, inner)) {
        if (!isStrictAffordance(outer) || isFormField(inner)) {
          drop.add(outer.id);
        }
        continue;
      }
      if (isStrictAffordance(outer)) {
        drop.add(inner.id);
        continue;
      }
      if (iconPieceOf(inner, outer) && !isStrictAffordance(inner)) {
        link(outer.id, inner.id);
        continue;
      }
      if (isStrictAffordance(inner)) {
        drop.add(outer.id);
        continue;
      }
      drop.add(outer.id);
    }
  }
  return elements.filter((element) => !drop.has(element.id)).map((element) => {
    const root = groupOf.get(element.id);
    if (root === undefined || isStrictAffordance(element)) return element;
    let count = 0;
    for (const value of groupOf.values()) {
      if (value === root) count += 1;
    }
    return count < 2 ? element : { ...element, sameActionGroup: `action:${root}` };
  });
};

const labelKey = (label: string): string => label.replace(/\s+/g, "").trim().toLowerCase();

/** A box whose name is only the names of the controls inside it is the row, not another control. */
export const dropLabelContainers = <T extends AffordanceListFields>(
  elements: readonly T[]
): T[] => {
  const drop = new Set<number>();
  for (const outer of elements) {
    if (isStrictAffordance(outer) || isFormField(outer)) continue;
    const inners = elements.filter((inner) => {
      if (inner.id === outer.id || drop.has(inner.id)) return false;
      if (!isNestedAffordance(inner, outer) || !boundsContains(outer, inner)) return false;
      return areaOf(inner.bounds) < areaOf(outer.bounds) * 0.9;
    });
    if (inners.length < 2) continue;
    const joined = inners
      .map((inner) => inner.label.trim())
      .filter((label) => label.length > 0 && label !== "(no label)")
      .join("");
    const outerLabel = labelKey(outer.label);
    if (outerLabel.length > 0 && outerLabel === labelKey(joined)) drop.add(outer.id);
  }
  return elements.filter((element) => !drop.has(element.id));
};

export const elementIsInViewport = (
  element: AffordanceListFields,
  viewportWidth: number,
  viewportHeight: number
): boolean => {
  if (element.discoveryScope === "visual" || element.discoveryScope === "coordinate") {
    return true;
  }
  if (element.visibility?.offscreen === true) {
    return false;
  }
  if (element.visibility?.offscreen === false) {
    return true;
  }
  const bounds = element.bounds;
  return (
    bounds.x < viewportWidth
    && bounds.y < viewportHeight
    && bounds.x + bounds.width > 0
    && bounds.y + bounds.height > 0
  );
};

export const splitAffordanceColumns = <T extends AffordanceListFields>(
  elements: readonly T[],
  viewportWidth: number,
  viewportHeight: number
): { readonly inViewport: T[]; readonly needsScroll: T[] } => {
  const inViewport: T[] = [];
  const needsScroll: T[] = [];
  for (const element of elements) {
    if (elementIsInViewport(element, viewportWidth, viewportHeight)) {
      inViewport.push(element);
    } else {
      needsScroll.push(element);
    }
  }
  const byReadingOrder = (left: T, right: T): number =>
    left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x || left.id - right.id;
  inViewport.sort(byReadingOrder);
  needsScroll.sort(byReadingOrder);
  return { inViewport, needsScroll };
};

const TOGGLE_ON = new Set(["pressed", "selected", "checked", "on"]);
const TOGGLE_OFF = new Set(["unpressed", "unselected", "unchecked", "off"]);

export const affordanceStateWord = (element: {
  readonly checked?: boolean;
  readonly stateHint?: string;
}): "on" | "off" | null => {
  if (element.checked === true) return "on";
  if (element.checked === false) return "off";
  const hint = element.stateHint?.trim().toLowerCase() ?? "";
  if (TOGGLE_ON.has(hint)) return "on";
  if (TOGGLE_OFF.has(hint)) return "off";
  return null;
};

const VALUE_INPUT_SKIP = new Set(["hidden", "button", "submit", "reset", "file", "checkbox", "radio"]);

export const fieldCurrentValue = (element: AffordanceListFields): string | null => {
  const tag = element.tagName.toLowerCase();
  const type = (element.inputType ?? "").toLowerCase();
  const isField = tag === "textarea"
    || tag === "select"
    || element.editable === true
    || (tag === "input" && !VALUE_INPUT_SKIP.has(type));
  return isField ? (element.textSnippet ?? "") : null;
};

export const formatAffordanceLine = (
  element: AffordanceListFields,
  elements: readonly AffordanceListFields[],
  viewportHeight = 0
): string => {
  const targetRef = element.targetRef ?? "";
  const idNote = targetRef.length > 0
    ? `[${element.id} targetRef=${targetRef}]`
    : `[${element.id}]`;
  const role = element.role.trim().length > 0 ? element.role : element.tagName;
  const facts = element.semantics;
  const state = typeof facts?.checked === "boolean" ? (facts.checked ? "on" : "off")
    : facts?.checked === "mixed" || facts?.checked === "unknown" || facts?.pressed === "mixed"
      || facts?.selected !== undefined ? null : affordanceStateWord(element);
  const value = fieldCurrentValue(element);
  const unnamed = element.label === "(no label)" || element.label.replace(/[\s\u3164\u2800\u200b\u200c\u200d\ufeff]/g, "").length === 0;
  const location = `x=${Math.round(element.bounds.x)}, y=${Math.round(element.bounds.y)}`;
  const region = element.bounds.y < 96 ? "top of this window"
    : viewportHeight > 0 && element.bounds.y > viewportHeight - 96 ? "bottom of this window" : "this window";
  const descriptor = `unnamed ${role} at ${region} (${location})`;
  let line = `${idNote} ${role}: ${JSON.stringify(unnamed ? descriptor : element.label)}`;
  if (element.cursor) line += ` ${formatCursorHint(element.cursor)}`;
  if (element.cursorOnly) line += " cursor-hint-only; operation unverified";
  if (unnamed) line += element.tooltipProbe === "empty"
    ? " purpose=unknown; no unambiguous tooltip found during bounded hover"
    : " purpose=unknown; hover to read its tooltip";
  if (state !== null) line += ` ${state}`;
  if (facts?.checked === "mixed") line += " checked=mixed";
  if (facts?.checked === "unknown") line += " checked=unknown";
  if (facts?.pressed !== undefined) line += ` pressed=${facts.pressed}`;
  if (facts?.selected !== undefined) line += facts.selected ? " selected" : " unselected";
  if (element.expanded !== undefined) line += element.expanded ? " expanded" : " collapsed";
  if (facts?.current) line += ` current=${facts.current}`;
  if (facts?.focused) line += " focused";
  if (value !== null) line += value.length === 0 ? ` = ""` : ` = ${value}`;
  if (facts?.valueText !== undefined && facts.valueText !== value) line += ` value=${JSON.stringify(facts.valueText)}`;
  if (element.visibility?.covered === true) line += " [covered; resolve overlay before activation]";
  if (element.disabled === true) line += " disabled";
  if (facts?.readOnly) line += " readonly";
  if (facts?.required) line += " required";
  if (facts?.busy) line += " busy";
  if (facts?.invalid) line += ` invalid=${facts.invalid}`;
  if (facts?.validationMessage) line += ` error=${JSON.stringify(facts.validationMessage)}`;
  const description = facts?.description || element.tooltipText;
  if (description && description !== element.label) line += ` description=${JSON.stringify(description)}`;
  if (facts?.constraints) {
    for (const [key, constraint] of Object.entries(facts.constraints)) line += ` ${key}=${JSON.stringify(constraint)}`;
  }
  if (facts?.context?.length) line += ` in ${facts.context.map(value => JSON.stringify(value)).join(" / ")}`;
  if (facts?.controls?.length) line += ` controls=${JSON.stringify(facts.controls)}`;
  if (facts?.activeDescendant) line += ` activeCandidate=${JSON.stringify(facts.activeDescendant)}`;
  if (facts?.popup) line += ` opens=${facts.popup}`;
  if (facts?.appearance) line += ` appearance=${JSON.stringify(facts.appearance)}`;
  if (element.stateHint === "hover") {
    line += " shows on hover";
  }
  if (element.menuItems !== undefined && element.menuItems.length > 0) {
    line += ` click opens menu: ${element.menuItems.join(", ")}`;
  } else if (element.menuSameAs !== undefined && element.menuSameAs.length > 0) {
    line += ` click opens the same menu as ${element.menuSameAs}`;
  }
  const bottom = element.bounds.y + element.bounds.height;
  const blankName = element.label.replace(/[\s\u3164\u2800\u200b\u200c\u200d\ufeff]/g, "").length === 0;
  if (
    (element.label === "(no label)" || element.label === "image" || blankName)
    && viewportHeight > 0
    && element.bounds.y > viewportHeight * 0.5
    && bottom >= viewportHeight - 72
  ) {
    line += " bottom of this window";
  }
  if (element.label === "(no label)" || blankName) {
    const rowTitle = rowTitleForEdgeIcon(element, elements);
    if (rowTitle !== null) line += ` icon at the end of "${rowTitle}"`;
  }
  return line;
};

/** Few cleaned controls are sent together, even if the page is long. */
export const SURFACE_MAP_SEND_ALL_LIMIT = 24;

export const surfaceMapElements = <T>(
  inViewport: readonly T[],
  outside: readonly T[]
): { readonly elements: T[]; readonly remaining: number } => {
  if (inViewport.length + outside.length <= SURFACE_MAP_SEND_ALL_LIMIT) {
    return { elements: [...inViewport, ...outside], remaining: 0 };
  }
  return { elements: [...inViewport], remaining: outside.length };
};

export const surfaceControlSignature = (element: {
  readonly frameTreeNodeId: number;
  readonly tagName: string;
  readonly role: string;
  readonly label: string;
  readonly selectorPreview: string;
  readonly href?: string;
  readonly inputType?: string;
}): string => [
  element.frameTreeNodeId,
  element.tagName,
  element.role,
  element.label.trim().toLowerCase(),
  element.selectorPreview,
  element.href ?? "",
  element.inputType ?? ""
].join("|");

export const reuseSurfaceTargetRefs = <T extends WorkbenchBrowserAgentElement>(
  previous: readonly T[],
  next: readonly T[]
): readonly T[] | null => {
  if (previous.length === 0 || previous.length !== next.length) return null;
  const grouped = (elements: readonly T[]): Map<string, T[]> => {
    const groups = new Map<string, T[]>();
    for (const element of elements) {
      const key = surfaceControlSignature(element);
      const list = groups.get(key);
      if (list === undefined) groups.set(key, [element]);
      else list.push(element);
    }
    for (const list of groups.values()) list.sort((left, right) => left.id - right.id);
    return groups;
  };
  const before = grouped(previous);
  const after = grouped(next);
  if (before.size !== after.size) return null;
  const replaced = new Map<number, T>();
  for (const [key, nextGroup] of after) {
    const previousGroup = before.get(key);
    if (previousGroup === undefined || previousGroup.length !== nextGroup.length) return null;
    for (let index = 0; index < nextGroup.length; index += 1) {
      const prior = previousGroup[index];
      const item = nextGroup[index];
      if (prior === undefined || item === undefined) return null;
      replaced.set(item.id, {
        ...item,
        stableId: prior.stableId,
        targetRef: prior.targetRef,
        elementFingerprint: prior.elementFingerprint,
        target: {
          ...item.target,
          targetRef: prior.targetRef,
          elementFingerprint: prior.elementFingerprint
        }
      });
    }
  }
  return next.map((element) => replaced.get(element.id) ?? element);
};

export const applyHoverMenus = <T extends AffordanceListFields>(
  elements: readonly T[],
  opened: readonly { readonly signature: string; readonly items: readonly string[] }[]
): T[] => {
  const firstRef = new Map<string, string>();
  return elements.map((element) => {
    if (element.stateHint !== "hover") return element;
    const signature = element.selectorPreview ?? "";
    const sample = opened.find((entry) => entry.signature === signature && entry.items.length > 0);
    if (sample === undefined || signature.length === 0) return element;
    const ref = element.targetRef ?? "";
    const prior = firstRef.get(signature);
    if (prior === undefined) {
      if (ref.length > 0) firstRef.set(signature, ref);
      return { ...element, menuItems: sample.items };
    }
    return { ...element, menuSameAs: prior };
  });
};

const clusterRows = (elements: readonly AffordanceListFields[]): AffordanceListFields[][] => {
  const rows: AffordanceListFields[][] = [];
  const sorted = [...elements].sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x || left.id - right.id);
  for (const element of sorted) {
    const mid = element.bounds.y + element.bounds.height / 2;
    const row = rows.find((entry) => {
      const top = Math.min(...entry.map((item) => item.bounds.y));
      const bottom = Math.max(...entry.map((item) => item.bounds.y + item.bounds.height));
      return mid >= top - 4 && mid <= bottom + 4;
    });
    if (row === undefined) rows.push([element]);
    else row.push(element);
  }
  return rows;
};

/** Layout orders the reading list; it cannot establish shared ownership or actions. */
export const crossMapLines = (
  elements: readonly AffordanceListFields[],
  viewportHeight = 0,
  _task = ""
): string[] => {
  return clusterRows(elements).flatMap(row =>
    row.map(element => formatAffordanceLine(element, elements, viewportHeight)));
};

export const formatAffordanceListsForMap = (
  inViewport: readonly AffordanceListFields[],
  needsScroll: readonly AffordanceListFields[],
  remaining = 0,
  viewportHeight = 0,
  task = ""
): string => {
  const listed = [...inViewport, ...needsScroll];
  const lines = [listed.some(element => element.cursorOnly) ? "Mapped controls and interaction candidates:" : "Now operable:"];
  if (listed.some(element => element.cursor)) lines.push("CSS cursor hints describe appearance, not verified actions, editable/disabled state, or successful outcomes.");
  const emit = (elements: readonly AffordanceListFields[]): string[] => {
    const seen = new Set<string>();
    const emitted: string[] = [];
    for (const element of elements) {
      const group = element.sameActionGroup;
      if (group === undefined) {
        emitted.push(formatAffordanceLine(element, listed, viewportHeight));
        continue;
      }
      if (seen.has(group)) continue;
      seen.add(group);
      const members = elements.filter((entry) => entry.sameActionGroup === group);
      emitted.push("same action, click any:");
      emitted.push(...members.map((entry) => formatAffordanceLine(entry, listed, viewportHeight)));
    }
    return emitted;
  };
  if (inViewport.length === 0) {
    lines.push("(none)");
  } else {
    lines.push(...crossMapLines(inViewport, viewportHeight, task));
  }
  if (remaining > 0) {
    lines.push(`Outside this window: ${remaining} more operable controls. Scroll, then map again.`);
  } else if (needsScroll.length > 0) {
    lines.push("Also on this page:");
    lines.push(...emit(needsScroll));
  }
  const emptyFields = listed.filter((element) => {
    const value = fieldCurrentValue(element);
    return value !== null && value.length === 0 && (element.targetRef ?? "").length > 0;
  });
  if (emptyFields.length >= 2) {
    lines.push("Empty inputs are one browser_type call using fields, one targetRef and text per input.");
  }
  return lines.join("\n");
};

export const scrollHintsFromNeedsScroll = (
  needsScroll: readonly AffordanceListFields[],
  viewportHeight: number
): readonly WorkbenchBrowserAgentScrollHint[] =>
  needsScroll.slice(0, 8).map((element) => ({
    frameRef: element.frameRef,
    tag: element.tagName,
    text: element.label.trim().length > 0 ? element.label.slice(0, 40) : "(no label)",
    pagesDown: viewportHeight > 0
      ? Math.max(0, Math.round((element.bounds.y / viewportHeight) * 10) / 10)
      : 0
  }));
