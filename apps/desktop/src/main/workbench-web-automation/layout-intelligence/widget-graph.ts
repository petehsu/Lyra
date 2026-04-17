import { randomUUID } from "node:crypto";

import type {
  WorkbenchWebContainerNode,
  WorkbenchWebItemIdentity,
  WorkbenchWebLayoutNode,
  WorkbenchWebPageMode,
  WorkbenchWebTargetCandidate,
  WorkbenchWebWidgetDescriptor,
  WorkbenchWebWidgetKind,
} from "../../../shared/workbench-web-automation";
import type {
  LayoutIntelligenceSnapshot,
  LayoutInteractiveRecord,
  WidgetGraphInput,
} from "./types";

const normalizeText = (value: string | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const textOrUndefined = (value: string | undefined): string | undefined => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : undefined;
};

const pickLabel = (candidate: LayoutInteractiveRecord): string | undefined =>
  textOrUndefined(candidate.ariaLabel)
  ?? textOrUndefined(candidate.placeholder)
  ?? textOrUndefined(candidate.textSnippet)
  ?? textOrUndefined(candidate.containerHint?.label);

const rectRight = (bounds: WorkbenchWebTargetCandidate["bounds"]): number =>
  bounds.x + bounds.width;

const rectBottom = (bounds: WorkbenchWebTargetCandidate["bounds"]): number =>
  bounds.y + bounds.height;

const centerY = (bounds: WorkbenchWebTargetCandidate["bounds"]): number =>
  bounds.y + bounds.height / 2;

const buildBoundsForMembers = (
  members: readonly LayoutInteractiveRecord[]
): WorkbenchWebTargetCandidate["bounds"] => ({
  x: Math.min(...members.map((member) => member.bounds.x)),
  y: Math.min(...members.map((member) => member.bounds.y)),
  width: Math.max(...members.map((member) => rectRight(member.bounds)))
    - Math.min(...members.map((member) => member.bounds.x)),
  height: Math.max(...members.map((member) => rectBottom(member.bounds)))
    - Math.min(...members.map((member) => member.bounds.y))
});

const isSmallControl = (candidate: LayoutInteractiveRecord): boolean =>
  candidate.bounds.width <= 64 && candidate.bounds.height <= 56;

const sameRow = (left: LayoutInteractiveRecord, right: LayoutInteractiveRecord): boolean => {
  const delta = Math.abs(centerY(left.bounds) - centerY(right.bounds));
  const tolerance = Math.max(18, Math.min(left.bounds.height, right.bounds.height) + 12);
  return delta <= tolerance;
};

const clusterMembersByRow = (
  members: readonly LayoutInteractiveRecord[]
): readonly LayoutInteractiveRecord[][] => {
  const sorted = [...members].sort((left, right) =>
    centerY(left.bounds) - centerY(right.bounds) || left.bounds.x - right.bounds.x
  );
  const rows: LayoutInteractiveRecord[][] = [];
  for (const member of sorted) {
    const current = rows.at(-1);
    if (current === undefined || !sameRow(current[0]!, member)) {
      rows.push([member]);
      continue;
    }
    current.push(member);
  }
  return rows;
};

const isRowLikeList = (rows: readonly LayoutInteractiveRecord[][]): boolean => {
  if (rows.length < 2) {
    return false;
  }
  const rowWidths = rows.map((row) => buildBoundsForMembers(row).width);
  const meanWidth = rowWidths.reduce((sum, value) => sum + value, 0) / rowWidths.length;
  const rowWithLabelCount = rows.filter((row) =>
    row.some((member) => (pickLabel(member) ?? "").length > 0)
  ).length;
  return meanWidth >= 140 && rowWithLabelCount >= 2;
};

const inferItemIdentity = (
  members: readonly LayoutInteractiveRecord[]
): WorkbenchWebItemIdentity | undefined => {
  const richLabels = members
    .filter((member) => !(member.interactable.clickable && isSmallControl(member)))
    .map((member) => pickLabel(member))
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .sort((left, right) => right.length - left.length);
  const fallbackLabels = members
    .map((member) => pickLabel(member))
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .sort((left, right) => right.length - left.length);
  const label = richLabels[0] ?? fallbackLabels[0];
  if (label === undefined) {
    return undefined;
  }
  return {
    label,
    title: label
  };
};

