import { createHash } from "node:crypto";

import type {
  WorkbenchWebElementBounds,
  WorkbenchWebFocusAtlas,
  WorkbenchWebFocusNode,
  WorkbenchWebFocusRegion,
  WorkbenchWebFocusRegionKind,
  WorkbenchWebPageMode,
  WorkbenchWebWidgetDescriptor,
  WorkbenchWebWidgetKind,
} from "../../../shared/workbench-web-automation";
import type { LayoutInteractiveRecord } from "../layout-intelligence/types";
import type { FocusAtlasBuildInput, FocusAtlasBuildResult } from "./types";

const normalizeText = (value: string | undefined): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

const boundsOverlap = (
  left: WorkbenchWebElementBounds,
  right: WorkbenchWebElementBounds
): boolean =>
  left.x < right.x + right.width
  && left.x + left.width > right.x
  && left.y < right.y + right.height
  && left.y + left.height > right.y;

const regionKindFromWidget = (
  kind: WorkbenchWebWidgetKind,
  pageMode: WorkbenchWebPageMode
): WorkbenchWebFocusRegionKind => {
  switch (kind) {
    case "sidebar":
    case "navigation":
    case "mode-switcher":
      return "navigation";
    case "history-list":
    case "history-item":
    case "list":
    case "list-item":
      return pageMode === "chat" ? "history" : "workflow";
    case "chat-composer":
    case "composer":
    case "search-bar":
    case "login-form":
    case "form":
      return "composer";
    case "toolbar":
    case "toggle-group":
    case "pagination":
      return "toolbar";
    case "menu":
    case "menu-trigger":
    case "menu-panel":
    case "dialog":
      return "menu";
    case "panel":
    case "card":
      return "panel";
    default:
      return "unknown";
  }
};

const describeRegion = (
  widget: WorkbenchWebWidgetDescriptor,
  pageMode: WorkbenchWebPageMode
): string => {
  const label = normalizeText(widget.label);
  if (label.length > 0) {
    return label;
  }
  const kind = regionKindFromWidget(widget.kind, pageMode);
  switch (kind) {
    case "navigation":
      return "navigation controls";
    case "history":
      return "history list";
    case "composer":
      return "primary input region";
    case "toolbar":
      return "toolbar controls";
    case "menu":
      return "local menu";
    case "panel":
      return "workflow panel";
    default:
      return `${widget.kind} region`;
  }
};

const labelForCandidate = (candidate: LayoutInteractiveRecord): string => {
  const label =
    normalizeText(candidate.itemIdentity?.label)
    || normalizeText(candidate.ariaLabel)
    || normalizeText(candidate.placeholder)
    || normalizeText(candidate.textSnippet)
    || normalizeText(candidate.affordanceLabel)
    || normalizeText(candidate.containerHint?.label)
    || normalizeText(candidate.selectorPreview);
  return label.length > 0 ? label : `<${candidate.tagName.toLowerCase()}>`;
};

const actionLabelForCandidate = (candidate: LayoutInteractiveRecord): string | undefined => {
  const affordance = normalizeText(candidate.affordanceAction);
  if (affordance.length > 0) {
    return affordance;
  }
  if (candidate.interactable.typable) {
    return "type";
  }
  if (candidate.interactable.selectable) {
    return "select";
  }
  if (candidate.interactable.clickable) {
    return candidate.widgetKind === "menu-trigger" ? "open menu" : "click";
  }
  if (candidate.interactable.focusable) {
    return "focus";
  }
  return undefined;
};

const candidateConfidence = (candidate: LayoutInteractiveRecord): number => {
  let confidence = 0.62;
  if (candidate.visibilityState === "visible") {
    confidence += 0.16;
  }
  if (candidate.interactable.focusable) {
    confidence += 0.08;
  }
  if (candidate.interactable.clickable) {
    confidence += 0.05;
  }
  if (candidate.isHumanOperable !== false) {
    confidence += 0.05;
  }
  if (candidate.widgetId !== undefined || candidate.ownerWidgetId !== undefined) {
    confidence += 0.04;
  }
  if (normalizeText(candidate.stateHint).length > 0) {
    confidence += 0.02;
  }
  return Math.min(0.98, Number(confidence.toFixed(2)));
};

const collapsedNavigation = (
  widget: WorkbenchWebWidgetDescriptor,
  pageMode: WorkbenchWebPageMode
): boolean => {
  const leftRail =
    widget.bounds.x <= 32
    && widget.bounds.width <= 120
    && widget.bounds.height >= 200;
  const collapsibleKind = widget.kind === "sidebar"
    || widget.kind === "navigation"
    || widget.kind === "toggle-group"
    || widget.kind === "panel";
  if (!collapsibleKind) {
    return false;
  }
  if (widget.stateHint === "collapsed") {
    return true;
  }
  return leftRail && (pageMode === "chat" || pageMode === "navigation" || pageMode === "search");
};

