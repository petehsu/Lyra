import { CLASSIC_WORKBENCH_UI_PACK } from "./classic";
import type { createTranslator } from "../i18n";
import {
  DEFAULT_WORKBENCH_UI_PACK_ID,
  WORKBENCH_UI_PACK_IDS,
  isWorkbenchUiPackId,
  resolveWorkbenchUiPackId,
  type WorkbenchUiPackId
} from "./ids";
import {
  WORKBENCH_PANEL_ADAPTER_KEYS,
  WORKBENCH_SURFACE_ADAPTER_KEYS
} from "./surface-types";
import type { WorkbenchUiPack } from "./types";

const WORKBENCH_UI_PACKS = {
  classic: CLASSIC_WORKBENCH_UI_PACK
} satisfies Record<WorkbenchUiPackId, WorkbenchUiPack>;

export const WORKBENCH_CORE_ADAPTER_KEYS = [
  "shell",
  "workspaceTabs",
  "workspaceSurface"
] as const satisfies readonly (keyof WorkbenchUiPack["adapters"])[];

export type WorkbenchUiPackValidationResult =
  | {
      readonly valid: true;
      readonly errors: readonly [];
    }
  | {
      readonly valid: false;
      readonly errors: readonly string[];
    };

const REQUIRED_CAPABILITIES = [
  "supportsStyleTokens",
  "supportsShellAdapter",
  "supportsWorkspaceTabsAdapter",
  "supportsPanelAdapters",
  "supportsWorkspaceSurfaceAdapter",
  "supportsWorkbenchSurfaceAdapters",
  "supportsInteractionPolicy"
] as const satisfies readonly (keyof WorkbenchUiPack["manifest"]["capabilities"])[];

const isFunctionAdapter = (value: unknown): boolean => typeof value === "function";

export const validateWorkbenchUiPack = (
  pack: WorkbenchUiPack
): WorkbenchUiPackValidationResult => {
  const errors: string[] = [];
  if (pack.manifest.compatibility.workbenchUiApi !== "1") {
    errors.push(`Unsupported workbench UI API: ${pack.manifest.compatibility.workbenchUiApi}`);
  }
  for (const capability of REQUIRED_CAPABILITIES) {
    if (pack.manifest.capabilities[capability] !== true) {
      errors.push(`Missing required capability: ${capability}`);
    }
  }
  for (const key of WORKBENCH_CORE_ADAPTER_KEYS) {
    if (!isFunctionAdapter(pack.adapters[key])) {
      errors.push(`Missing core adapter: ${key}`);
    }
  }
  for (const key of WORKBENCH_PANEL_ADAPTER_KEYS) {
    if (!isFunctionAdapter(pack.adapters[key])) {
      errors.push(`Missing panel adapter: ${key}`);
    }
  }
  for (const key of WORKBENCH_SURFACE_ADAPTER_KEYS) {
    if (!isFunctionAdapter(pack.adapters.surfaces[key])) {
      errors.push(`Missing surface adapter: ${key}`);
    }
  }
  if (pack.style.id !== pack.manifest.id) {
    errors.push(`Style pack id must match UI pack id: ${pack.style.id}`);
  }
  return errors.length === 0
    ? { valid: true, errors: [] }
    : { valid: false, errors };
};

export {
  DEFAULT_WORKBENCH_UI_PACK_ID,
  WORKBENCH_UI_PACK_IDS,
  isWorkbenchUiPackId,
  resolveWorkbenchUiPackId
};

export const resolveWorkbenchUiPack = (
  packId: unknown = DEFAULT_WORKBENCH_UI_PACK_ID
): WorkbenchUiPack => WORKBENCH_UI_PACKS[resolveWorkbenchUiPackId(packId)];

export type WorkbenchUiPackOption = {
  readonly value: WorkbenchUiPackId;
  readonly label: string;
  readonly description: string;
};

export const createWorkbenchUiPackOptions = (
  t: ReturnType<typeof createTranslator>
): readonly WorkbenchUiPackOption[] =>
  WORKBENCH_UI_PACK_IDS.map((packId) => {
    const pack = WORKBENCH_UI_PACKS[packId];
    return {
      value: pack.manifest.id,
      label: t(pack.manifest.labelKey),
      description: t(pack.manifest.descriptionKey)
    };
  });

export const syncWorkbenchUiPackToDocument = (pack: WorkbenchUiPack): void => {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  for (const id of WORKBENCH_UI_PACK_IDS) {
    root.classList.remove(WORKBENCH_UI_PACKS[id].style.documentClassName);
  }
  root.classList.add(pack.style.documentClassName);
  root.dataset.lyraUiPack = pack.manifest.id;
  root.dataset.lyraUiStyle = pack.style.id;
};
