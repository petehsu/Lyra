import type { WorkbenchBrowserAgentElement, WorkbenchBrowserAgentScrollHint } from "../types";

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
  "slider"
]);
const FORM_TAGS = new Set(["input", "select", "textarea"]);

export type AffordanceListFields = Pick<
  WorkbenchBrowserAgentElement,
  "id" | "frameRef" | "tagName" | "role" | "label" | "bounds"
> & {
  readonly targetRef?: string;
  readonly href?: string;
  readonly xpath?: string;
  readonly editable?: boolean;
  readonly controlKind?: WorkbenchBrowserAgentElement["controlKind"];
  readonly hostChainFingerprint?: string;
  readonly discoveryScope?: WorkbenchBrowserAgentElement["discoveryScope"];
  readonly visibility?: WorkbenchBrowserAgentElement["visibility"];
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

const isFormField = (element: AffordanceListFields): boolean => {
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
  return innerPath.startsWith(`${outerPath}/`) || innerPath.startsWith(`${outerPath}[`);
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

const isNestedAffordance = (inner: AffordanceListFields, outer: AffordanceListFields): boolean => {
  if (inner.id === outer.id || inner.frameRef !== outer.frameRef || !sameShadowContext(inner, outer)) {
    return false;
  }
  if (xpathDescendant(inner, outer)) {
    return true;
  }
  const outerArea = areaOf(outer.bounds);
  const innerArea = areaOf(inner.bounds);
  if (outerArea <= 0 || innerArea >= outerArea * 0.95) {
    return false;
  }
  return boundsContains(outer, inner);
};

const isDistinctNestedControl = (parent: AffordanceListFields, child: AffordanceListFields): boolean => {
  if (isFormField(child)) {
    return true;
  }
  const parentHref = parent.href ?? "";
  const childHref = child.href ?? "";
  return childHref.length > 0 && childHref !== parentHref && isStrictAffordance(child);
};

export const collapseNestedAffordances = <T extends AffordanceListFields>(
  elements: readonly T[]
): T[] => {
  const drop = new Set<number>();
  for (const outer of elements) {
    for (const inner of elements) {
      if (!isNestedAffordance(inner, outer)) {
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
      if (isStrictAffordance(inner)) {
        drop.add(outer.id);
        continue;
      }
      drop.add(outer.id);
    }
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

const formatAffordanceLine = (element: AffordanceListFields): string => {
  const targetRef = element.targetRef ?? "";
  const idNote = targetRef.length > 0
    ? `[${element.id} targetRef=${targetRef}]`
    : `[${element.id}]`;
  const role = element.role.trim().length > 0 ? element.role : element.tagName;
  return `${idNote} ${role}: "${element.label}"`;
};

export const formatAffordanceListsForMap = (
  inViewport: readonly AffordanceListFields[],
  needsScroll: readonly AffordanceListFields[]
): string => {
  const lines = ["Now clickable:"];
  if (inViewport.length === 0) {
    lines.push("(none)");
  } else {
    lines.push(...inViewport.map(formatAffordanceLine));
  }
  if (needsScroll.length > 0) {
    lines.push("Needs scroll (act on these; do not call scroll, find, or ensure_visible):");
    lines.push(...needsScroll.map(formatAffordanceLine));
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