const sortCandidatesByFocusOrder = (
  candidates: readonly LayoutInteractiveRecord[]
): readonly LayoutInteractiveRecord[] => {
  const focusRank = (candidate: LayoutInteractiveRecord): number => {
    if (candidate.interactable.typable || candidate.interactable.selectable || candidate.interactable.focusable) {
      return 0;
    }
    if (candidate.interactable.clickable) {
      return 1;
    }
    return 2;
  };
  const positiveTabIndex = (candidate: LayoutInteractiveRecord): number =>
    typeof candidate.tabIndex === "number" && candidate.tabIndex > 0 ? candidate.tabIndex : Number.MAX_SAFE_INTEGER;
  const documentOrder = (candidate: LayoutInteractiveRecord): number =>
    typeof candidate.documentOrder === "number" ? candidate.documentOrder : Number.MAX_SAFE_INTEGER;

  return [...candidates].sort((left, right) =>
    focusRank(left) - focusRank(right)
    || positiveTabIndex(left) - positiveTabIndex(right)
    || documentOrder(left) - documentOrder(right)
    || left.bounds.y - right.bounds.y
    || left.bounds.x - right.bounds.x
  );
};

const buildFallbackRegion = (candidate: LayoutInteractiveRecord): WorkbenchWebFocusRegion => ({
  regionId: `region:${candidate.candidateId}`,
  kind: candidate.widgetKind === "menu-trigger" ? "menu" : "workflow",
  label: labelForCandidate(candidate),
  bounds: candidate.bounds,
  nodeIds: [`focus:${candidate.candidateId}`],
  widgetIds: candidate.widgetId === undefined ? [] : [candidate.widgetId],
  collapsed: false,
  confidence: candidateConfidence(candidate),
});

const resolvePrimaryControlId = ({
  region,
  nodes,
}: {
  readonly region: WorkbenchWebFocusRegion;
  readonly nodes: readonly WorkbenchWebFocusNode[];
}): string | undefined => {
  const inRegion = nodes.filter((node) => node.focusRegionId === region.regionId);
  if (inRegion.length === 0) {
    return undefined;
  }
  const explicitExpand = inRegion.find((node) => normalizeText(node.actionLabel) === "expand");
  if (explicitExpand !== undefined) {
    return explicitExpand.focusNodeId;
  }
  if (region.collapsed) {
    const collapsedAffordance = inRegion.find((node) =>
      normalizeText(node.label).includes("sidebar")
      || normalizeText(node.label).includes("history")
      || normalizeText(node.actionLabel) === "click"
    );
    if (collapsedAffordance !== undefined) {
      return collapsedAffordance.focusNodeId;
    }
  }
  return [...inRegion]
    .sort((left, right) => left.focusOrder - right.focusOrder || left.bounds.x - right.bounds.x)[0]?.focusNodeId;
};

const buildAtlasVersion = ({
  pageMode,
  regions,
  nodes,
}: {
  readonly pageMode: WorkbenchWebPageMode;
  readonly regions: readonly WorkbenchWebFocusRegion[];
  readonly nodes: readonly WorkbenchWebFocusNode[];
}): string => {
  const hash = createHash("sha1");
  hash.update(pageMode);
  for (const region of regions) {
    hash.update(region.regionId);
    hash.update(region.kind);
    hash.update(region.label);
    hash.update(JSON.stringify(region.bounds));
  }
  for (const node of nodes) {
    hash.update(node.focusNodeId);
    hash.update(node.label);
    hash.update(JSON.stringify(node.bounds));
    hash.update(String(node.focusOrder));
  }
  return hash.digest("hex").slice(0, 12);
};

