import { useEffect } from "react";

import { WORKBENCH_LOCALES, type I18nKey, type WorkbenchLocale } from "../i18n";
import {
  WORKBENCH_THEME_IDS,
  type WorkbenchResolvedThemeId,
  type WorkbenchThemeId
} from "../theme";
import type {
  WorkbenchSplitOverflowPolicy,
  WorkbenchSplitThreePaneLayout,
  WorkbenchSplitTriggerMode
} from "../preferences";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import {
  PANEL_LAYOUT_COUPLING,
  PANEL_LAYOUT_FALLBACK_VIEWPORT,
  PANEL_LAYOUT_RATIOS
} from "./panel-layout-config";
import type { WorkbenchLayoutPreset, WorkbenchPanelKey } from "./types";

export const DIVIDER_SIZE = 0;
export const LOGO_URL = new URL(
  "../../../renderer/assets/brand/lyra-mark.svg",
  import.meta.url
).toString();

export type PanelViewportSize = {
  readonly width: number;
  readonly height: number;
};

export type PanelSizeBounds = {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly leftMinWidth: number;
  readonly leftMaxWidth: number;
  readonly leftDefaultWidth: number;
  readonly centerMinWidth: number;
  readonly bottomMinHeight: number;
  readonly bottomMaxHeight: number;
  readonly bottomDefaultHeight: number;
  readonly workspaceMinHeight: number;
};

export type PanelSizeState = {
  readonly leftWidth: number;
  readonly bottomHeight: number;
};

export const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const sanitizeDimension = (value: number | undefined, fallback: number): number => {
  if (typeof value !== "number" || Number.isFinite(value) === false || value <= 0) {
    return fallback;
  }
  return value;
};

export const resolvePanelViewportSize = (
  viewport?: Partial<PanelViewportSize>
): PanelViewportSize => {
  const rawWidth =
    viewport?.width ??
    (typeof window !== "undefined" ? window.innerWidth : undefined);
  const rawHeight =
    viewport?.height ??
    (typeof window !== "undefined" ? window.innerHeight : undefined);

  return {
    width: sanitizeDimension(rawWidth, PANEL_LAYOUT_FALLBACK_VIEWPORT.width),
    height: sanitizeDimension(rawHeight, PANEL_LAYOUT_FALLBACK_VIEWPORT.height)
  };
};

const resolveBoundedRange = (params: {
  readonly total: number;
  readonly minRatio: number;
  readonly maxRatio: number;
  readonly reserve: number;
  readonly defaultRatio: number;
}): { readonly min: number; readonly max: number; readonly preferred: number } => {
  const capacity = Math.max(0, params.total - params.reserve - DIVIDER_SIZE);
  const desiredMin = Math.round(params.total * params.minRatio);
  const desiredMax = Math.round(params.total * params.maxRatio);
  const desiredDefault = Math.round(params.total * params.defaultRatio);

  const min = Math.min(desiredMin, capacity);
  const max = Math.max(min, Math.min(desiredMax, capacity));
  const preferred = clamp(desiredDefault, min, max);

  return {
    min,
    max,
    preferred
  };
};

export const resolvePanelSizeBounds = (
  viewport?: Partial<PanelViewportSize>
): PanelSizeBounds => {
  const { width, height } = resolvePanelViewportSize(viewport);
  const centerMinWidth = Math.round(width * PANEL_LAYOUT_RATIOS.centerMinWidth);
  const workspaceMinHeight = Math.round(height * PANEL_LAYOUT_RATIOS.workspaceMinHeight);

  const leftRange = resolveBoundedRange({
    total: width,
    minRatio: PANEL_LAYOUT_RATIOS.leftMinWidth,
    maxRatio: PANEL_LAYOUT_RATIOS.leftMaxWidth,
    reserve: centerMinWidth,
    defaultRatio: PANEL_LAYOUT_RATIOS.leftDefaultWidth
  });
  const leftMaxByCenterHalf = Math.floor(centerMinWidth / 2);
  const leftMaxWidth = Math.max(
    leftRange.min,
    Math.min(leftRange.max, leftMaxByCenterHalf)
  );
  const leftDefaultWidth = clamp(
    leftRange.preferred,
    leftRange.min,
    leftMaxWidth
  );

  const bottomRange = resolveBoundedRange({
    total: height,
    minRatio: PANEL_LAYOUT_RATIOS.bottomMinHeight,
    maxRatio: PANEL_LAYOUT_RATIOS.bottomMaxHeight,
    reserve: workspaceMinHeight,
    defaultRatio: PANEL_LAYOUT_RATIOS.bottomDefaultHeight
  });
  const bottomMaxByWorkspaceHalf = Math.floor(workspaceMinHeight / 2);
  const bottomMaxHeight = Math.max(
    bottomRange.min,
    Math.min(bottomRange.max, bottomMaxByWorkspaceHalf)
  );
  const bottomDefaultHeight = clamp(
    bottomRange.preferred,
    bottomRange.min,
    bottomMaxHeight
  );

  return {
    viewportWidth: width,
    viewportHeight: height,
    leftMinWidth: leftRange.min,
    leftMaxWidth,
    leftDefaultWidth,
    centerMinWidth,
    bottomMinHeight: bottomRange.min,
    bottomMaxHeight,
    bottomDefaultHeight,
    workspaceMinHeight
  };
};

