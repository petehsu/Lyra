import type { WorkbenchBrowserDebuggerSession } from "../types";
import type {
  WorkbenchBrowserAgentElement,
  WorkbenchBrowserAgentElementBounds
} from "../types";

export const REQUIRED_DOM_SNAPSHOT_COMPUTED_STYLES = [
  "display",
  "visibility",
  "opacity",
  "overflow",
  "overflow-x",
  "overflow-y",
  "cursor",
  "pointer-events",
  "position",
  "background-color"
] as const;

const DEFAULT_CONTAINMENT_THRESHOLD = 0.99;
const MAX_JS_LISTENER_PROBE_ELEMENTS = 10_000;
const MAX_JS_LISTENER_DISCOVERY = 48;

type AxisRect = {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
};

export type DomSnapshotNodeEnhancement = {
  readonly backendNodeId: number;
  readonly tagName: string;
  readonly bounds: WorkbenchBrowserAgentElementBounds;
  readonly paintOrder: number | null;
  readonly computedStyles: Readonly<Record<string, string>>;
  readonly attributes: Readonly<Record<string, string>>;
  readonly ignoredByPaintOrder: boolean;
  readonly visibleByComputedStyles: boolean;
  readonly hasJsClickListener: boolean;
};

export type DomObservationEnhancements = {
  readonly snapshotNodes: readonly DomSnapshotNodeEnhancement[];
  readonly jsClickListenerBackendIds: ReadonlySet<number>;
  readonly timingMs: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const readFiniteNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toBounds = (
  left: number,
  top: number,
  right: number,
  bottom: number
): WorkbenchBrowserAgentElementBounds | null => {
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) {
    return null;
  }
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(width),
    height: Math.round(height)
  };
};

const rectArea = (rect: AxisRect): number =>
  Math.max(0, rect.x2 - rect.x1) * Math.max(0, rect.y2 - rect.y1);

const rectContains = (outer: AxisRect, inner: AxisRect): boolean =>
  outer.x1 <= inner.x1
  && outer.y1 <= inner.y1
  && outer.x2 >= inner.x2
  && outer.y2 >= inner.y2;

const boundsToRect = (bounds: WorkbenchBrowserAgentElementBounds): AxisRect => ({
  x1: bounds.x,
  y1: bounds.y,
  x2: bounds.x + bounds.width,
  y2: bounds.y + bounds.height
});

const splitRectDifference = (left: AxisRect, right: AxisRect): AxisRect[] => {
  if (!rectContains(left, right) && !rectContains(right, left)) {
    const intersects = !(
      left.x2 <= right.x1
      || right.x2 <= left.x1
      || left.y2 <= right.y1
      || right.y2 <= left.y1
    );
    if (!intersects) {
      return [left];
    }
  }
  const parts: AxisRect[] = [];
  if (left.y1 < right.y1) {
    parts.push({ x1: left.x1, y1: left.y1, x2: left.x2, y2: right.y1 });
  }
  if (right.y2 < left.y2) {
    parts.push({ x1: left.x1, y1: right.y2, x2: left.x2, y2: left.y2 });
  }
  const yLo = Math.max(left.y1, right.y1);
  const yHi = Math.min(left.y2, right.y2);
  if (left.x1 < right.x1) {
    parts.push({ x1: left.x1, y1: yLo, x2: right.x1, y2: yHi });
  }
  if (right.x2 < left.x2) {
    parts.push({ x1: right.x2, y1: yLo, x2: left.x2, y2: yHi });
  }
  return parts.length > 0 ? parts : [left];
};

class RectUnion {
  private readonly rects: AxisRect[] = [];
  private readonly maxRects: number;

  constructor(maxRects = 5_000) {
    this.maxRects = maxRects;
  }

  contains(rect: AxisRect): boolean {
    return this.rects.some((entry) => rectContains(entry, rect));
  }

  add(rect: AxisRect): boolean {
    if (this.rects.length >= this.maxRects) {
      return false;
    }
    let pending: AxisRect[] = [rect];
    for (const existing of this.rects) {
      const next: AxisRect[] = [];
      for (const piece of pending) {
        if (rectContains(existing, piece)) {
          continue;
        }
        if (rectContains(piece, existing)) {
          next.push(...splitRectDifference(piece, existing));
          continue;
        }
        next.push(piece);
      }
      pending = next;
      if (pending.length === 0) {
        return true;
      }
    }
    this.rects.push(...pending);
    return true;
  }
}

