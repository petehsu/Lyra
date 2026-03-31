import type { ReactNode } from "react";

import type { AiPanelAppIconKey, AiPanelAppId } from "../ai-panel/types";
import type { FileManagerAppIconKey, FileManagerAppId } from "../file-manager/types";
import type { FileEditorAppIconKey, FileEditorAppId } from "../file-editor/types";

export type NotificationCenterAppId = "notification-center";
export type NotificationCenterAppIconKey = "notification-center-default";

export type WorkbenchAppId =
  | FileManagerAppId
  | FileEditorAppId
  | AiPanelAppId
  | NotificationCenterAppId;

export type WorkspaceAppRef = {
  readonly appId: WorkbenchAppId;
  readonly appInstanceId: string;
};

export type WorkspaceAppIconKey =
  | FileManagerAppIconKey
  | FileEditorAppIconKey
  | AiPanelAppIconKey
  | NotificationCenterAppIconKey;

export type WorkspaceAppIconRenderer = (iconKey: WorkspaceAppIconKey) => ReactNode;
