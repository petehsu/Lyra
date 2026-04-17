import type {
  WorkbenchWebSkeletonRegion,
  WorkbenchWebWidgetKind,
} from "../../shared/workbench-web-automation";
import type { LiveSelectorScanCandidateRecord } from "./live-selector/types";

const normalizeText = (value: string | undefined): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const WITHIN_SCOPE_ALIASES: readonly {
  readonly aliases: readonly string[];
  readonly regionKinds: readonly WorkbenchWebSkeletonRegion["kind"][];
  readonly widgetKinds: readonly WorkbenchWebWidgetKind[];
}[] = [
  {
    aliases: ["main", "content", "center", "workspace", "body"],
    regionKinds: ["content", "composer", "dialog", "form", "table"],
    widgetKinds: ["panel", "composer", "chat-composer", "search-bar", "form", "login-form", "dialog", "card"]
  },
  {
    aliases: ["sidebar", "side", "nav", "navigation", "left"],
    regionKinds: ["sidebar", "list"],
    widgetKinds: ["sidebar", "history-list", "history-item", "navigation", "list", "list-item", "toggle-group"]
  },
  {
    aliases: ["composer", "input", "editor", "textbox", "chat"],
    regionKinds: ["composer"],
    widgetKinds: ["composer", "chat-composer", "search-bar"]
  },
  {
    aliases: ["toolbar", "header", "topbar", "top"],
    regionKinds: ["toolbar", "header"],
    widgetKinds: ["toolbar", "mode-switcher", "toggle-group"]
  },
  {
    aliases: ["menu", "dropdown", "popup"],
    regionKinds: ["menu"],
    widgetKinds: ["menu", "menu-trigger", "menu-panel"]
  },
  {
    aliases: ["dialog", "modal"],
    regionKinds: ["dialog"],
    widgetKinds: ["dialog"]
  },
  {
    aliases: ["form", "login"],
    regionKinds: ["form"],
    widgetKinds: ["form", "login-form"]
  }
] as const;

export const inferCandidateSemanticRole = (
  candidate: Pick<LiveSelectorScanCandidateRecord, "role" | "tagName" | "inputType" | "interactable">
): string | undefined => {
  const explicitRole = normalizeText(candidate.role);
  if (explicitRole.length > 0) {
    return explicitRole;
  }

  const tagName = normalizeText(candidate.tagName);
  const inputType = normalizeText(candidate.inputType);

  if (tagName === "button") {
    return "button";
  }
  if (tagName === "a") {
    return "link";
  }
  if (tagName === "textarea") {
    return "textbox";
  }
  if (tagName === "select") {
    return "combobox";
  }
  if (tagName === "input") {
    if (inputType === "search") {
      return "searchbox";
    }
    if (["checkbox", "radio"].includes(inputType)) {
      return inputType;
    }
    if (["button", "submit", "reset"].includes(inputType)) {
      return "button";
    }
    return "textbox";
  }
  if (candidate.interactable.typable === true) {
    return "textbox";
  }
  return undefined;
};

export const matchesRequestedRoles = (
  candidate: Pick<LiveSelectorScanCandidateRecord, "role" | "tagName" | "inputType" | "interactable">,
  roles: readonly string[]
): boolean => {
  if (roles.length === 0) {
    return true;
  }
  const semanticRole = inferCandidateSemanticRole(candidate);
  if (semanticRole === undefined) {
    return false;
  }
  return roles.map((value) => normalizeText(value)).includes(semanticRole);
};

const resolveWithinDescriptor = (
  within: string | undefined
): (typeof WITHIN_SCOPE_ALIASES)[number] | null => {
  const normalizedWithin = normalizeText(within);
  if (normalizedWithin.length === 0) {
    return null;
  }
  return WITHIN_SCOPE_ALIASES.find((entry) => entry.aliases.includes(normalizedWithin)) ?? null;
};

export const matchesSemanticWithinScope = ({
  candidate,
  within,
  regionKindById
}: {
  readonly candidate: Pick<LiveSelectorScanCandidateRecord, "focusRegionId" | "widgetKind">;
  readonly within: string | undefined;
  readonly regionKindById?: ReadonlyMap<string, WorkbenchWebSkeletonRegion["kind"]>;
}): boolean | null => {
  const descriptor = resolveWithinDescriptor(within);
  if (descriptor === null) {
    return null;
  }

  if (candidate.focusRegionId !== undefined) {
    const regionKind = regionKindById?.get(candidate.focusRegionId);
    if (regionKind !== undefined && descriptor.regionKinds.includes(regionKind)) {
      return true;
    }
  }

  if (candidate.widgetKind !== undefined && descriptor.widgetKinds.includes(candidate.widgetKind)) {
    return true;
  }

  return false;
};