export const buildFocusAtlas = ({
  tabId,
  snapshot,
  session,
  discoveryMode = "computed",
}: FocusAtlasBuildInput): FocusAtlasBuildResult => {
  const startedAt = Date.now();
  const candidates = snapshot.candidates.filter((candidate) => candidate.isHumanOperable !== false);
  const regionByWidgetId = new Map<string, WorkbenchWebFocusRegion>();
  const regionNodeIds = new Map<string, string[]>();
  const regions: WorkbenchWebFocusRegion[] = snapshot.widgets.map((widget) => {
    const region: WorkbenchWebFocusRegion = {
      regionId: `region:${widget.widgetId}`,
      kind: regionKindFromWidget(widget.kind, snapshot.pageMode),
      label: describeRegion(widget, snapshot.pageMode),
      bounds: widget.bounds,
      nodeIds: [],
      widgetIds: [widget.widgetId],
      ...(collapsedNavigation(widget, snapshot.pageMode) ? { collapsed: true } : {}),
      confidence: 0.86,
    };
    regionByWidgetId.set(widget.widgetId, region);
    regionNodeIds.set(region.regionId, []);
    return region;
  });

  const fallbackRegions = new Map<string, WorkbenchWebFocusRegion>();
  const orderedCandidates = sortCandidatesByFocusOrder(candidates);
  const nodes: WorkbenchWebFocusNode[] = orderedCandidates.map((candidate, index) => {
    const region = (() => {
      const widgetRegion = candidate.widgetId === undefined ? undefined : regionByWidgetId.get(candidate.widgetId);
      if (widgetRegion !== undefined) {
        return widgetRegion;
      }
      const ownerRegion = candidate.ownerWidgetId === undefined ? undefined : regionByWidgetId.get(candidate.ownerWidgetId);
      if (ownerRegion !== undefined) {
        return ownerRegion;
      }
      const key = `${candidate.frameTreeNodeId}:${candidate.selectorAddress.path}`;
      const existing = fallbackRegions.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const created = buildFallbackRegion(candidate);
      fallbackRegions.set(key, created);
      regionNodeIds.set(created.regionId, [...created.nodeIds]);
      return created;
    })();

    const node: WorkbenchWebFocusNode = {
      focusNodeId: `focus:${candidate.candidateId}`,
      candidateId: candidate.candidateId,
      ...(candidate.widgetId === undefined ? {} : { widgetId: candidate.widgetId }),
      ...(candidate.ownerWidgetId === undefined ? {} : { ownerWidgetId: candidate.ownerWidgetId }),
      ...(candidate.widgetKind === undefined ? {} : { widgetKind: candidate.widgetKind }),
      ...(candidate.itemIdentity === undefined ? {} : { itemIdentity: candidate.itemIdentity }),
      label: labelForCandidate(candidate),
      ...(actionLabelForCandidate(candidate) === undefined ? {} : { actionLabel: actionLabelForCandidate(candidate) }),
      selectorPreview: candidate.selectorPreview,
      bounds: candidate.bounds,
      focusOrder: index,
      focusRegionId: region.regionId,
      discoveryMode,
      confidence: candidateConfidence(candidate),
      focusable: candidate.interactable.typable || candidate.interactable.selectable || candidate.interactable.focusable,
      clickable: candidate.interactable.clickable,
      humanOperable: candidate.isHumanOperable !== false,
      ...(!(candidate.interactable.typable || candidate.interactable.selectable || candidate.interactable.focusable)
        && candidate.interactable.clickable
        ? { pointerOnly: true }
        : {}),
    };
    const existingNodeIds = regionNodeIds.get(region.regionId) ?? [];
    if (existingNodeIds.includes(node.focusNodeId) === false) {
      regionNodeIds.set(region.regionId, [...existingNodeIds, node.focusNodeId]);
    }
    return node;
  });

  for (const region of fallbackRegions.values()) {
    regions.push(region);
  }

  const enrichedRegions = regions.map((region) => {
    const nodeIds = regionNodeIds.get(region.regionId) ?? [];
    const nextRegion: WorkbenchWebFocusRegion = {
      ...region,
      nodeIds,
    };
    const primaryControlId = resolvePrimaryControlId({ region: nextRegion, nodes });
    return {
      ...nextRegion,
      ...(primaryControlId === undefined ? {} : { primaryControlId })
    };
  });

  const activeFocusRegionId = (() => {
    if (session?.activeWidgetId !== undefined) {
      const activeWidgetRegion = regionByWidgetId.get(session.activeWidgetId);
      if (activeWidgetRegion !== undefined) {
        return activeWidgetRegion.regionId;
      }
    }
    if (session?.workflowRegion !== undefined) {
      const local = enrichedRegions.find((region) => boundsOverlap(region.bounds, session.workflowRegion!));
      if (local !== undefined) {
        return local.regionId;
      }
    }
    const collapsedNav = enrichedRegions.find((region) => region.collapsed === true);
    return collapsedNav?.regionId;
  })();

  const atlas: WorkbenchWebFocusAtlas = {
    tabId,
    pageMode: snapshot.pageMode,
    version: "pending",
    builtAt: Date.now(),
    ...(activeFocusRegionId === undefined ? {} : { activeFocusRegionId }),
    nodes,
    regions: enrichedRegions,
    skeleton: enrichedRegions.slice(0, 8).map((region) => {
      const control = region.primaryControlId === undefined
        ? undefined
        : nodes.find((node) => node.focusNodeId === region.primaryControlId);
      return control === undefined ? region.label : `${region.label}: ${control.label}`;
    })
  };

  const version = buildAtlasVersion({
    pageMode: atlas.pageMode,
    regions: atlas.regions,
    nodes: atlas.nodes,
  });

  return {
    atlas: {
      ...atlas,
      version,
    },
    diagnostics: {
      durationMs: Date.now() - startedAt,
      candidateCount: candidates.length,
      widgetCount: snapshot.widgets.length,
    }
  };
};