const toOccupancy = (value: number, min: number, max: number): number => {
  if (max <= min) {
    return 0;
  }
  return (clamp(value, min, max) - min) / (max - min);
};

export const resolveCoupledPanelSizes = (
  requested: PanelSizeState,
  bounds: PanelSizeBounds
): PanelSizeState => {
  let leftWidth = clamp(
    requested.leftWidth,
    bounds.leftMinWidth,
    bounds.leftMaxWidth
  );
  let bottomHeight = clamp(
    requested.bottomHeight,
    bounds.bottomMinHeight,
    bounds.bottomMaxHeight
  );

  for (let index = 0; index < PANEL_LAYOUT_COUPLING.iterationCount; index += 1) {
    const leftOccupancy = toOccupancy(
      leftWidth,
      bounds.leftMinWidth,
      bounds.leftMaxWidth
    );
    const bottomMaxByLeft = Math.round(
      bounds.bottomMaxHeight -
        (bounds.bottomMaxHeight - bounds.bottomMinHeight) *
          leftOccupancy *
          PANEL_LAYOUT_COUPLING.compressionFactor
    );
    bottomHeight = clamp(
      bottomHeight,
      bounds.bottomMinHeight,
      Math.max(bounds.bottomMinHeight, bottomMaxByLeft)
    );

    const bottomOccupancy = toOccupancy(
      bottomHeight,
      bounds.bottomMinHeight,
      bounds.bottomMaxHeight
    );
    const leftMaxByBottom = Math.round(
      bounds.leftMaxWidth -
        (bounds.leftMaxWidth - bounds.leftMinWidth) *
          bottomOccupancy *
          PANEL_LAYOUT_COUPLING.compressionFactor
    );
    leftWidth = clamp(
      leftWidth,
      bounds.leftMinWidth,
      Math.max(bounds.leftMinWidth, leftMaxByBottom)
    );
  }

  return {
    leftWidth,
    bottomHeight
  };
};

export const getDesktopApi = (): LyraDesktopApi | null => {
  if (typeof window === "undefined") return null;
  if (window.lyraDesktop === undefined) return null;
  return window.lyraDesktop;
};

type Option<T extends string> = {
  readonly value: T;
  readonly label: string;
};

export const createSettingLocaleOptions = (
  t: (key: I18nKey) => string
): readonly Option<WorkbenchLocale>[] =>
  WORKBENCH_LOCALES.map((locale) => ({
    value: locale,
    label: t(`settings.locale.${locale}` as I18nKey)
  }));

export const createSettingThemeOptions = (
  t: (key: I18nKey) => string
): readonly Option<WorkbenchThemeId>[] =>
  WORKBENCH_THEME_IDS.map((themeId) => ({
    value: themeId,
    label: t(`settings.theme.${themeId}` as I18nKey)
  }));

const WORKBENCH_SPLIT_TRIGGER_MODES = [
  "ctrl_left_drag",
  "right_drag"
] as const satisfies readonly WorkbenchSplitTriggerMode[];

const WORKBENCH_SPLIT_THREE_PANE_LAYOUTS = [
  "top_two_bottom_one",
  "top_one_bottom_two",
  "left_two_right_one",
  "left_one_right_two",
  "adaptive"
] as const satisfies readonly WorkbenchSplitThreePaneLayout[];

const WORKBENCH_SPLIT_OVERFLOW_POLICIES = [
  "block_with_notice",
  "replace_oldest",
  "replace_target"
] as const satisfies readonly WorkbenchSplitOverflowPolicy[];

