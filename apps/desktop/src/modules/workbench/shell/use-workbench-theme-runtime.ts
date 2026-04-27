import { useEffect, useMemo, useState } from "react";

import {
  observeSystemPrefersDark,
  readSystemPrefersDark,
  resolveThemeVars,
  resolveWorkbenchThemeId,
  type WorkbenchThemeId
} from "../theme";
import { resolveTerminalThemeVars, type TerminalThemeMode } from "../terminal-theme";

type WorkbenchThemeRuntime = {
  readonly systemPrefersDark: boolean;
  readonly themeVars: ReturnType<typeof resolveThemeVars>;
  readonly resolvedThemeId: ReturnType<typeof resolveWorkbenchThemeId>;
  readonly terminalThemeVars: ReturnType<typeof resolveTerminalThemeVars>;
  readonly terminalThemeSignature: string;
};

export const useWorkbenchThemeRuntime = (
  theme: WorkbenchThemeId,
  terminalThemePreset: TerminalThemeMode
): WorkbenchThemeRuntime => {
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() =>
    readSystemPrefersDark()
  );
  const themeVars = useMemo(
    () => resolveThemeVars(theme, systemPrefersDark),
    [theme, systemPrefersDark]
  );
  const resolvedThemeId = useMemo(
    () => resolveWorkbenchThemeId(theme, systemPrefersDark),
    [theme, systemPrefersDark]
  );
  const terminalThemeVars = useMemo(
    () => resolveTerminalThemeVars(terminalThemePreset),
    [terminalThemePreset]
  );
  const terminalThemeSignature = `${theme}:${systemPrefersDark ? "dark" : "light"}:${terminalThemePreset}`;

  useEffect(() => {
    const unsubscribe = observeSystemPrefersDark((prefersDark) => {
      setSystemPrefersDark(prefersDark);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return {
    systemPrefersDark,
    themeVars,
    resolvedThemeId,
    terminalThemeVars,
    terminalThemeSignature
  };
};
