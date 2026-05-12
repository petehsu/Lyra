import type { ReactNode } from "react";

import type { FileManagerAppIconKey, FileManagerAppId } from "../file-manager/types";
import type { FileEditorAppIconKey, FileEditorAppId } from "../file-editor/types";
import type { ImageViewerAppIconKey, ImageViewerAppId } from "../image-viewer";
import type { ResourceMonitorAppIconKey, ResourceMonitorAppId } from "../resource-monitor";

export type {
  ImageViewerAppIconKey,
  ImageViewerAppId
} from "../image-viewer";

export type {
  ResourceMonitorAppIconKey,
  ResourceMonitorAppId
} from "../resource-monitor";

export type NotificationCenterAppId = "notification-center";
export type NotificationCenterAppIconKey = "notification-center-default";

export type WorkbenchAppId =
  | FileManagerAppId
  | FileEditorAppId
  | ImageViewerAppId
  | ResourceMonitorAppId
  | NotificationCenterAppId;

export type WorkspaceAppRef = {
  readonly appId: WorkbenchAppId;
  readonly appInstanceId: string;
};

export type WorkspaceAppIconKey =
  | FileManagerAppIconKey
  | FileEditorAppIconKey
  | ImageViewerAppIconKey
  | ResourceMonitorAppIconKey
  | NotificationCenterAppIconKey;

export type WorkspaceAppIconRenderer = (iconKey: WorkspaceAppIconKey) => ReactNode;