export const createSettingSplitTriggerModeOptions = (
  t: (key: I18nKey) => string
): readonly Option<WorkbenchSplitTriggerMode>[] =>
  WORKBENCH_SPLIT_TRIGGER_MODES.map((mode) => ({
    value: mode,
    label: t(`settings.splitTriggerMode.${mode}` as I18nKey)
  }));

export const createSettingSplitThreePaneLayoutOptions = (
  t: (key: I18nKey) => string
): readonly Option<WorkbenchSplitThreePaneLayout>[] =>
  WORKBENCH_SPLIT_THREE_PANE_LAYOUTS.map((layout) => ({
    value: layout,
    label: t(`settings.splitThreePaneLayout.${layout}` as I18nKey)
  }));

export const createSettingSplitOverflowPolicyOptions = (
  t: (key: I18nKey) => string
): readonly Option<WorkbenchSplitOverflowPolicy>[] =>
  WORKBENCH_SPLIT_OVERFLOW_POLICIES.map((policy) => ({
    value: policy,
    label: t(`settings.splitOverflowPolicy.${policy}` as I18nKey)
  }));

type DocsEntryContext = {
  readonly locale: WorkbenchLocale;
  readonly themeId: WorkbenchResolvedThemeId;
};

export const resolveDocsEntryUrl = (
  baseAddress: string,
  context: DocsEntryContext
): string => {
  try {
    const url = new URL(baseAddress);
    url.searchParams.set("host", "lyra");
    url.searchParams.set("locale", context.locale);
    url.searchParams.set("theme", context.themeId);
    return url.toString();
  } catch {
    return baseAddress;
  }
};

export type WorkbenchShortcutHandlers = {
  readonly focusIntentInput: () => void;
  readonly runIntent: () => void;
  readonly setPreset: (preset: WorkbenchLayoutPreset) => void;
  readonly togglePanel: (panel: WorkbenchPanelKey) => void;
};

const isEditableTarget = (event: KeyboardEvent): boolean => {
  const target = event.target;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return false;
};

const hasPrimaryModifier = (event: KeyboardEvent): boolean => event.metaKey || event.ctrlKey;

export const useWorkbenchShortcuts = ({
  focusIntentInput,
  runIntent,
  setPreset,
  togglePanel
}: WorkbenchShortcutHandlers): void => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (hasPrimaryModifier(event) === false) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "l") {
        event.preventDefault();
        focusIntentInput();
        return;
      }

      if (key === "1") {
        event.preventDefault();
        setPreset("browser");
        return;
      }

      if (key === "2") {
        event.preventDefault();
        setPreset("ide");
        return;
      }

      if (key === "b") {
        event.preventDefault();
        togglePanel("files");
        return;
      }

      if (key === "i") {
        event.preventDefault();
        togglePanel("ai");
        return;
      }

      if (key === "j") {
        event.preventDefault();
        togglePanel("runtime");
        return;
      }

      if (key === "enter") {
        if (isEditableTarget(event) === false) {
          event.preventDefault();
          runIntent();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [focusIntentInput, runIntent, setPreset, togglePanel]);
};

export const createDefaultTerminalLogs = (): readonly string[] => [
  "$ pnpm dev",
  "server ready at http://localhost:3000",
  "[warn] checkout api: 500 INTERNAL_SERVER_ERROR",
  "[hint] correlation_id=7f9a0d"
];

export const syncCssVarsToDocumentRoot = (
  vars: Record<`--${string}`, string>
): void => {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
};

export const resolveMainGridColumns = (state: {
  readonly preset: WorkbenchLayoutPreset;
  readonly showFiles: boolean;
  readonly showAi: boolean;
}): string => {
  const columns = ["var(--lyra-unit-48)"];

  if (state.showFiles) {
    columns.push(state.preset === "browser" ? "var(--lyra-unit-220)" : "var(--lyra-unit-240)");
  }

  columns.push("minmax(0, 1fr)");

  if (state.showAi) {
    columns.push(state.preset === "browser" ? "var(--lyra-unit-420)" : "var(--lyra-unit-360)");
  }

  return columns.join(" ");
};

export const resolveCanvasColumns = (preset: WorkbenchLayoutPreset): string =>
  preset === "browser" ? "0.7fr 1.3fr" : "1.3fr 0.7fr";