const isTrailingAction = (
  member: LayoutInteractiveRecord,
  rowBounds: WorkbenchWebTargetCandidate["bounds"]
): boolean =>
  member.interactable.clickable
  && isSmallControl(member)
  && member.bounds.x >= rowBounds.x + rowBounds.width * 0.62;

const looksLikeCollapsedSidebar = (
  members: readonly LayoutInteractiveRecord[]
): boolean => {
  if (members.length < 2) {
    return false;
  }

  const bounds = members[0]?.containerHint?.bounds ?? buildBoundsForMembers(members);
  const clickableMembers = members.filter((member) => member.interactable.clickable);
  if (clickableMembers.length < 2) {
    return false;
  }

  const leftRail = bounds.x <= 32 && bounds.width <= 72 && bounds.height >= 220;
  if (!leftRail) {
    return false;
  }

  const labels = clickableMembers.flatMap((member) => [
    normalizeText(member.ariaLabel),
    normalizeText(member.textSnippet),
    normalizeText(member.affordanceLabel),
    normalizeText(member.containerHint?.label),
  ]);
  const actions = clickableMembers.map((member) => normalizeText(member.affordanceAction));
  const stateHints = clickableMembers.map((member) => normalizeText(member.stateHint));

  const hasCollapsedState = stateHints.includes("collapsed");
  const hasExpandAction = actions.includes("expand");
  const hasSidebarAffordance = labels.some((label) =>
    label.includes("sidebar")
    || label.includes("history")
    || label.includes("recent")
    || label.includes("search")
    || label.includes("library")
    || label.includes("new chat")
  );

  return hasCollapsedState || hasExpandAction || hasSidebarAffordance;
};

const pickPrimaryField = (
  members: readonly LayoutInteractiveRecord[]
): LayoutInteractiveRecord | undefined =>
  [...members]
    .filter((member) => member.interactable.typable && member.disabled !== true)
    .sort((left, right) => {
      const score = (candidate: LayoutInteractiveRecord) =>
        (normalizeText(candidate.tagName) === "textarea" ? 14 : 0)
        + (normalizeText(candidate.tagName) === "input" ? 10 : 0)
        + ((candidate.bounds.width ?? 0) >= 220 ? 8 : 0)
        + (candidate.visibilityState === "visible" ? 6 : 0);
      return score(right) - score(left);
    })[0];

const pickPrimaryAction = (
  members: readonly LayoutInteractiveRecord[],
  primaryField: LayoutInteractiveRecord | undefined
): LayoutInteractiveRecord | undefined =>
  [...members]
    .filter((member) => member.interactable.clickable && member.disabled !== true)
    .sort((left, right) => {
      const score = (candidate: LayoutInteractiveRecord) => {
        let total = 0;
        if (normalizeText(candidate.tagName) === "button") total += 10;
        if (normalizeText(candidate.role) === "button") total += 8;
        if (candidate.visibilityState === "visible") total += 6;
        if (primaryField !== undefined) {
          const horizontalDistance =
            candidate.bounds.x - (primaryField.bounds.x + primaryField.bounds.width);
          const verticalDistance = Math.abs(
            candidate.bounds.y + candidate.bounds.height / 2
            - (primaryField.bounds.y + primaryField.bounds.height / 2)
          );
          if (horizontalDistance >= -20 && horizontalDistance <= 280) total += 8;
          if (verticalDistance <= 48) total += 6;
        }
        if (isSmallControl(candidate)) {
          total += 2;
        }
        return total;
      };
      return score(right) - score(left);
    })[0];