const parseOpacity = (value: string | undefined): number => {
  if (value === undefined || value.trim().length === 0) {
    return 1;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 1;
};

const isTransparentPaintLayer = (styles: Readonly<Record<string, string>>): boolean => {
  const background = styles["background-color"] ?? "rgba(0, 0, 0, 0)";
  const opacity = parseOpacity(styles.opacity);
  return background === "rgba(0, 0, 0, 0)" || opacity < 0.8;
};

export const visibleByComputedStyles = (
  styles: Readonly<Record<string, string>>,
  tagName: string
): boolean => {
  const display = (styles.display ?? "").toLowerCase();
  const visibility = (styles.visibility ?? "").toLowerCase();
  const pointerEvents = (styles["pointer-events"] ?? "").toLowerCase();
  const opacity = parseOpacity(styles.opacity);
  const isFileInput = tagName.toLowerCase() === "input" && (styles as Record<string, string>).type === "file";
  if (display === "none" || visibility === "hidden") {
    return isFileInput;
  }
  if (opacity <= 0) {
    return isFileInput;
  }
  if (pointerEvents === "none") {
    return false;
  }
  return true;
};

const buildComputedStyles = (
  styleIndices: readonly number[],
  computedStyleNames: readonly string[],
  strings: readonly string[]
): Record<string, string> => {
  const styles: Record<string, string> = {};
  for (let index = 0; index < computedStyleNames.length; index += 1) {
    const styleIndex = styleIndices[index];
    const name = computedStyleNames[index];
    if (
      name === undefined
      || styleIndex === undefined
      || styleIndex < 0
      || styleIndex >= strings.length
    ) {
      continue;
    }
    styles[name] = strings[styleIndex] ?? "";
  }
  return styles;
};

export const buildPaintOrderIgnoredBackendIds = (
  nodes: readonly DomSnapshotNodeEnhancement[]
): ReadonlySet<number> => {
  const grouped = new Map<number, DomSnapshotNodeEnhancement[]>();
  for (const node of nodes) {
    if (node.paintOrder === null) {
      continue;
    }
    const bucket = grouped.get(node.paintOrder) ?? [];
    bucket.push(node);
    grouped.set(node.paintOrder, bucket);
  }

  const rectUnion = new RectUnion();
  const ignored = new Set<number>();
  const paintOrders = [...grouped.keys()].sort((left, right) => right - left);
  for (const paintOrder of paintOrders) {
    const bucket = grouped.get(paintOrder) ?? [];
    const rectsToAdd: AxisRect[] = [];
    for (const node of bucket) {
      const rect = boundsToRect(node.bounds);
      if (rectUnion.contains(rect)) {
        ignored.add(node.backendNodeId);
      }
      if (!isTransparentPaintLayer(node.computedStyles)) {
        rectsToAdd.push(rect);
      }
    }
    for (const rect of rectsToAdd) {
      rectUnion.add(rect);
    }
  }
  return ignored;
};

const intersectionArea = (left: AxisRect, right: AxisRect): number => {
  const xOverlap = Math.max(0, Math.min(left.x2, right.x2) - Math.max(left.x1, right.x1));
  const yOverlap = Math.max(0, Math.min(left.y2, right.y2) - Math.max(left.y1, right.y1));
  return xOverlap * yOverlap;
};

export const matchSnapshotNodeForElement = (
  element: Pick<WorkbenchBrowserAgentElement, "bounds" | "tagName" | "selectorPreview">,
  nodes: readonly DomSnapshotNodeEnhancement[]
): DomSnapshotNodeEnhancement | null => {
  const elementRect = boundsToRect(element.bounds);
  const elementArea = rectArea(elementRect);
  if (elementArea <= 0) {
    return null;
  }
  const normalizedTag = element.tagName.toLowerCase();
  let best: DomSnapshotNodeEnhancement | null = null;
  let bestScore = 0;
  for (const node of nodes) {
    if (node.tagName.toLowerCase() !== normalizedTag) {
      continue;
    }
    const nodeRect = boundsToRect(node.bounds);
    const overlap = intersectionArea(elementRect, nodeRect);
    const nodeArea = rectArea(nodeRect);
    if (overlap <= 0 || nodeArea <= 0) {
      continue;
    }
    const overlapRatio = overlap / Math.min(elementArea, nodeArea);
    if (overlapRatio < 0.55) {
      continue;
    }
    const score = overlapRatio;
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return best;
};

const boundsOverlapRatio = (
  left: WorkbenchBrowserAgentElementBounds,
  right: WorkbenchBrowserAgentElementBounds
): number => {
  const leftRect = boundsToRect(left);
  const rightRect = boundsToRect(right);
  const leftArea = rectArea(leftRect);
  const rightArea = rectArea(rightRect);
  const overlap = intersectionArea(leftRect, rightRect);
  const minArea = Math.min(leftArea, rightArea);
  return minArea <= 0 ? 0 : overlap / minArea;
};

const boundsOverlapExisting = (
  bounds: WorkbenchBrowserAgentElementBounds,
  existingBounds: readonly WorkbenchBrowserAgentElementBounds[]
): boolean =>
  existingBounds.some((entry) => boundsOverlapRatio(bounds, entry) >= 0.7);

const JS_LISTENER_DISCOVERY_TAGS = new Set([
  "a",
  "div",
  "span",
  "label",
  "li",
  "td",
  "th",
  "article",
  "section"
]);

const parseSnapshotNodes = (snapshot: Record<string, unknown>): DomSnapshotNodeEnhancement[] => {
  const documents = Array.isArray(snapshot.documents) ? snapshot.documents : [];
  const strings = Array.isArray(snapshot.strings)
    ? snapshot.strings.filter((entry): entry is string => typeof entry === "string")
    : [];
  const computedStyleNames = Array.isArray(snapshot.computedStyles)
    ? snapshot.computedStyles.filter((entry): entry is string => typeof entry === "string")
    : [...REQUIRED_DOM_SNAPSHOT_COMPUTED_STYLES];

  const nodes: DomSnapshotNodeEnhancement[] = [];
  for (const document of documents) {
    if (!isRecord(document)) {
      continue;
    }
    const nodeTree = isRecord(document.nodes) ? document.nodes : {};
    const layout = isRecord(document.layout) ? document.layout : {};
    const backendNodeIds = Array.isArray(nodeTree.backendNodeId)
      ? nodeTree.backendNodeId
      : [];
    const nodeNames = Array.isArray(nodeTree.nodeName) ? nodeTree.nodeName : [];
    const attributes = Array.isArray(nodeTree.attributes) ? nodeTree.attributes : [];
    const layoutNodeIndexes = Array.isArray(layout.nodeIndex) ? layout.nodeIndex : [];
    const boundsList = Array.isArray(layout.bounds) ? layout.bounds : [];
    const paintOrders = Array.isArray(layout.paintOrders) ? layout.paintOrders : [];
    const styleLists = Array.isArray(layout.styles) ? layout.styles : [];

    const layoutByNodeIndex = new Map<number, {
      readonly bounds: WorkbenchBrowserAgentElementBounds;
      readonly paintOrder: number | null;
      readonly computedStyles: Record<string, string>;
    }>();

    for (let layoutIndex = 0; layoutIndex < layoutNodeIndexes.length; layoutIndex += 1) {
      const nodeIndex = readFiniteNumber(layoutNodeIndexes[layoutIndex]);
      if (nodeIndex === null) {
        continue;
      }
      const rawBounds = boundsList[layoutIndex];
      if (!Array.isArray(rawBounds) || rawBounds.length < 4) {
        continue;
      }
      const left = readFiniteNumber(rawBounds[0]);
      const top = readFiniteNumber(rawBounds[1]);
      const right = readFiniteNumber(rawBounds[2]);
      const bottom = readFiniteNumber(rawBounds[3]);
      if (left === null || top === null || right === null || bottom === null) {
        continue;
      }
      const bounds = toBounds(left, top, right, bottom);
      if (bounds === null) {
        continue;
      }
      const styleIndices = Array.isArray(styleLists[layoutIndex])
        ? styleLists[layoutIndex].map((entry) => readFiniteNumber(entry) ?? -1)
        : [];
      const computedStyles = buildComputedStyles(styleIndices, computedStyleNames, strings);
      const paintOrder = readFiniteNumber(paintOrders[layoutIndex]);
      layoutByNodeIndex.set(nodeIndex, {
        bounds,
        paintOrder,
        computedStyles
      });
    }

    for (let nodeIndex = 0; nodeIndex < backendNodeIds.length; nodeIndex += 1) {
      const backendNodeId = readFiniteNumber(backendNodeIds[nodeIndex]);
      if (backendNodeId === null) {
        continue;
      }
      const layoutEntry = layoutByNodeIndex.get(nodeIndex);
      if (layoutEntry === undefined) {
        continue;
      }
      const nameIndex = readFiniteNumber(nodeNames[nodeIndex]);
      const rawName = nameIndex !== null && nameIndex >= 0 && nameIndex < strings.length
        ? strings[nameIndex] ?? ""
        : "";
      const tagName = rawName.replace(/^#/, "").toLowerCase() || "element";
      const attributeIndices = Array.isArray(attributes[nodeIndex]) ? attributes[nodeIndex] : [];
      const parsedAttributes: Record<string, string> = {};
      for (let attrIndex = 0; attrIndex < attributeIndices.length - 1; attrIndex += 2) {
        const keyIndex = readFiniteNumber(attributeIndices[attrIndex]);
        const valueIndex = readFiniteNumber(attributeIndices[attrIndex + 1]);
        if (
          keyIndex === null
          || valueIndex === null
          || keyIndex < 0
          || valueIndex < 0
          || keyIndex >= strings.length
          || valueIndex >= strings.length
        ) {
          continue;
        }
        parsedAttributes[strings[keyIndex] ?? ""] = strings[valueIndex] ?? "";
      }
      const computedStyles = {
        ...layoutEntry.computedStyles,
        ...(parsedAttributes.type === undefined ? {} : { type: parsedAttributes.type })
      };
      nodes.push({
        backendNodeId: Math.round(backendNodeId),
        tagName,
        bounds: layoutEntry.bounds,
        paintOrder: layoutEntry.paintOrder,
        computedStyles,
        attributes: parsedAttributes,
        ignoredByPaintOrder: false,
        visibleByComputedStyles: visibleByComputedStyles(computedStyles, tagName),
        hasJsClickListener: false
      });
    }
  }

  const ignored = buildPaintOrderIgnoredBackendIds(nodes);
  return nodes.map((node) => ({
    ...node,
    ignoredByPaintOrder: ignored.has(node.backendNodeId)
  }));
};

const detectJsClickListenerBackendIds = async (
  session: WorkbenchBrowserDebuggerSession
): Promise<ReadonlySet<number>> => {
  const response = await session.sendCommand("Runtime.evaluate", {
    expression: `
      (() => {
        if (typeof getEventListeners !== "function") {
          return null;
        }
        const allElements = document.querySelectorAll("*");
        if (allElements.length > ${MAX_JS_LISTENER_PROBE_ELEMENTS}) {
          return null;
        }
        const elementsWithListeners = [];
        for (const element of allElements) {
          try {
            const listeners = getEventListeners(element);
            if (
              listeners.click
              || listeners.mousedown
              || listeners.mouseup
              || listeners.pointerdown
              || listeners.pointerup
            ) {
              elementsWithListeners.push(element);
            }
          } catch (_error) {
            // Ignore per-element listener inspection failures.
          }
        }
        return elementsWithListeners;
      })()
    `,
    includeCommandLineAPI: true,
    returnByValue: false
  });

  const resultObjectId = isRecord(response)
    && isRecord(response.result)
    && typeof response.result.objectId === "string"
    ? response.result.objectId
    : null;
  if (resultObjectId === null) {
    return new Set();
  }

  const properties = await session.sendCommand("Runtime.getProperties", {
    objectId: resultObjectId,
    ownProperties: true
  });
  const objectIds: string[] = [];
  const entries = Array.isArray(properties.result) ? properties.result : [];
  for (const entry of entries) {
    if (!isRecord(entry) || !/^\d+$/u.test(String(entry.name ?? ""))) {
      continue;
    }
    const value = isRecord(entry.value) ? entry.value : null;
    if (value !== null && typeof value.objectId === "string") {
      objectIds.push(value.objectId);
    }
  }

  await session.sendCommand("Runtime.releaseObject", { objectId: resultObjectId }).catch(() => undefined);

  const backendIds = new Set<number>();
  for (const objectId of objectIds.slice(0, MAX_JS_LISTENER_DISCOVERY * 4)) {
    try {
      const described = await session.sendCommand("DOM.describeNode", { objectId });
      const backendNodeId = isRecord(described)
        && isRecord(described.node)
        ? readFiniteNumber(described.node.backendNodeId)
        : null;
      if (backendNodeId !== null) {
        backendIds.add(Math.round(backendNodeId));
      }
    } catch {
      // Ignore nodes that cannot be described.
    }
  }
  return backendIds;
};

export const captureDomObservationEnhancements = async (
  session: WorkbenchBrowserDebuggerSession
): Promise<DomObservationEnhancements | null> => {
  const startedAt = Date.now();
  try {
    await session.sendCommand("DOM.enable").catch(() => ({}));
    await session.sendCommand("DOMSnapshot.enable").catch(() => ({}));
    const [snapshotResponse, jsClickListenerBackendIds] = await Promise.all([
      session.sendCommand("DOMSnapshot.captureSnapshot", {
        computedStyles: [...REQUIRED_DOM_SNAPSHOT_COMPUTED_STYLES],
        includePaintOrder: true,
        includeDOMRects: true,
        includeBlendedBackgroundColors: false,
        includeTextColorOpacities: false
      }),
      detectJsClickListenerBackendIds(session).catch(() => new Set<number>())
    ]);

    const snapshotNodes = parseSnapshotNodes(
      isRecord(snapshotResponse) ? snapshotResponse : {}
    ).map((node) => ({
      ...node,
      hasJsClickListener: jsClickListenerBackendIds.has(node.backendNodeId)
    }));

    return {
      snapshotNodes,
      jsClickListenerBackendIds,
      timingMs: Date.now() - startedAt
    };
  } catch {
    return null;
  }
};

const isPropagatingElement = (element: WorkbenchBrowserAgentElement): boolean => {
  const tag = element.tagName.toLowerCase();
  const role = element.role.toLowerCase();
  if (tag === "a" || tag === "button") {
    return true;
  }
  if ((tag === "div" || tag === "span" || tag === "input") && (role === "button" || role === "combobox")) {
    return true;
  }
  return false;
};

const shouldExcludeContainedChild = (
  child: WorkbenchBrowserAgentElement,
  parent: WorkbenchBrowserAgentElement
): boolean => {
  const childRect = boundsToRect(child.bounds);
  const parentRect = boundsToRect(parent.bounds);
  const overlap = intersectionArea(childRect, parentRect);
  const childArea = rectArea(childRect);
  if (childArea <= 0 || overlap / childArea < DEFAULT_CONTAINMENT_THRESHOLD) {
    return false;
  }

  const childTag = child.tagName.toLowerCase();
  if (childTag === "input" || childTag === "select" || childTag === "textarea" || childTag === "label") {
    return false;
  }
  if (isPropagatingElement(child)) {
    return false;
  }
  if (child.selectorPreview.includes("[onclick=") || child.selectorPreview.includes("onclick")) {
    return false;
  }
  if ((child.label?.trim().length ?? 0) > 0 && child.label !== "(no label)") {
    const role = child.role.toLowerCase();
    if (role === "button" || role === "link" || role === "checkbox" || role === "radio" || role === "tab") {
      return false;
    }
  }
  return true;
};

export const filterElementsByParentContainment = (
  elements: readonly WorkbenchBrowserAgentElement[]
): WorkbenchBrowserAgentElement[] => {
  const excludedIds = new Set<number>();
  const propagatingParents = elements.filter(isPropagatingElement);
  for (const child of elements) {
    if (excludedIds.has(child.id)) {
      continue;
    }
    for (const parent of propagatingParents) {
      if (parent.id === child.id) {
        continue;
      }
      if (shouldExcludeContainedChild(child, parent)) {
        excludedIds.add(child.id);
        break;
      }
    }
  }
  if (excludedIds.size === 0) {
    return [...elements];
  }
  return elements.filter((element) => !excludedIds.has(element.id));
};

export type ApplyCdpEnhancementsResult = {
  readonly elements: readonly WorkbenchBrowserAgentElement[];
  readonly warnings: readonly string[];
};

export const applyCdpEnhancementsToElements = (
  elements: readonly WorkbenchBrowserAgentElement[],
  enhancements: DomObservationEnhancements
): ApplyCdpEnhancementsResult => {
  const warnings: string[] = [];
  let paintOrderFiltered = 0;
  let computedStyleFiltered = 0;

  const enhanced = elements.flatMap((element) => {
    if (element.discoveryScope === "visual" || element.discoveryScope === "ax") {
      return [element];
    }
    const matched = matchSnapshotNodeForElement(element, enhancements.snapshotNodes);
    if (matched === null) {
      return [element];
    }

    const visibility = {
      visible: element.visibility?.visible ?? true,
      offscreen: element.visibility?.offscreen ?? false,
      ariaHidden: element.visibility?.ariaHidden ?? false,
      covered: element.visibility?.covered ?? false
    };

    if (!matched.visibleByComputedStyles) {
      computedStyleFiltered += 1;
      return [];
    }
    if (matched.ignoredByPaintOrder) {
      paintOrderFiltered += 1;
      return [{
        ...element,
        visibility: {
          ...visibility,
          covered: true
        }
      }];
    }

    const pointerEvents = (matched.computedStyles["pointer-events"] ?? "").toLowerCase();
    if (pointerEvents === "none") {
      computedStyleFiltered += 1;
      return [];
    }

    return [element];
  });

  if (paintOrderFiltered > 0) {
    warnings.push(`${paintOrderFiltered} paint-order occluded element(s) marked covered.`);
  }
  if (computedStyleFiltered > 0) {
    warnings.push(`${computedStyleFiltered} computed-style hidden element(s) omitted from map output.`);
  }

  return {
    elements: enhanced,
    warnings
  };
};

export type JsListenerDiscoveryRequest = {
  readonly enhancements: DomObservationEnhancements;
  readonly existingElements: readonly WorkbenchBrowserAgentElement[];
  readonly frameTreeNodeId: number;
  readonly frameRef: string;
  readonly frameBounds: WorkbenchBrowserAgentElementBounds;
  readonly frameUrl: string;
  readonly startingElementId: number;
};

export type JsListenerDiscoveryItem = {
  readonly id: number;
  readonly frameTreeNodeId: number;
  readonly frameRef: string;
  readonly tagName: string;
  readonly role: string;
  readonly label: string;
  readonly selectorPreview: string;
  readonly bounds: WorkbenchBrowserAgentElementBounds;
  readonly localBounds: WorkbenchBrowserAgentElementBounds;
  readonly frameBounds: WorkbenchBrowserAgentElementBounds;
  readonly discoveryScope: "document";
  readonly actionHint: string;
  readonly focusable: boolean;
  readonly disabled: boolean;
  readonly editable: boolean;
  readonly visibility: {
    readonly visible: boolean;
    readonly offscreen: boolean;
    readonly covered: boolean;
    readonly ariaHidden: boolean;
  };
  readonly frameUrl: string;
};

export const discoverJsListenerObservationItems = (
  request: JsListenerDiscoveryRequest
): readonly JsListenerDiscoveryItem[] => {
  const items: JsListenerDiscoveryItem[] = [];
  let nextId = request.startingElementId;
  const existingBounds = request.existingElements.map((element) => element.bounds);
  for (const node of request.enhancements.snapshotNodes) {
    if (!node.hasJsClickListener || !node.visibleByComputedStyles || node.ignoredByPaintOrder) {
      continue;
    }
    if (!JS_LISTENER_DISCOVERY_TAGS.has(node.tagName.toLowerCase())) {
      continue;
    }
    if (boundsOverlapExisting(node.bounds, existingBounds)) {
      continue;
    }
    if (items.some((item) => boundsOverlapRatio(node.bounds, item.bounds) >= 0.7)) {
      continue;
    }

    const label = node.attributes["aria-label"]
      ?? node.attributes.title
      ?? node.attributes.placeholder
      ?? node.tagName;
    const localBounds = {
      x: Math.round(node.bounds.x - request.frameBounds.x),
      y: Math.round(node.bounds.y - request.frameBounds.y),
      width: node.bounds.width,
      height: node.bounds.height
    };
    items.push({
      id: nextId,
      frameTreeNodeId: request.frameTreeNodeId,
      frameRef: request.frameRef,
      tagName: node.tagName,
      role: (node.attributes.role ?? node.tagName).toLowerCase(),
      label: typeof label === "string" && label.trim().length > 0 ? label.trim() : "(no label)",
      selectorPreview: `${node.tagName}[js-listener]`,
      bounds: node.bounds,
      localBounds,
      frameBounds: request.frameBounds,
      discoveryScope: "document",
      actionHint: "click",
      focusable: true,
      disabled: false,
      editable: false,
      visibility: {
        visible: true,
        offscreen: false,
        covered: false,
        ariaHidden: false
      },
      frameUrl: request.frameUrl
    });
    nextId += 1;
    if (items.length >= MAX_JS_LISTENER_DISCOVERY) {
      break;
    }
  }
  return items;
};