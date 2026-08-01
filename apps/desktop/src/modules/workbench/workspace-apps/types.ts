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
  AgentPlanBoardAppIconKey,
  AgentPlanBoardAppId
} from "../agent-plan-board";
import type {
  AgentGitAppIconKey,
  AgentGitAppId
} from "../agent-git";
import type {
  SoftwareStoreAppIconKey,
  SoftwareStoreAppId
} from "../software-store";
import type {
  LoginManagerAppIconKey,
  LoginManagerAppId
} from "../login-manager";

export type {
  AgentSessionHistoryAppIconKey,
  AgentSessionHistoryAppId
} from "../agent-session-history";
export type {
  AgentProjectTreeAppIconKey,
  AgentProjectTreeAppId
} from "../agent-project-tree";
export type {
  AgentPlanBoardAppIconKey,
  AgentPlanBoardAppId
} from "../agent-plan-board";
export type {
  AgentGitAppIconKey,
  AgentGitAppId
} from "../agent-git";
export type {
  SoftwareStoreAppIconKey,
  SoftwareStoreAppId
} from "../software-store";
export type {
  LoginManagerAppIconKey,
  LoginManagerAppId
} from "../login-manager";

export type {
  ImageViewerAppIconKey,
  ImageViewerAppId
} from "../image-viewer";

export type NotificationCenterAppId = "notification-center";
export type NotificationCenterAppIconKey = "notification-center-default";

export type BuiltinWorkbenchAppId =
  | FileManagerAppId
  | FileEditorAppId
  | ImageViewerAppId
  | AgentProjectTreeAppId
  | AgentPlanBoardAppId
  | AgentGitAppId
  | AgentSessionHistoryAppId
  | LoginManagerAppId
  | NotificationCenterAppId
  | SoftwareStoreAppId;

/** Stable application identifier. Unknown ids are retained so missing modules can be repaired. */
export type WorkbenchAppId = string;

export type WorkspaceAppRef = {
  readonly appId: WorkbenchAppId;
  readonly appVersion: string;
  readonly appInstanceId: string;
};

export type BuiltinWorkspaceAppIconKey =
  | FileManagerAppIconKey
  | FileEditorAppIconKey
  | ImageViewerAppIconKey
  | AgentProjectTreeAppIconKey
  | AgentPlanBoardAppIconKey
  | AgentGitAppIconKey
  | AgentSessionHistoryAppIconKey
  | LoginManagerAppIconKey
  | NotificationCenterAppIconKey
  | SoftwareStoreAppIconKey;

export type WorkspaceAppIconKey = string;

export type WorkspaceAppIconRenderer = (iconKey: WorkspaceAppIconKey) => ReactNode;
