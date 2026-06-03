import { useEffect, useMemo, useState } from "react";

import {
  observeSystemPrefersDark,
  readSystemPrefersDark,
  resolveThemeVars,
  resolveWorkbenchThemeId,
  type WorkbenchThemeId
} from "../theme";

type WorkbenchThemeRuntime = {
  readonly systemPrefersDark: boolean;
  readonly themeVars: ReturnType<typeof resolveThemeVars>;
  readonly resolvedThemeId: ReturnType<typeof resolveWorkbenchThemeId>;
};

export const useWorkbenchThemeRuntime = (
  theme: WorkbenchThemeId,
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
  };
};
