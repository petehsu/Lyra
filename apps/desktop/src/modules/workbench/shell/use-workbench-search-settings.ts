import { useMemo } from "react";

import type { SearchEngineDefinition } from "../browser-search/types";
import { WORKBENCH_CONFIG } from "../config";
import type { WorkbenchPreferences } from "../preferences";
import type { BrowserSearchSettings } from "../browser-search";

export type WorkbenchSearchSettingsFacade = {
  readonly allSearchEngines: readonly SearchEngineDefinition[];
  readonly integratedSearchEngines: readonly SearchEngineDefinition[];
  readonly registeredSearchEngines: readonly SearchEngineDefinition[];
  readonly activeSearchEngines: readonly SearchEngineDefinition[];
  readonly engineById: ReadonlyMap<string, SearchEngineDefinition>;
  readonly browserSearchSettings: BrowserSearchSettings;
};

export const useWorkbenchSearchSettings = (
  preferences: WorkbenchPreferences
): WorkbenchSearchSettingsFacade => {
  const allSearchEngines = useMemo<readonly SearchEngineDefinition[]>(
    () => {
      const engines: SearchEngineDefinition[] = [...WORKBENCH_CONFIG.browser.searchEngines];
      const searxngEndpoint = preferences.searchSearxngEndpoint?.trim();
      if (searxngEndpoint !== undefined && searxngEndpoint.length > 0) {
        engines.push({
          id: "searxng",
          label: "SearXNG",
          accentColor: "#4F8F5B",
          endpoint: searxngEndpoint,
          searchUrlTemplate: searxngEndpoint
        });
      }
      return engines;
    },
    [preferences.searchSearxngEndpoint]
  );

  const integratedSearchEngines = useMemo<readonly SearchEngineDefinition[]>(
    () => WORKBENCH_CONFIG.browser.searchEngines,
    []
  );

  const registeredSearchEngines = useMemo<readonly SearchEngineDefinition[]>(
    () => {
      const lookup = new Map(allSearchEngines.map((engine) => [engine.id, engine]));
      return preferences.searchWebEngineIds
        .map((id) => lookup.get(id))
        .filter((engine): engine is SearchEngineDefinition => engine !== undefined);
    },
    [allSearchEngines, preferences.searchWebEngineIds]
  );

  const activeSearchEngines = useMemo<readonly SearchEngineDefinition[]>(
    () => {
      const lookup = new Map(allSearchEngines.map((engine) => [engine.id, engine]));
      const preferred =
        preferences.searchWebEngineIds.length > 0
          ? preferences.searchWebEngineIds
              .map((id) => lookup.get(id))
              .filter((engine): engine is SearchEngineDefinition => engine !== undefined)
          : [];
      return preferred.length > 0 ? preferred : allSearchEngines;
    },
    [allSearchEngines, preferences.searchWebEngineIds]
  );

  const engineById = useMemo(
    () => new Map(allSearchEngines.map((engine) => [engine.id, engine])),
    [allSearchEngines]
  );

  const browserSearchSettings = useMemo<BrowserSearchSettings>(
    () => ({
      searchEngines: integratedSearchEngines,
      resultsPerEngine: WORKBENCH_CONFIG.browser.resultsPerEngine
    }),
    [integratedSearchEngines]
  );

  return {
    allSearchEngines,
    integratedSearchEngines,
    registeredSearchEngines,
    activeSearchEngines,
    engineById,
    browserSearchSettings
  };
};
