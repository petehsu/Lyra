import type { ComponentProps } from "react";

import type { WorkbenchSurfaceAdapters } from "../ui-platform/surface-types";
import type { WorkspaceSurfaceRouterProps } from "./workspace-surface-router";
import type { SoftwareStoreSurfaceProps } from "../software-store";
import type { LoginManagerSurfaceProps } from "../login-manager";

export type WorkspaceSurfaceRenderContext = Omit<
  WorkspaceSurfaceRouterProps,
  "activeTab" | "surfaceAdapters" | "splitThreePaneLayout"
>;

export type SurfacePropsByKind = {
  readonly searchHome: ComponentProps<WorkbenchSurfaceAdapters["searchHome"]>;
  readonly searchResults: ComponentProps<WorkbenchSurfaceAdapters["searchResults"]>;
  readonly browserPage: ComponentProps<WorkbenchSurfaceAdapters["browserPage"]>;
  readonly settings: ComponentProps<WorkbenchSurfaceAdapters["settings"]>;
  readonly terminalWorkspace: ComponentProps<WorkbenchSurfaceAdapters["terminalWorkspace"]>;
  readonly fileManager: ComponentProps<WorkbenchSurfaceAdapters["fileManager"]>;
  readonly fileEditor: ComponentProps<WorkbenchSurfaceAdapters["fileEditor"]>;
  readonly imageViewer: ComponentProps<WorkbenchSurfaceAdapters["imageViewer"]>;
  readonly agentProjectTree: ComponentProps<WorkbenchSurfaceAdapters["agentProjectTree"]>;
  readonly agentPlanBoard: ComponentProps<WorkbenchSurfaceAdapters["agentPlanBoard"]>;
  readonly agentGit: ComponentProps<WorkbenchSurfaceAdapters["agentGit"]>;
  readonly notificationCenter: ComponentProps<WorkbenchSurfaceAdapters["notificationCenter"]>;
  readonly agentSessionHistory: ComponentProps<WorkbenchSurfaceAdapters["agentSessionHistory"]>;
  readonly loginManager: LoginManagerSurfaceProps;
  readonly softwareStore: SoftwareStoreSurfaceProps;
};

export type WorkspaceSurfaceRenderModel =
  | {
      readonly [Kind in keyof SurfacePropsByKind]: {
        readonly kind: Kind;
        readonly props: SurfacePropsByKind[Kind];
      };
    }[keyof SurfacePropsByKind]
  | {
      readonly kind: "empty";
    };