const inferContainerWidgetKind = (
  members: readonly LayoutInteractiveRecord[]
): WorkbenchWebWidgetKind => {
  const tags = members.map((member) => normalizeText(member.tagName));
  const roles = members.map((member) => normalizeText(member.role));
  const labels = members.map((member) => normalizeText(pickLabel(member)));
  const containerHints = members.map((member) => normalizeText(member.containerHint?.label));
  const hasPassword = members.some(
    (member) => normalizeText(member.inputType) === "password"
      || labels.some((label) => label.includes("password"))
  );
  const typableCount = members.filter((member) => member.interactable.typable).length;
  const clickableCount = members.filter((member) => member.interactable.clickable).length;
  const hasSearch = roles.includes("searchbox")
    || tags.includes("input") && members.some((member) => normalizeText(member.inputType) === "search")
    || labels.some((label) => label.includes("search"))
    || containerHints.includes("search");
  const hasToolbar = roles.includes("toolbar") || containerHints.includes("toolbar");
  const hasNavigation = roles.includes("navigation") || containerHints.includes("navigation");
  const hasSidebarHint = containerHints.includes("navigation")
    && (labels.some((label) => label.includes("history") || label.includes("recent"))
      || containerHints.some((hint) => hint.includes("history") || hint.includes("recent") || hint.includes("sidebar")));
  const hasDialog = roles.includes("dialog") || containerHints.includes("dialog");
  const hasProtected = members.some((member) => member.containerHint?.protected === true)
    || containerHints.includes("protected")
    || labels.some((label) => label.includes("captcha") || label.includes("verification") || label.includes("challenge"));
  const hasToggleSemantics = roles.includes("tab")
    || roles.includes("switch")
    || roles.includes("radio")
    || roles.includes("checkbox");

  if (hasProtected) {
    return "protected";
  }
  if (hasPassword) {
    return "login-form";
  }
  if (hasSearch && typableCount >= 1) {
    return "search-bar";
  }
  if (hasDialog) {
    return "dialog";
  }
  if (typableCount >= 1 && clickableCount >= 1) {
    const field = pickPrimaryField(members);
    const hintText = normalizeText(field?.ariaLabel)
      || normalizeText(field?.placeholder)
      || normalizeText(field?.textSnippet)
      || normalizeText(members[0]?.containerHint?.label);
    if (
      field !== undefined
      && field.bounds.width >= 220
      && (field.bounds.y >= 220 || hintText.includes("chat") || hintText.includes("prompt"))
    ) {
      return hintText.includes("chat") || hintText.includes("prompt")
        ? "chat-composer"
        : "composer";
    }
    return "form";
  }
  if (hasToolbar && clickableCount >= 2) {
    return "toolbar";
  }
  if (looksLikeCollapsedSidebar(members)) {
    return "sidebar";
  }
  if (hasSidebarHint && clickableCount >= 2) {
    return "sidebar";
  }
  if (hasNavigation && clickableCount >= 2) {
    return "navigation";
  }
  if (hasToggleSemantics && clickableCount >= 2) {
    return roles.includes("tab") ? "mode-switcher" : "toggle-group";
  }
  if (clickableCount >= 2 && clickableCount <= 6 && typableCount === 0) {
    const heights = members.map((member) => member.bounds.height);
    const compactControls = heights.every((height) => height <= 48);
    if (compactControls) {
      return "toggle-group";
    }
  }
  if (clickableCount >= 4 && members.every((member) => member.bounds.height <= 56)) {
    return "pagination";
  }
  if (typableCount >= 1 && clickableCount === 0) {
    const field = pickPrimaryField(members);
    const hintText = normalizeText(field?.ariaLabel)
      || normalizeText(field?.placeholder)
      || normalizeText(field?.textSnippet)
      || normalizeText(members[0]?.containerHint?.label);
    if (
      field !== undefined
      && field.bounds.width >= 220
      && (field.bounds.y >= 220 || hintText.includes("chat") || hintText.includes("prompt"))
    ) {
      return hintText.includes("chat") || hintText.includes("prompt")
        ? "chat-composer"
        : "composer";
    }
  }
  if (clickableCount >= 2 && typableCount === 0) {
    return roles.includes("menu") ? "menu-panel" : "menu";
  }
  return "panel";
};

