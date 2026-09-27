export type SharedPreferences = { theme: "light" | "dark"; locale: "zh" | "en" };
export type PreferencePatch = Partial<SharedPreferences>;
export type PreferenceSnapshot = { type: "lyra:preferences-set"; revision: number; preferences: SharedPreferences };

export function isPreferencePatch(value: unknown): value is PreferencePatch {
  if (!value || typeof value !== "object") return false;
  const patch = value as PreferencePatch;
  return Object.keys(value).every(key => key === "theme" || key === "locale")
    && (!Object.hasOwn(value, "theme") || patch.theme === "light" || patch.theme === "dark")
    && (!Object.hasOwn(value, "locale") || patch.locale === "zh" || patch.locale === "en")
    && (patch.theme !== undefined || patch.locale !== undefined);
}

export function isPreferenceSnapshot(value: unknown): value is PreferenceSnapshot {
  const message = value as PreferenceSnapshot | null;
  return !!message && message.type === "lyra:preferences-set"
    && Number.isSafeInteger(message.revision) && message.revision >= 0
    && isPreferencePatch(message.preferences)
    && message.preferences.theme !== undefined && message.preferences.locale !== undefined;
}

/** One ordered stream. Startup reports, acknowledgements and film narration
 * are never user changes; delayed reports cannot undo a newer selection.
 */
export function createPreferenceAuthority(initial: SharedPreferences) {
  let preferences = { ...initial };
  let revision = 0;
  const snapshot = (): PreferenceSnapshot => ({ type: "lyra:preferences-set", revision, preferences: { ...preferences } });
  const update = (patch: PreferencePatch) => {
    const next = { ...preferences, ...patch };
    if (next.theme !== preferences.theme || next.locale !== preferences.locale) {
      preferences = next;
      revision++;
    }
    return snapshot();
  };
  return {
    snapshot,
    update,
    receive(baseRevision: unknown, patch: unknown) {
      if (baseRevision !== revision || !isPreferencePatch(patch)) return null;
      return update(patch);
    }
  };
}
