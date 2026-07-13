import type { AuthLocalePreference } from "../../shared/auth";
import { createInitialWorkbenchPreferences } from "@workbench/shell/workbench-shell-defaults";
import {
  readWorkbenchPreferences,
  writeWorkbenchPreferences
} from "@workbench/preferences";
import type { WorkbenchThemeId } from "@workbench/theme";

export const LOCAL_STARTUP_COMPLETE_KEY = "lyra.startup.local-complete.v1";

export const hasCompletedLocalStartup = (): boolean =>
  typeof window !== "undefined" && window.localStorage.getItem(LOCAL_STARTUP_COMPLETE_KEY) === "1";

export const markLocalStartupComplete = (): void => {
  window.localStorage.setItem(LOCAL_STARTUP_COMPLETE_KEY, "1");
};

export const persistStartupPreferences = (params: {
  readonly locale: string;
  readonly localePreference: AuthLocalePreference;
  readonly theme: WorkbenchThemeId;
}): void => {
  const current = readWorkbenchPreferences(createInitialWorkbenchPreferences());
  writeWorkbenchPreferences({
    ...current,
    locale: params.locale,
    localePreference: params.localePreference,
    theme: params.theme
  });
};
