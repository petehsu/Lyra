import { useEffect, useRef } from "react";
import { useWorkbenchPreferencesModel as useDesktopPreferences } from "@workbench/preferences/service";
import type { WorkbenchPreferences } from "@workbench/preferences/types";
import { resolveWorkbenchThemeId } from "@workbench/theme/service";
import { isPreferenceSnapshot, type PreferencePatch } from "../../../../web/site/lib/preference-sync";

export { WORKBENCH_PREFERENCES_STORAGE_KEY, readWorkbenchPreferences, writeWorkbenchPreferences } from "@workbench/preferences/service";

/** Browser-preview adapter only. Use the real desktop preference actions, not
 * cosmetic CSS overrides or a second React preference store.
 */
export function useWorkbenchPreferencesModel(defaults: WorkbenchPreferences) {
  const model = useDesktopPreferences(defaults);
  const current = useRef(model);
  current.current = model;
  const revision = useRef(-1);
  const film = new URLSearchParams(location.search).get("film") === "1";
  const publish = (patch: PreferencePatch) => {
    if (film || revision.current < 0) return;
    window.parent.postMessage({ type: "lyra:preferences-change", baseRevision: revision.current, patch }, location.origin);
  };
  useEffect(() => {
    if (film) return;
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== location.origin || !isPreferenceSnapshot(event.data)) return;
      if (event.data.revision < revision.current) return;
      revision.current = event.data.revision;
      const { theme, locale } = event.data.preferences;
      const nextLocale = locale === "zh" ? "zh-CN" : "en-US";
      if (resolveWorkbenchThemeId(current.current.preferences.theme) !== `lyra-${theme}`) current.current.setTheme(`lyra-${theme}`);
      if (current.current.preferences.locale !== nextLocale) current.current.setLocale(nextLocale);
    };
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const systemChanged = () => {
      if (current.current.preferences.theme.endsWith("-system")) publish({ theme: media.matches ? "dark" : "light" });
    };
    window.addEventListener("message", receive);
    media.addEventListener("change", systemChanged);
    window.parent.postMessage({ type: "lyra:preferences-ready" }, location.origin);
    return () => { window.removeEventListener("message", receive); media.removeEventListener("change", systemChanged); };
  }, [film]);
  return {
    ...model,
    setTheme: (theme: Parameters<typeof model.setTheme>[0]) => {
      model.setTheme(theme);
      publish({ theme: resolveWorkbenchThemeId(theme).endsWith("-dark") ? "dark" : "light" });
    },
    setLocale: (locale: Parameters<typeof model.setLocale>[0]) => {
      model.setLocale(locale);
      if (locale === "zh-CN" || locale === "en-US") publish({ locale: locale === "zh-CN" ? "zh" : "en" });
    },
    reset: () => {
      model.reset();
      publish({ theme: resolveWorkbenchThemeId(defaults.theme).endsWith("-dark") ? "dark" : "light",
        locale: defaults.locale === "zh-CN" ? "zh" : "en" });
    }
  };
}
