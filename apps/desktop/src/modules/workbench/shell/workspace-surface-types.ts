import type { ComponentProps } from "react";

import type { WorkbenchSurfaceAdapters } from "../ui-platform/surface-types";
import type { WorkspaceSurfaceRouterProps } from "./workspace-surface-router";

export type WorkspaceSurfaceRenderContext = Omit<
  WorkspaceSurfaceRouterProps,
  "activeTab" | "surfaceAdapters" | "splitThreePaneLayout"
>;

export type SurfacePropsByKind = {
  readonly searchHome: ComponentProps<WorkbenchSurfaceAdapters["searchHome"]>;
  readonly searchResults: ComponentProps<WorkbenchSurfaceAdapters["searchResults"]>;
  readonly deepSearchResults: ComponentProps<WorkbenchSurfaceAdapters["deepSearchResults"]>;
  readonly browserPage: ComponentProps<WorkbenchSurfaceAdapters["browserPage"]>;
  readonly settings: ComponentProps<WorkbenchSurfaceAdapters["settings"]>;
  readonly terminalWorkspace: ComponentProps<WorkbenchSurfaceAdapters["terminalWorkspace"]>;
  readonly fileManager: ComponentProps<WorkbenchSurfaceAdapters["fileManager"]>;
  readonly fileEditor: ComponentProps<WorkbenchSurfaceAdapters["fileEditor"]>;
  readonly notificationCenter: ComponentProps<WorkbenchSurfaceAdapters["notificationCenter"]>;
  readonly mcpCenter: ComponentProps<WorkbenchSurfaceAdapters["mcpCenter"]>;
  readonly skillsCenter: ComponentProps<WorkbenchSurfaceAdapters["skillsCenter"]>;
  readonly pluginsCenter: ComponentProps<WorkbenchSurfaceAdapters["pluginsCenter"]>;
  readonly aiHistory: ComponentProps<WorkbenchSurfaceAdapters["aiHistory"]>;
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
