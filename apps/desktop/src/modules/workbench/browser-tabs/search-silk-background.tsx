import { lazy, Suspense, useEffect, useMemo, useState } from "react";

const Silk = lazy(() => import("./silk"));

type SilkTheme = {
  readonly color: string;
  readonly animationEnabled: boolean;
};

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const FALLBACK_LIGHT_APP = "#dcdcdd";
const FALLBACK_LIGHT_MUTED = "#7e8086";
const FALLBACK_DARK_APP = "#3b414d";
const FALLBACK_DARK_MUTED = "#878a98";

const isBrowserRuntime = (): boolean =>
  typeof window !== "undefined" && typeof document !== "undefined";

const normalizeHexColor = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  const hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex.split("").map((part) => part + part).join("")}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return `#${hex}`.toLowerCase();
  }
  return fallback;
};

const hexToRgb = (hex: string): readonly [number, number, number] => {
  const normalized = normalizeHexColor(hex, FALLBACK_LIGHT_APP).slice(1);
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16)
  ];
};

const rgbToHex = (red: number, green: number, blue: number): string =>
  `#${[red, green, blue]
    .map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0"))
    .join("")}`;

const mixHex = (from: string, to: string, toWeight: number): string => {
  const fromRgb = hexToRgb(from);
  const toRgb = hexToRgb(to);
  const fromWeight = 1 - toWeight;
  return rgbToHex(
    fromRgb[0] * fromWeight + toRgb[0] * toWeight,
    fromRgb[1] * fromWeight + toRgb[1] * toWeight,
    fromRgb[2] * fromWeight + toRgb[2] * toWeight
  );
};

const readRootVar = (name: string, fallback: string): string => {
  if (!isBrowserRuntime()) {
    return fallback;
  }
  return normalizeHexColor(
    window.getComputedStyle(document.documentElement).getPropertyValue(name),
    fallback
  );
};

const readThemeTone = (): "light" | "dark" => {
  if (!isBrowserRuntime()) {
    return "light";
  }
  return document.documentElement.dataset.lyraThemeTone === "dark" ? "dark" : "light";
};

const readSilkColor = (): string => {
  const tone = readThemeTone();
  const app = readRootVar("--lyra-bg-app", tone === "dark" ? FALLBACK_DARK_APP : FALLBACK_LIGHT_APP);
  const muted = readRootVar(
    "--lyra-text-muted",
    tone === "dark" ? FALLBACK_DARK_MUTED : FALLBACK_LIGHT_MUTED
  );
  return tone === "dark" ? mixHex(app, muted, 0.32) : mixHex(app, muted, 0.24);
};

const readPrefersReducedMotion = (): boolean => {
  if (!isBrowserRuntime() || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
};

const readDocumentVisible = (): boolean => {
  if (!isBrowserRuntime()) {
    return true;
  }
  return document.visibilityState !== "hidden";
};

const supportsWebGL = (): boolean => {
  if (!isBrowserRuntime()) {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    const context = (
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")
    ) as WebGL2RenderingContext | WebGLRenderingContext | null;
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    return context !== null;
  } catch {
    return false;
  }
};

const useSilkTheme = (): SilkTheme => {
  const [color, setColor] = useState(readSilkColor);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(readPrefersReducedMotion);
  const [isDocumentVisible, setIsDocumentVisible] = useState(readDocumentVisible);
  const [hasWebGL] = useState(supportsWebGL);

  useEffect(() => {
    if (!isBrowserRuntime()) {
      return undefined;
    }

    const updateColor = () => {
      setColor(readSilkColor());
    };
    const observer = new MutationObserver(updateColor);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-lyra-theme-tone", "style"]
    });
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!isBrowserRuntime() || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const updateMotion = () => {
      setPrefersReducedMotion(media.matches);
    };
    updateMotion();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", updateMotion);
      return () => {
        media.removeEventListener("change", updateMotion);
      };
    }

    media.addListener(updateMotion);
    return () => {
      media.removeListener(updateMotion);
    };
  }, []);

  useEffect(() => {
    if (!isBrowserRuntime()) {
      return undefined;
    }

    const updateVisibility = () => {
      setIsDocumentVisible(readDocumentVisible());
    };
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);

  return useMemo(
    () => ({
      color,
      animationEnabled: hasWebGL && isDocumentVisible && !prefersReducedMotion
    }),
    [color, hasWebGL, isDocumentVisible, prefersReducedMotion]
  );
};

export const SearchSilkBackground = () => {
  const theme = useSilkTheme();

  return (
    <div aria-hidden="true" className="lyra-search-silk-background">
      {theme.animationEnabled ? (
        <div className="lyra-search-silk-canvas-layer">
          <Suspense fallback={null}>
            <Silk
              animationEnabled={theme.animationEnabled}
              color={theme.color}
              noiseIntensity={1.05}
              rotation={-0.08}
              scale={1.06}
              speed={2.2}
            />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
};