const inferPageMode = (widgets: readonly WorkbenchWebWidgetDescriptor[]): WorkbenchWebPageMode => {
  const kinds = widgets.map((widget) => widget.kind);
  const labels = widgets.map((widget) => normalizeText(widget.label));
  if (kinds.includes("login-form")) {
    return "login";
  }
  if (
    (kinds.includes("chat-composer") || kinds.includes("composer"))
    && (
      kinds.includes("list")
      || kinds.includes("list-item")
      || kinds.includes("history-list")
      || kinds.includes("history-item")
      || kinds.includes("menu-trigger")
      || kinds.includes("sidebar")
    )
  ) {
    return "chat";
  }
  if (kinds.includes("chat-composer")) {
    return "chat";
  }
  if (
    kinds.includes("sidebar")
    && labels.some((label) => label.includes("chat") || label.includes("history") || label.includes("recent"))
  ) {
    return "chat";
  }
  if (
    kinds.includes("sidebar")
    && widgets.some((widget) => widget.kind === "panel" && normalizeText(widget.label).includes("chat"))
  ) {
    return "chat";
  }
  if (kinds.includes("search-bar")) {
    return "search";
  }
  if (kinds.includes("form")) {
    return "form";
  }
  if (kinds.includes("mode-switcher") || kinds.includes("toggle-group")) {
    return kinds.includes("composer") || kinds.includes("chat-composer") ? "chat" : "navigation";
  }
  if (kinds.includes("navigation") || kinds.includes("pagination")) {
    return "navigation";
  }
  if (kinds.includes("dialog")) {
    return "settings";
  }
  if (kinds.includes("panel") || kinds.includes("card") || kinds.includes("list")) {
    return "feed";
  }
  return "unknown";
};

const isHistoryLikeLabel = (value: string | undefined): boolean => {
  const label = normalizeText(value);
  return label.includes("history") || label.includes("recent") || label.includes("conversation") || label.includes("chat");
};

const describeWidgetKind = (
  kind: WorkbenchWebWidgetKind,
  label?: string
): string | undefined => {
  switch (kind) {
    case "sidebar":
      return "contains page-level navigation and history items";
    case "history-list":
      return "contains visible conversation history items";
    case "history-item":
      return "opens or manages a specific conversation row";
    case "menu-trigger":
      return "opens local actions for this item";
    case "menu-panel":
      return "contains the currently revealed local actions";
    case "chat-composer":
    case "composer":
      return "accepts message input and submit actions";
    case "mode-switcher":
      return "switches the current model or mode";
    case "toggle-group":
      return "switches a local mode or option";
    default:
      return label === undefined ? undefined : `interacts with ${label}`;
  }
};

type BuiltWidget = {
  readonly descriptor: WorkbenchWebWidgetDescriptor;
  readonly memberIds: readonly string[];
};

type AnnotatedCandidate = LayoutInteractiveRecord;

const annotateCandidate = (
  candidate: LayoutInteractiveRecord,
  input: Partial<LayoutInteractiveRecord>
): LayoutInteractiveRecord => ({
  ...candidate,
  ...input
});

const buildListWidgets = ({
  frameTreeNodeId,
  containerId,
  members,
  selectorPreview,
  label,
}: {
  readonly frameTreeNodeId: number;
  readonly containerId: string;
  readonly members: readonly LayoutInteractiveRecord[];
  readonly selectorPreview: string;
  readonly label?: string;
}): {
  readonly widgets: readonly BuiltWidget[];
  readonly annotatedCandidates: readonly AnnotatedCandidate[];
} => {
  const listWidgetId = randomUUID();
  const listKind: WorkbenchWebWidgetKind = isHistoryLikeLabel(label) ? "history-list" : "list";
  const rowKind: WorkbenchWebWidgetKind = listKind === "history-list" ? "history-item" : "list-item";
  const rows = clusterMembersByRow(members).filter((row) => row.length > 0);
  const listBounds = buildBoundsForMembers(members);
  const widgets: BuiltWidget[] = [{
    descriptor: {
      widgetId: listWidgetId,
      kind: listKind,
      frameTreeNodeId,
      containerId,
      ...(label === undefined ? {} : { label }),
      ...(describeWidgetKind(listKind, label) === undefined ? {} : { description: describeWidgetKind(listKind, label) }),
      selectorPreview,
      bounds: listBounds,
      memberNodeIds: members.map((member) => member.candidateId),
    },
    memberIds: members.map((member) => member.candidateId)
  }];

  const annotatedCandidates: AnnotatedCandidate[] = [];
  for (const row of rows) {
    const rowWidgetId = randomUUID();
    const rowBounds = buildBoundsForMembers(row);
    const primaryField = pickPrimaryField(row);
    const identity = inferItemIdentity(row);
    const trailingAction = row.find((member) => isTrailingAction(member, rowBounds));
    const primaryAction = trailingAction ?? pickPrimaryAction(row, primaryField);
    const secondaryActionNodeIds = row
      .filter((member) => member.interactable.clickable && member.candidateId !== primaryAction?.candidateId)
      .slice(0, 4)
      .map((member) => member.candidateId);

    widgets.push({
      descriptor: {
        widgetId: rowWidgetId,
        kind: rowKind,
        frameTreeNodeId,
        containerId,
        parentWidgetId: listWidgetId,
        ownerWidgetId: listWidgetId,
        ...(identity?.label === undefined ? {} : { label: identity.label }),
        ...(describeWidgetKind(rowKind, identity?.label) === undefined
          ? {}
          : { description: describeWidgetKind(rowKind, identity?.label) }),
        selectorPreview,
        bounds: rowBounds,
        memberNodeIds: row.map((member) => member.candidateId),
        ...(primaryField === undefined ? {} : { primaryFieldNodeId: primaryField.candidateId }),
        ...(primaryAction === undefined ? {} : { primaryActionNodeId: primaryAction.candidateId }),
        ...(secondaryActionNodeIds.length === 0 ? {} : { secondaryActionNodeIds }),
        requiresHoverReveal: trailingAction === undefined,
        ...(identity === undefined ? {} : { itemIdentity: identity })
      },
      memberIds: row.map((member) => member.candidateId)
    });

    for (const member of row) {
      const memberKind: WorkbenchWebWidgetKind = (() => {
        if (member.interactable.typable) {
          return rowKind;
        }
        if (isTrailingAction(member, rowBounds)) {
          return "menu-trigger";
        }
        return rowKind;
      })();
      annotatedCandidates.push(annotateCandidate(member, {
        widgetId: rowWidgetId,
        ownerWidgetId: rowWidgetId,
        widgetKind: memberKind,
        ...(identity === undefined ? {} : { itemIdentity: identity })
      }));
    }
  }

  return { widgets, annotatedCandidates };
};

