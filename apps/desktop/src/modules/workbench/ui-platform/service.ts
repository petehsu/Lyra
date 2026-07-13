import * as React from "react";

import { uiPackI18nNamespace } from "../i18n";
import i18n from "../i18n/i18n-instance";
import { getWorkbenchLocale } from "../i18n/locale-state";
import { CLASSIC_WORKBENCH_UI_PACK } from "./classic";
import type { createTranslator } from "../i18n";
import { CLASSIC_WORKBENCH_INTERACTION_POLICIES } from "../interaction-policy";
import * as primitives from "../ui-primitives";
import {
  DEFAULT_WORKBENCH_UI_PACK_ID,
  EXTERNAL_WORKBENCH_UI_PACK_ID_PREFIX,
  WORKBENCH_UI_PACK_IDS,
  isBuiltinWorkbenchUiPackId,
  isExternalWorkbenchUiPackId,
  isWorkbenchUiPackId,
  resolveWorkbenchUiPackId,
  type WorkbenchUiPackId
} from "./ids";
import {
  WORKBENCH_PANEL_ADAPTER_KEYS,
  WORKBENCH_SURFACE_ADAPTER_KEYS
} from "./surface-types";
import type { LyraDesktopApi, UiuxPackRuntime } from "../../../shared/desktop-bridge";
import type { LyraSoftwareCapabilitiesContext } from "../../../shared/software-capabilities";
import type {
  WorkbenchUiPack,
  WorkbenchUiPackContext,
  WorkbenchUiPackModule
} from "./types";

const WORKBENCH_UI_PACKS: Record<string, WorkbenchUiPack> = {
  classic: CLASSIC_WORKBENCH_UI_PACK
};

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
  EXTERNAL_WORKBENCH_UI_PACK_ID_PREFIX,
  WORKBENCH_UI_PACK_IDS,
  isBuiltinWorkbenchUiPackId,
  isExternalWorkbenchUiPackId,
  isWorkbenchUiPackId,
  resolveWorkbenchUiPackId
};

export const resolveWorkbenchUiPack = (
  packId: unknown = DEFAULT_WORKBENCH_UI_PACK_ID
): WorkbenchUiPack => {
  const resolvedPackId = resolveWorkbenchUiPackId(packId);
  return WORKBENCH_UI_PACKS[resolvedPackId] ?? CLASSIC_WORKBENCH_UI_PACK;
};

export type WorkbenchUiPackOption = {
  readonly value: WorkbenchUiPackId;
  readonly label: string;
  readonly description: string;
};

export const createWorkbenchUiPackOptions = (
  t: ReturnType<typeof createTranslator>
): readonly WorkbenchUiPackOption[] =>
  WORKBENCH_UI_PACK_IDS.map((packId) => {
    const pack = WORKBENCH_UI_PACKS[packId] ?? CLASSIC_WORKBENCH_UI_PACK;
    return {
      value: pack.manifest.id,
      label: pack.manifest.labelKey === undefined
        ? pack.manifest.label ?? pack.manifest.id
        : t(pack.manifest.labelKey),
      description: pack.manifest.descriptionKey === undefined
        ? pack.manifest.description ?? ""
        : t(pack.manifest.descriptionKey)
    };
  });

export const syncWorkbenchUiPackToDocument = (pack: WorkbenchUiPack): void => {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const previousPackClassName = root.dataset.lyraUiPackClassName;
  if (previousPackClassName !== undefined && previousPackClassName.length > 0) {
    root.classList.remove(previousPackClassName);
  }
  for (const id of WORKBENCH_UI_PACK_IDS) {
    root.classList.remove((WORKBENCH_UI_PACKS[id] ?? CLASSIC_WORKBENCH_UI_PACK).style.documentClassName);
  }
  root.classList.add(pack.style.documentClassName);
  root.dataset.lyraUiPackClassName = pack.style.documentClassName;
  root.dataset.lyraUiPack = pack.manifest.id;
  root.dataset.lyraUiStyle = pack.style.id;
};

