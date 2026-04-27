import type { ComponentType } from "react";

import type { BrowserTabStripProps } from "../browser-tabs/tab-strip";
import type { I18nKey } from "../i18n";
import type { WorkbenchInteractionPolicies } from "../interaction-policy";
import type { WorkbenchShellAdapterProps } from "../shell/workbench-chrome";
import type { WorkspaceSurfaceRouterProps } from "../shell/workspace-surface-router";
import type { WorkbenchUiStylePack } from "../ui-style";
import type { WorkbenchUiPackId } from "./ids";
import type { WorkbenchPanelAdapters, WorkbenchSurfaceAdapters } from "./surface-types";

export type WorkbenchUiPackSource =
  | {
      readonly type: "builtin";
    }
  | {
      readonly type: "trusted-js";
      readonly trustState: "trusted" | "untrusted" | "revoked";
      readonly origin?: string;
    };

export type WorkbenchUiPackCompatibility = {
  readonly workbenchUiApi: "1";
};

export type WorkbenchUiPackCapabilities = {
  readonly supportsStyleTokens: boolean;
  readonly supportsShellAdapter: boolean;
  readonly supportsWorkspaceTabsAdapter: boolean;
  readonly supportsPanelAdapters: boolean;
  readonly supportsWorkspaceSurfaceAdapter: boolean;
  readonly supportsWorkbenchSurfaceAdapters: boolean;
  readonly supportsInteractionPolicy: boolean;
  readonly supportsTrustedJsDistribution: boolean;
  readonly supportsCommunityDistribution: boolean;
};

export type WorkbenchUiPackManifest = {
  readonly id: WorkbenchUiPackId;
  readonly labelKey: I18nKey;
  readonly descriptionKey: I18nKey;
  readonly version: string;
  readonly compatibility: WorkbenchUiPackCompatibility;
  readonly source: WorkbenchUiPackSource;
  readonly capabilities: WorkbenchUiPackCapabilities;
};

export type WorkbenchUiPackAdapters = {
  readonly shell: ComponentType<WorkbenchShellAdapterProps>;
  readonly workspaceTabs: ComponentType<BrowserTabStripProps>;
  readonly workspaceSurface: ComponentType<WorkspaceSurfaceRouterProps>;
  readonly surfaces: WorkbenchSurfaceAdapters;
} & WorkbenchPanelAdapters;

export type WorkbenchUiPack = {
  readonly manifest: WorkbenchUiPackManifest;
  readonly style: WorkbenchUiStylePack;
  readonly adapters: WorkbenchUiPackAdapters;
  readonly interactions: WorkbenchInteractionPolicies;
};

export type WorkbenchUiRuntime = {
  readonly pack: WorkbenchUiPack;
  readonly packId: WorkbenchUiPackId;
  readonly stylePack: WorkbenchUiStylePack;
  readonly rootClassName: string;
  readonly rootAttributes: WorkbenchUiStylePack["rootAttributes"] & {
    readonly "data-lyra-ui-pack": WorkbenchUiPackId;
  };
  readonly vars: WorkbenchUiStylePack["vars"];
  readonly adapters: WorkbenchUiPackAdapters;
  readonly interactions: WorkbenchInteractionPolicies;
};
