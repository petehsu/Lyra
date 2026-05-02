import type { SearchOfficialCategory } from "../../../shared/desktop-bridge";
import type {
  AggregatedSearchResult,
  SearchChannelStatus,
  SearchEngineDefinition
} from "./types";

export type SearchResultsSourceFilter = "all" | "web" | "local";

export type SearchResultChannelVisibility = {
  readonly showWebResults: boolean;
  readonly showLocalResults: boolean;
};

export type SearchResultLocalStatusLabels = {
  readonly idle: string;
  readonly loading: string;
  readonly ready: string;
  readonly error: string;
};

export type SearchResultOfficialCategoryLabels = {
  readonly fallback: string;
  readonly homepage: string;
  readonly subsite: string;
  readonly docs: string;
  readonly login: string;
  readonly download: string;
  readonly support: string;
};

export type WebResultSourceChip = {
  readonly id: string;
  readonly label: string;
};

export type WebResultViewModel = {
  readonly officialCategoryLabel: string;
  readonly sourceChips: readonly WebResultSourceChip[];
};

export const resolveSearchResultChannelVisibility = (
  sourceFilter: SearchResultsSourceFilter
): SearchResultChannelVisibility => ({
  showWebResults: sourceFilter !== "local",
  showLocalResults: sourceFilter !== "web"
});

export const resolveLocalSearchStatusLabel = (
  status: SearchChannelStatus,
  labels: SearchResultLocalStatusLabels
): string => {
  if (status === "idle") {
    return labels.idle;
  }
  if (status === "loading") {
    return labels.loading;
  }
  if (status === "ready") {
    return labels.ready;
  }
  return labels.error;
};

export const resolveEngineLabel = (
  engineById: ReadonlyMap<string, SearchEngineDefinition>,
  engineId: string
): string => engineById.get(engineId)?.label ?? engineId;

export const resolveOfficialCategoryLabel = (
  category: SearchOfficialCategory | undefined,
  labels: SearchResultOfficialCategoryLabels
): string => {
  if (category === "official_homepage") {
    return labels.homepage;
  }
  if (category === "official_subsite") {
    return labels.subsite;
  }
  if (category === "official_docs") {
    return labels.docs;
  }
  if (category === "official_login") {
    return labels.login;
  }
  if (category === "official_download") {
    return labels.download;
  }
  if (category === "official_support") {
    return labels.support;
  }
  return labels.fallback;
};

export const createWebResultViewModel = (
  result: AggregatedSearchResult,
  engineById: ReadonlyMap<string, SearchEngineDefinition>,
  officialCategoryLabels: SearchResultOfficialCategoryLabels
): WebResultViewModel => ({
  officialCategoryLabel: resolveOfficialCategoryLabel(
    result.officialCategory,
    officialCategoryLabels
  ),
  sourceChips: result.sourceEngineIds.map((engineId) => ({
    id: engineId,
    label: resolveEngineLabel(engineById, engineId)
  }))
});
