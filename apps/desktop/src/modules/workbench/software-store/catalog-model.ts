import { formatShortDateTime } from "@workbench/i18n";

import type {
  BuiltinUiuxPackSummary,
  ComponentSummary,
  InstalledUiuxPack,
  LyraSoftwareManifest,
  UiuxListPacksResponse,
  UiuxPackSource
} from "../../../shared/desktop-bridge";
import type { WorkbenchUiPackId } from "../ui-platform";
import type {
  SoftwareStoreAgentAccess,
  SoftwareStoreBuiltinApp,
  SoftwareStoreCatalogFilter,
  SoftwareStoreLabels
} from "./types";

export type BuiltinSoftwareItem = {
  readonly kind: "software";
  readonly key: string;
  readonly software: LyraSoftwareManifest;
};

export type UiuxSoftwareItem = {
  readonly kind: "uiux";
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly sourceLabel: string;
  readonly permissions: readonly string[];
  readonly active: boolean;
  readonly pending: boolean;
  readonly builtin: boolean;
  readonly installed?: InstalledUiuxPack;
};

export type ComponentSoftwareItem = {
  readonly kind: "component";
  readonly key: string;
  readonly component: ComponentSummary;
};

export type SoftwareStoreItem =
  | BuiltinSoftwareItem
  | UiuxSoftwareItem
  | ComponentSoftwareItem;

export const createItemKey = (
  kind: SoftwareStoreItem["kind"],
  id: string
): string => `${kind}:${id}`;

export const formatDate = (value: string | undefined): string => {
  if (value === undefined) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return formatShortDateTime(date.getTime());
};

const formatSource = (
  source: UiuxPackSource | "builtin",
  labels: SoftwareStoreLabels
): string => {
  if (source === "builtin") {
    return labels.builtinSource;
  }
  if (source.kind === "local") {
    return `${labels.localSource} · ${source.path}`;
  }
  if (source.kind === "git") {
    return [
      `${labels.gitSource} · ${source.url}`,
      source.ref,
      source.subdir
    ]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" · ");
  }
  return [
    `${labels.npmSource} · ${source.packageName}`,
    source.version,
    source.subdir
  ]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" · ");
};

export const toUserError = (error: unknown): string =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Operation failed";

export const getAgentAccessLabel = (
  access: SoftwareStoreAgentAccess,
  labels: SoftwareStoreLabels
): string => {
  if (access === "controllable") {
    return labels.agentAccessControllable;
  }
  if (access === "readOnly") {
    return labels.agentAccessReadOnly;
  }
  return labels.agentAccessNotConnected;
};

export const getSoftwareAgentAccess = (
  software: LyraSoftwareManifest
): SoftwareStoreAgentAccess => {
  if (software.actions.length === 0) {
    return "notConnected";
  }
  return software.actions.every((action) => action.risk === "read")
    ? "readOnly"
    : "controllable";
};

export const findBuiltinApp = (
  labels: SoftwareStoreLabels,
  software: LyraSoftwareManifest
): SoftwareStoreBuiltinApp | undefined =>
  labels.builtinApps.find((app) => app.id === software.id);

export const createUiuxItems = (
  response: UiuxListPacksResponse | null,
  activeUiPackId: WorkbenchUiPackId,
  labels: SoftwareStoreLabels
): readonly UiuxSoftwareItem[] => {
  if (response === null) {
    return [];
  }
  const pendingPackId = response.pendingExternalPackId;
  const activePackId = pendingPackId ?? response.activeExternalPackId ?? activeUiPackId;
  const builtins = response.builtin.map((pack: BuiltinUiuxPackSummary): UiuxSoftwareItem => ({
    kind: "uiux",
    key: createItemKey("uiux", pack.id),
    id: pack.id,
    name: pack.name,
    description: pack.description,
    version: "1.0.0",
    sourceLabel: formatSource("builtin", labels),
    permissions: [],
    active: activePackId === pack.id,
    pending: pendingPackId === pack.id,
    builtin: true
  }));
  const installed = response.installed.map((pack): UiuxSoftwareItem => ({
    kind: "uiux",
    key: createItemKey("uiux", pack.id),
    id: pack.id,
    name: pack.manifest.name,
    description: pack.manifest.description,
    version: pack.manifest.version,
    sourceLabel: formatSource(pack.source, labels),
    permissions: pack.manifest.permissions,
    active: activePackId === pack.id,
    pending: pendingPackId === pack.id,
    builtin: false,
    installed: pack
  }));
  return [...builtins, ...installed];
};

export const matchesQuery = (
  item: SoftwareStoreItem,
  query: string
): boolean => {
  if (query.length === 0) {
    return true;
  }
  const haystack = item.kind === "software"
    ? `${item.software.title} ${item.software.description} ${item.software.category ?? ""} ${item.software.id}`
    : item.kind === "uiux"
      ? `${item.name} ${item.description} ${item.id} ${item.sourceLabel}`
      : `${item.component.componentId} ${item.component.kind} ${item.component.active ?? ""}`;
  return haystack.toLowerCase().includes(query);
};

export const matchesFilter = (
  item: SoftwareStoreItem,
  filter: SoftwareStoreCatalogFilter
): boolean =>
  filter === "all"
  || (filter === "builtin" && item.kind === "software" && item.software.source === "builtin")
  || (filter === "components" && item.kind === "component")
  || (
    filter === "uiux"
    && (item.kind === "uiux" || (item.kind === "software" && item.software.source === "uiux"))
  );

export const getItemTitle = (item: SoftwareStoreItem): string =>
  item.kind === "software"
    ? item.software.title
    : item.kind === "component"
      ? item.component.componentId
      : item.name;

export const getItemDescription = (item: SoftwareStoreItem): string =>
  item.kind === "software"
    ? item.software.description
    : item.kind === "component"
      ? `${item.component.kind} · ${item.component.versions.length} version(s)`
      : item.description;

export const getItemMeta = (
  item: SoftwareStoreItem,
  labels: SoftwareStoreLabels
): string =>
  item.kind === "software"
    ? item.software.category ?? labels.builtinType
    : item.kind === "component"
      ? item.component.active ?? item.component.pending ?? "-"
      : item.version;
