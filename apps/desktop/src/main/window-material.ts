import type { BrowserWindow, BrowserWindowConstructorOptions } from "electron";

export type LyraWindowMaterialMode = "native" | "opaque";

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

const OPAQUE_BACKGROUND = "#f6f5f6";
const TRANSPARENT_BACKGROUND = "#00000000";

const isMaterialDisabled = (env: NodeJS.ProcessEnv): boolean =>
  env.LYRA_DISABLE_WINDOW_MATERIAL === "1";

const isLinuxMaterialEnabled = (env: NodeJS.ProcessEnv): boolean =>
  env.LYRA_ENABLE_LINUX_WINDOW_MATERIAL === "1";

export const resolveLyraWindowMaterial = ({
  env,
  platform
}: {
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
}): LyraWindowMaterialDecision => {
  if (isMaterialDisabled(env)) {
    return {
      mode: "opaque",
      platform,
      options: {
        backgroundColor: OPAQUE_BACKGROUND
      }
    };
  }

  if (platform === "darwin") {
    return {
      mode: "native",
      platform,
      options: {
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
      backgroundColor: OPAQUE_BACKGROUND
    }
  };
};

export const applyLyraWindowMaterial = (
  window: LyraWindowMaterialTarget,
  decision: LyraWindowMaterialDecision
): LyraWindowMaterialMode => {
  if (decision.mode === "opaque") {
    window.setBackgroundColor?.(OPAQUE_BACKGROUND);
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
      window.setBackgroundColor?.(OPAQUE_BACKGROUND);
    } catch (_fallbackError) {
      // The fallback must never block startup.
    }
    return "opaque";
  }
};