const EXTERNAL_UI_PACK_CSS_LINK_ID = "lyra-external-ui-pack-css";

export const syncExternalWorkbenchUiPackCss = (cssUrl: string | null): void => {
  if (typeof document === "undefined") {
    return;
  }

  const existing = document.getElementById(EXTERNAL_UI_PACK_CSS_LINK_ID);
  if (cssUrl === null) {
    existing?.remove();
    return;
  }
  const link =
    existing instanceof HTMLLinkElement
      ? existing
      : document.createElement("link");
  link.id = EXTERNAL_UI_PACK_CSS_LINK_ID;
  link.rel = "stylesheet";
  link.href = cssUrl;
  if (link.parentElement === null) {
    document.head.append(link);
  }
};

const isWorkbenchUiPackModule = (value: unknown): value is WorkbenchUiPackModule => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<WorkbenchUiPackModule>;
  return typeof candidate.createPack === "function"
    && typeof candidate.manifest === "object"
    && candidate.manifest !== null;
};

const EMPTY_SOFTWARE_CAPABILITIES: LyraSoftwareCapabilitiesContext = {
  software: [],
  registerActionHandler: () => () => {}
};

type UiPackFixedTranslator = (
  locale: string,
  namespace: string
) => (key: string, options?: Readonly<Record<string, unknown>>) => string;

const getUiPackFixedTranslator = i18n.getFixedT as unknown as UiPackFixedTranslator;

export const createWorkbenchUiPackContext = (
  desktopApi: LyraDesktopApi | null,
  capabilities: LyraSoftwareCapabilitiesContext = EMPTY_SOFTWARE_CAPABILITIES,
  packId?: WorkbenchUiPackId
): WorkbenchUiPackContext => {
  const namespace = packId === undefined ? "translation" : uiPackI18nNamespace(packId);
  return {
    apiVersion: "1",
    React,
    desktopApi,
    capabilities,
    adapters: CLASSIC_WORKBENCH_UI_PACK.adapters,
    style: CLASSIC_WORKBENCH_UI_PACK.style,
    interactions: CLASSIC_WORKBENCH_INTERACTION_POLICIES,
    primitives,
    i18n: {
      namespace,
      t: (key, options) => {
        const translate = getUiPackFixedTranslator(getWorkbenchLocale(), namespace);
        return options === undefined ? translate(key) : translate(key, options);
      }
    }
  };
};

export const loadExternalWorkbenchUiPack = async ({
  packId,
  runtime,
  desktopApi,
  capabilities
}: {
  readonly packId: WorkbenchUiPackId;
  readonly runtime: UiuxPackRuntime;
  readonly desktopApi: LyraDesktopApi | null;
  readonly capabilities?: LyraSoftwareCapabilitiesContext;
}): Promise<WorkbenchUiPack> => {
  const importedModule = await import(/* @vite-ignore */ runtime.entryUrl) as unknown;
  if (!isWorkbenchUiPackModule(importedModule)) {
    throw new Error(`External UIUX pack entry did not export a WorkbenchUiPackModule: ${packId}`);
  }
  const pack = await importedModule.createPack(
    createWorkbenchUiPackContext(desktopApi, capabilities, packId)
  );
  const trustedPack: WorkbenchUiPack = {
    ...pack,
    manifest: {
      ...pack.manifest,
      id: packId,
      source: {
        type: "trusted-js",
        trustState: "trusted",
        origin: runtime.entryUrl
      }
    },
    style: {
      ...pack.style,
      id: packId,
      rootAttributes: {
        ...pack.style.rootAttributes,
        "data-lyra-ui-style": packId
      }
    }
  };
  const validation = validateWorkbenchUiPack(trustedPack);
  if (validation.valid === false) {
    throw new Error(`Invalid external UIUX pack ${packId}: ${validation.errors.join("; ")}`);
  }

  return trustedPack;
};
