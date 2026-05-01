import type { ReactNode } from "react";

import type { AiPanelAppIconKey, AiPanelAppId } from "../ai-panel/types";
import type { FileManagerAppIconKey, FileManagerAppId } from "../file-manager/types";
import type { FileEditorAppIconKey, FileEditorAppId } from "../file-editor/types";
import type { ResourceMonitorAppIconKey, ResourceMonitorAppId } from "../resource-monitor";

export type {
  ResourceMonitorAppIconKey,
  ResourceMonitorAppId
} from "../resource-monitor";

export type NotificationCenterAppId = "notification-center";
export type NotificationCenterAppIconKey = "notification-center-default";

export type WorkbenchAppId =
  | FileManagerAppId
  | FileEditorAppId
  | ResourceMonitorAppId
  | AiPanelAppId
  | NotificationCenterAppId;

export type WorkspaceAppRef = {
  readonly appId: WorkbenchAppId;
  readonly appInstanceId: string;
};

export type WorkspaceAppIconKey =
  | FileManagerAppIconKey
  | FileEditorAppIconKey
  | ResourceMonitorAppIconKey
  | AiPanelAppIconKey
  | NotificationCenterAppIconKey;

export type WorkspaceAppIconRenderer = (iconKey: WorkspaceAppIconKey) => ReactNode;
