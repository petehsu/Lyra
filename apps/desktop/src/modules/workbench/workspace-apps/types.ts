import type { ReactNode } from "react";

import type { FileManagerAppIconKey, FileManagerAppId } from "../file-manager/types";
import type { FileEditorAppIconKey, FileEditorAppId } from "../file-editor/types";
import type { ImageViewerAppIconKey, ImageViewerAppId } from "../image-viewer";
import type {
  AgentSessionHistoryAppIconKey,
  AgentSessionHistoryAppId
} from "../agent-session-history";
import type {
  AgentProjectTreeAppIconKey,
  AgentProjectTreeAppId
} from "../agent-project-tree";
import type {
  AgentGitAppIconKey,
  AgentGitAppId
} from "../agent-git";
import type {
  AgentSelfDevAppIconKey,
  AgentSelfDevAppId
} from "../agent-selfdev";
import type {
  AgentOvernightAppIconKey,
  AgentOvernightAppId
} from "../agent-overnight";
import type {
  SoftwareStoreAppIconKey,
  SoftwareStoreAppId
} from "../software-store";

export type {
  AgentSessionHistoryAppIconKey,
  AgentSessionHistoryAppId
} from "../agent-session-history";
export type {
  AgentProjectTreeAppIconKey,
  AgentProjectTreeAppId
} from "../agent-project-tree";
export type {
  AgentGitAppIconKey,
  AgentGitAppId
} from "../agent-git";
export type {
  AgentSelfDevAppIconKey,
  AgentSelfDevAppId
} from "../agent-selfdev";
export type {
  AgentOvernightAppIconKey,
  AgentOvernightAppId
} from "../agent-overnight";
export type {
  SoftwareStoreAppIconKey,
  SoftwareStoreAppId
} from "../software-store";

export type {
  ImageViewerAppIconKey,
  ImageViewerAppId
} from "../image-viewer";

export type NotificationCenterAppId = "notification-center";
export type NotificationCenterAppIconKey = "notification-center-default";

export type WorkbenchAppId =
  | FileManagerAppId
  | FileEditorAppId
  | ImageViewerAppId
  | AgentProjectTreeAppId
  | AgentGitAppId
  | AgentSelfDevAppId
  | AgentOvernightAppId
  | AgentSessionHistoryAppId
  | NotificationCenterAppId
  | SoftwareStoreAppId;

export type WorkspaceAppRef = {
  readonly appId: WorkbenchAppId;
  readonly appInstanceId: string;
};

export type WorkspaceAppIconKey =
  | FileManagerAppIconKey
  | FileEditorAppIconKey
  | ImageViewerAppIconKey
  | AgentProjectTreeAppIconKey
  | AgentGitAppIconKey
  | AgentSelfDevAppIconKey
  | AgentOvernightAppIconKey
  | AgentSessionHistoryAppIconKey
  | NotificationCenterAppIconKey
  | SoftwareStoreAppIconKey;

export type WorkspaceAppIconRenderer = (iconKey: WorkspaceAppIconKey) => ReactNode;
