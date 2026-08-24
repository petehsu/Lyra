import { useMemo } from "react";

import type { SearchEngineDefinition } from "../browser-search/types";
import { WORKBENCH_CONFIG } from "../config";
import type { WorkbenchPreferences } from "../preferences";
import type { BrowserSearchSettings } from "../browser-search";

export type WorkbenchSearchSettingsFacade = {
  readonly allSearchEngines: readonly SearchEngineDefinition[];
  readonly integratedSearchEngines: readonly SearchEngineDefinition[];
  readonly activeSearchEngines: readonly SearchEngineDefinition[];
  readonly engineById: ReadonlyMap<string, SearchEngineDefinition>;
  readonly browserSearchSettings: BrowserSearchSettings;
};

export const useWorkbenchSearchSettings = (
  preferences: WorkbenchPreferences
): WorkbenchSearchSettingsFacade => {
  const allSearchEngines = useMemo<readonly SearchEngineDefinition[]>(
    () => WORKBENCH_CONFIG.browser.searchEngines,
    []
  );

  const integratedSearchEngines = useMemo<readonly SearchEngineDefinition[]>(
    () => WORKBENCH_CONFIG.browser.searchEngines,
    []
  );

  const fixedSearchEngines = useMemo<readonly SearchEngineDefinition[]>(
    () => {
      const lookup = new Map(allSearchEngines.map((engine) => [engine.id, engine]));
      const selected = preferences.searchWebEngineIds
        .map((id) => lookup.get(id))
        .filter((engine): engine is SearchEngineDefinition => engine !== undefined);
      return selected.length > 0
        ? selected.slice(0, 1)
        : [lookup.get("bing") ?? allSearchEngines[0]!];
    },
    [allSearchEngines, preferences.searchWebEngineIds]
  );

  const activeSearchEngines = useMemo<readonly SearchEngineDefinition[]>(
    () => {
      return preferences.searchEngineMode === "fixed"
        ? fixedSearchEngines
        : allSearchEngines;
    },
    [allSearchEngines, fixedSearchEngines, preferences.searchEngineMode]
  );

  const engineById = useMemo(
    () => new Map(allSearchEngines.map((engine) => [engine.id, engine])),
    [allSearchEngines]
  );

  const browserSearchSettings = useMemo<BrowserSearchSettings>(
    () => ({
      mode: preferences.searchEngineMode,
      searchEngines: activeSearchEngines,
      resultsPerEngine: WORKBENCH_CONFIG.browser.resultsPerEngine
    }),
    [activeSearchEngines, preferences.searchEngineMode]
  );

  return {
    allSearchEngines,
    integratedSearchEngines,
    activeSearchEngines,
    engineById,
    browserSearchSettings
  };
};
