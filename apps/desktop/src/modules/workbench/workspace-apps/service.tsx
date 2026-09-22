import type { ReactNode } from "react";

import { renderFileEditorAppIcon } from "../file-editor/icon-registry";
import type {
  FileEditorAppIconKey,
  FileEditorAppId
} from "../file-editor/types";
import { renderFileManagerAppIcon } from "../file-manager/icon-registry";
import type {
  FileManagerAppIconKey,
  FileManagerAppId
} from "../file-manager/types";
import { renderImageViewerAppIcon } from "../image-viewer/icon-registry";
import type {
  ImageViewerAppIconKey,
  ImageViewerAppId
} from "../image-viewer/types";
import { renderNotificationCenterAppIcon } from "../notifications/icon-registry";
import { renderAgentSessionHistoryAppIcon } from "../agent-session-history/icon-registry";
import type {
  AgentSessionHistoryAppIconKey,
  AgentSessionHistoryAppId
} from "../agent-session-history/types";
import { renderAgentProjectTreeAppIcon } from "../agent-project-tree/icon-registry";
import type {
  AgentProjectTreeAppIconKey,
  AgentProjectTreeAppId
} from "../agent-project-tree/types";
import { renderAgentPlanBoardAppIcon } from "../agent-plan-board/icon-registry";
import type {
  AgentPlanBoardAppIconKey,
  AgentPlanBoardAppId
} from "../agent-plan-board/types";
import { renderAgentSubagentAppIcon } from "../agent-subagent/icon-registry";
import type {
  AgentSubagentAppIconKey,
  AgentSubagentAppId
} from "../agent-subagent/types";
import { renderAgentGitAppIcon } from "../agent-git/icon-registry";
import type {
  AgentGitAppIconKey,
  AgentGitAppId
} from "../agent-git/types";
import {
  renderSoftwareStoreAppIcon
} from "../software-store/service";
import type {
  SoftwareStoreAppIconKey,
  SoftwareStoreAppId
} from "../software-store/types";
import {
  renderLoginManagerAppIcon
} from "../login-manager/service";
import type {
  LoginManagerAppIconKey,
  LoginManagerAppId
} from "../login-manager/types";
import type { WorkbenchAppId, WorkspaceAppIconKey } from "./types";

const renderers: Record<WorkbenchAppId, (iconKey: WorkspaceAppIconKey) => ReactNode> = {
  "file-manager": (iconKey) => renderFileManagerAppIcon(iconKey as FileManagerAppIconKey),
  "file-editor": (iconKey) => renderFileEditorAppIcon(iconKey as FileEditorAppIconKey),
  "image-viewer": (iconKey) => renderImageViewerAppIcon(iconKey as ImageViewerAppIconKey),
  "office-viewer": (iconKey) => renderFileEditorAppIcon(iconKey as FileEditorAppIconKey),
  "agent-project-tree": (iconKey) =>
    renderAgentProjectTreeAppIcon(iconKey as AgentProjectTreeAppIconKey),
  "agent-plan-board": (iconKey) =>
    renderAgentPlanBoardAppIcon(iconKey as AgentPlanBoardAppIconKey),
  "agent-subagent": (iconKey) =>
    renderAgentSubagentAppIcon(iconKey as AgentSubagentAppIconKey),
  "agent-git": (iconKey) =>
    renderAgentGitAppIcon(iconKey as AgentGitAppIconKey),
  "agent-session-history": (iconKey) =>
    renderAgentSessionHistoryAppIcon(iconKey as AgentSessionHistoryAppIconKey),
  "login-manager": (iconKey) =>
    renderLoginManagerAppIcon(iconKey as LoginManagerAppIconKey),
  "notification-center": (iconKey) =>
    renderNotificationCenterAppIcon(iconKey as "notification-center-default"),
  "software-store": (iconKey) =>
    renderSoftwareStoreAppIcon(iconKey as SoftwareStoreAppIconKey)
};

export const renderWorkspaceAppIcon = (
  appId: WorkbenchAppId,
  iconKey: WorkspaceAppIconKey
): ReactNode => {
  const renderer = renderers[appId];
  return renderer === undefined
    ? renderNotificationCenterAppIcon("notification-center-default")
    : renderer(iconKey);
};

export const isFileManagerAppId = (value: WorkbenchAppId): value is FileManagerAppId =>
  value === "file-manager";

export const isFileEditorAppId = (value: WorkbenchAppId): value is FileEditorAppId =>
  value === "file-editor";

export const isImageViewerAppId = (value: WorkbenchAppId): value is ImageViewerAppId =>
  value === "image-viewer";

export const isAgentProjectTreeAppId = (
  value: WorkbenchAppId
): value is AgentProjectTreeAppId =>
  value === "agent-project-tree";

export const isAgentPlanBoardAppId = (
  value: WorkbenchAppId
): value is AgentPlanBoardAppId =>
  value === "agent-plan-board";

export const isAgentSubagentAppId = (
  value: WorkbenchAppId
): value is AgentSubagentAppId =>
  value === "agent-subagent";

export const isAgentGitAppId = (
  value: WorkbenchAppId
): value is AgentGitAppId =>
  value === "agent-git";

export const isAgentSessionHistoryAppId = (
  value: WorkbenchAppId
): value is AgentSessionHistoryAppId =>
  value === "agent-session-history";

export const isLoginManagerAppId = (
  value: WorkbenchAppId
): value is LoginManagerAppId =>
  value === "login-manager";

export const isNotificationCenterAppId = (value: WorkbenchAppId): value is "notification-center" =>
  value === "notification-center";

export const isSoftwareStoreAppId = (
  value: WorkbenchAppId
): value is SoftwareStoreAppId =>
  value === "software-store";