const buildGenericWidget = ({
  frameTreeNodeId,
  containerId,
  members,
  selectorPreview,
  label,
  containerProtected,
}: {
  readonly frameTreeNodeId: number;
  readonly containerId: string;
  readonly members: readonly LayoutInteractiveRecord[];
  readonly selectorPreview: string;
  readonly label?: string;
  readonly containerProtected: boolean;
}): {
  readonly widget: BuiltWidget;
  readonly annotatedCandidates: readonly AnnotatedCandidate[];
} => {
  const widgetId = randomUUID();
  const kind = inferContainerWidgetKind(members);
  const primaryField = pickPrimaryField(members);
  const primaryAction = pickPrimaryAction(members, primaryField);
  const secondaryActionNodeIds = members
    .filter((member) => member.interactable.clickable && member.candidateId !== primaryAction?.candidateId)
    .slice(0, 4)
    .map((member) => member.candidateId);
  const bounds = buildBoundsForMembers(members);
  const widget: BuiltWidget = {
    descriptor: {
      widgetId,
      kind,
      frameTreeNodeId,
      containerId,
      ...(label === undefined ? {} : { label }),
      ...(describeWidgetKind(kind, label) === undefined ? {} : { description: describeWidgetKind(kind, label) }),
      selectorPreview,
      bounds,
      memberNodeIds: members.map((member) => member.candidateId),
      ...(primaryField === undefined ? {} : { primaryFieldNodeId: primaryField.candidateId }),
      ...(primaryAction === undefined ? {} : { primaryActionNodeId: primaryAction.candidateId }),
      ...(secondaryActionNodeIds.length === 0 ? {} : { secondaryActionNodeIds }),
      ...(kind === "menu-panel" ? { transientRevealed: true } : {}),
      ...(kind === "menu" || kind === "menu-panel" ? { opensPanel: true } : {}),
      ...(primaryAction?.stateHint === undefined ? {} : { stateHint: primaryAction.stateHint }),
      ...(containerProtected || kind === "protected" ? { protected: true } : {})
    },
    memberIds: members.map((member) => member.candidateId)
  };

  const annotatedCandidates = members.map((member) => annotateCandidate(member, {
    widgetId,
    widgetKind:
      kind === "menu-panel" && member.interactable.clickable ? "menu-panel"
      : kind === "mode-switcher" && member.interactable.clickable ? "mode-switcher"
      : kind === "toggle-group" && member.interactable.clickable ? "toggle-group"
      : kind
  }));
  return { widget, annotatedCandidates };
};

