import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";

export type LyraWindowMaterialMode = "native" | "opaque";
export type LyraWindowThemeSource = "system" | "light" | "dark";

type WindowMaterialOptions = Pick<
  BrowserWindowConstructorOptions,
  "backgroundColor" | "backgroundMaterial" | "transparent" | "vibrancy" | "visualEffectState"
>;

export type LyraWindowMaterialDecision = {
  readonly mode: LyraWindowMaterialMode;
  readonly platform: NodeJS.Platform;
  readonly options: WindowMaterialOptions;
};

export type LyraWindowMaterialTarget = {
  readonly setBackgroundColor?: (backgroundColor: string) => void;
  readonly setBackgroundMaterial?: (material: "none" | "mica") => void;
  readonly setVibrancy?: (vibrancy: Parameters<BrowserWindow["setVibrancy"]>[0]) => void;
};

const OPAQUE_BACKGROUND_LIGHT = "#f6f5f6";
const OPAQUE_BACKGROUND_DARK = "#191919";
const TRANSPARENT_BACKGROUND = "#00000000";

const isMaterialDisabled = (env: NodeJS.ProcessEnv): boolean =>
  env.LYRA_DISABLE_WINDOW_MATERIAL === "1";

const isLinuxMaterialEnabled = (env: NodeJS.ProcessEnv): boolean =>
  env.LYRA_ENABLE_LINUX_WINDOW_MATERIAL === "1";

export const resolveOpaqueWindowBackground = (prefersDark: boolean): string =>
  prefersDark ? OPAQUE_BACKGROUND_DARK : OPAQUE_BACKGROUND_LIGHT;

export const resolveThemeSourceFromPreferencesJson = (
  raw: string | null
): LyraWindowThemeSource => {
  if (raw === null) {
    return "system";
  }
  try {
    const theme = (JSON.parse(raw) as { readonly theme?: unknown }).theme;
    if (theme === "lyra-dark") {
      return "dark";
    }
    if (theme === "lyra-light") {
      return "light";
    }
    return "system";
  } catch {
    return "system";
  }
};

export const resolveLyraWindowMaterial = ({
  env,
  platform,
  prefersDark = false
}: {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly prefersDark?: boolean;
}): LyraWindowMaterialDecision => {
  const opaqueBackground = resolveOpaqueWindowBackground(prefersDark);
  if (isMaterialDisabled(env)) {
    return {
      mode: "opaque",
      platform,
      options: {
        backgroundColor: opaqueBackground
      }
    };
  }

  if (platform === "darwin") {
    return {
      mode: "native",
      platform,
      options: {
        backgroundColor: TRANSPARENT_BACKGROUND,
        transparent: true,
        vibrancy: "under-window",
        visualEffectState: "active"
      }
    };
  }

  if (platform === "win32") {
    return {
      mode: "native",
      platform,
      options: {
        backgroundMaterial: "mica"
      }
    };
  }

  if (platform === "linux" && isLinuxMaterialEnabled(env)) {
    return {
      mode: "native",
      platform,
      options: {
        backgroundColor: TRANSPARENT_BACKGROUND,
        transparent: true
      }
    };
  }

  return {
    mode: "opaque",
    platform,
    options: {
      backgroundColor: opaqueBackground
    }
  };
};

export const applyLyraWindowMaterial = (
  window: LyraWindowMaterialTarget,
  decision: LyraWindowMaterialDecision
): LyraWindowMaterialMode => {
  if (decision.mode === "opaque") {
    window.setBackgroundColor?.(
      decision.options.backgroundColor ?? OPAQUE_BACKGROUND_LIGHT
    );
    return "opaque";
  }

  try {
    if (decision.platform === "darwin") {
      window.setVibrancy?.("under-window");
    }

    if (decision.platform === "win32") {
      window.setBackgroundMaterial?.("mica");
    }

    return "native";
  } catch (_error) {
    try {
      window.setBackgroundMaterial?.("none");
    } catch (_fallbackError) {
      // The fallback must never block startup.
    }
    try {
      window.setVibrancy?.(null);
    } catch (_fallbackError) {
      // The fallback must never block startup.
    }
    try {
      window.setBackgroundColor?.(
        decision.options.backgroundColor === TRANSPARENT_BACKGROUND
          ? OPAQUE_BACKGROUND_LIGHT
          : decision.options.backgroundColor ?? OPAQUE_BACKGROUND_LIGHT
      );
    } catch (_fallbackError) {
      // The fallback must never block startup.
    }
    return "opaque";
  }
};