export const buildLayoutIntelligenceSnapshot = ({
  candidates,
}: WidgetGraphInput): LayoutIntelligenceSnapshot => {
  const groups = new Map<string, LayoutInteractiveRecord[]>();

  for (const candidate of candidates) {
    const key = candidate.containerHint?.selectorAddress.path
      ?? `${candidate.frameTreeNodeId}:${candidate.selectorAddress.path}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(candidate);
    } else {
      groups.set(key, [candidate]);
    }
  }

  const containerNodes: WorkbenchWebContainerNode[] = [];
  const widgets: WorkbenchWebWidgetDescriptor[] = [];
  const layoutNodes: WorkbenchWebLayoutNode[] = [];
  const annotatedCandidates: LayoutInteractiveRecord[] = [];

  for (const members of groups.values()) {
    if (members.length === 0) {
      continue;
    }
    const first = members[0]!;
    const containerId = randomUUID();
    const containerBounds = first.containerHint?.bounds ?? buildBoundsForMembers(members);
    const containerLabel = textOrUndefined(first.containerHint?.label);
    const selectorPreview = first.containerHint?.selectorPreview ?? first.selectorPreview;
    const containerProtected = first.containerHint?.protected === true;

    containerNodes.push({
      containerId,
      frameTreeNodeId: first.frameTreeNodeId,
      tagName: first.containerHint?.tagName ?? "div",
      ...(first.containerHint?.role === undefined ? {} : { role: first.containerHint.role }),
      ...(containerLabel === undefined ? {} : { label: containerLabel }),
      selectorAddress: first.containerHint?.selectorAddress ?? first.selectorAddress,
      selectorPreview,
      bounds: containerBounds,
      memberNodeIds: members.map((member) => member.candidateId),
      ...(containerProtected ? { protected: true } : {})
    });

    layoutNodes.push({
      nodeId: containerId,
      frameTreeNodeId: first.frameTreeNodeId,
      kind: "container",
      tagName: first.containerHint?.tagName ?? "div",
      ...(first.containerHint?.role === undefined ? {} : { role: first.containerHint.role }),
      ...(containerLabel === undefined ? {} : { label: containerLabel }),
      selectorPreview,
      bounds: containerBounds
    });

    const rows = clusterMembersByRow(members);
    const listLike = isRowLikeList(rows);
    if (listLike) {
      const listWidgets = buildListWidgets({
        frameTreeNodeId: first.frameTreeNodeId,
        containerId,
        members,
        selectorPreview,
        ...(containerLabel === undefined ? {} : { label: containerLabel })
      });
      for (const widget of listWidgets.widgets) {
        widgets.push(widget.descriptor);
      }
      for (const candidate of listWidgets.annotatedCandidates) {
        annotatedCandidates.push(candidate);
        layoutNodes.push({
          nodeId: candidate.candidateId,
          frameTreeNodeId: candidate.frameTreeNodeId,
          kind: "interactive",
          tagName: candidate.tagName,
          ...(candidate.role === undefined ? {} : { role: candidate.role }),
          ...(pickLabel(candidate) === undefined ? {} : { label: pickLabel(candidate) }),
          selectorPreview: candidate.selectorPreview,
          bounds: candidate.bounds,
          ...(candidate.widgetId === undefined ? {} : { widgetId: candidate.widgetId })
        });
      }
      continue;
    }

    const generic = buildGenericWidget({
      frameTreeNodeId: first.frameTreeNodeId,
      containerId,
      members,
      selectorPreview,
      ...(containerLabel === undefined ? {} : { label: containerLabel }),
      containerProtected
    });
    widgets.push(generic.widget.descriptor);
    for (const candidate of generic.annotatedCandidates) {
      annotatedCandidates.push(candidate);
      layoutNodes.push({
        nodeId: candidate.candidateId,
        frameTreeNodeId: candidate.frameTreeNodeId,
        kind: "interactive",
        tagName: candidate.tagName,
        ...(candidate.role === undefined ? {} : { role: candidate.role }),
        ...(pickLabel(candidate) === undefined ? {} : { label: pickLabel(candidate) }),
        selectorPreview: candidate.selectorPreview,
        bounds: candidate.bounds,
        ...(candidate.widgetId === undefined ? {} : { widgetId: candidate.widgetId })
      });
    }
  }

  const pageMode = inferPageMode(widgets);
  return {
    pageMode,
    layoutNodes,
    containerNodes,
    widgets,
    candidates: annotatedCandidates
  };
};
