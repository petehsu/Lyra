import { useCallback } from "react";

import type { FileEditorModel } from "../file-editor";
import type { FileManagerModel } from "../file-manager";
import type { GlobalDialogOpenRequest } from "../global-dialog";
import type { I18nKey } from "../i18n";
import {
  createNotificationCenterAppRequest,
  type WorkbenchNotificationItem,
  type WorkbenchNotificationModel,
  type WorkbenchNotificationTarget
} from "../notifications";
import type { WorkspaceTabsModel } from "../workspace-tabs/types";
import type { WorkspaceAppIconKey } from "../workspace-apps";

type WorkbenchTranslator = (key: I18nKey) => string;

type UseWorkbenchNotificationNavigationParams = {
  readonly tabsModel: WorkspaceTabsModel;
  readonly fileManagerModel: FileManagerModel;
  readonly fileEditorModel: FileEditorModel;
  readonly notificationModel: WorkbenchNotificationModel;
  readonly openDialog: (request: GlobalDialogOpenRequest) => void;
  readonly t: WorkbenchTranslator;
};

export type WorkbenchNotificationNavigation = {
  readonly onOpenNotificationCenter: () => void;
  readonly onOpenNotificationPreview: () => void;
  readonly onOpenNotificationSource: (notificationId: string) => void;
  readonly onRequestClearNotifications: () => void;
};

const resolveNotificationAppIconKey = (
  appId: Extract<WorkbenchNotificationTarget, { kind: "app-tab" }>["appId"]
): WorkspaceAppIconKey => {
  switch (appId) {
    case "file-manager":
      return "file-manager-home";
    case "file-editor":
      return "file-editor-code";
    case "agent-project-tree":
      return "agent-project-tree-default";
    case "agent-session-history":
      return "agent-session-history-default";
    case "software-store":
      return "software-store-default";
    case "notification-center":
      return "notification-center-default";
    default:
      return "notification-center-default";
  }
};

export const useWorkbenchNotificationNavigation = ({
  tabsModel,
  fileManagerModel,
  fileEditorModel,
  notificationModel,
  openDialog,
  t
}: UseWorkbenchNotificationNavigationParams): WorkbenchNotificationNavigation => {
  const closeNotificationCenterTabs = useCallback((): void => {
    tabsModel.tabs
      .filter((tab) =>
        tab.pageKind === "app" &&
        tab.appId === "notification-center"
      )
      .forEach((tab) => {
        tabsModel.closeTab(tab.id);
      });
  }, [tabsModel.closeTab, tabsModel.tabs]);

  const openNotificationCenterTab = useCallback((notificationId?: string): void => {
    if (notificationModel.notifications.length === 0) {
      closeNotificationCenterTabs();
      return;
    }

    const trimmedNotificationId =
      typeof notificationId === "string" ? notificationId.trim() : "";
    if (trimmedNotificationId.length > 0) {
      notificationModel.selectNotification(trimmedNotificationId);
    }

    const existingTab = tabsModel.tabs.find(
      (tab) =>
        tab.pageKind === "app" &&
        tab.appId === "notification-center" &&
        tab.appInstanceId === "notification-center"
    );

    if (existingTab !== undefined) {
      tabsModel.setActiveTab(existingTab.id);
      return;
    }

    tabsModel.openAppTab(createNotificationCenterAppRequest(t("notification.centerTabTitle")));
  }, [
    closeNotificationCenterTabs,
    notificationModel.notifications.length,
    notificationModel.selectNotification,
    t,
    tabsModel.openAppTab,
    tabsModel.setActiveTab,
    tabsModel.tabs
  ]);

  const attemptNotificationNavigation = useCallback((notification: WorkbenchNotificationItem): boolean => {
    const target = notification.target;
    if (target.kind === "none") {
      return false;
    }

    if (target.kind === "page-tab") {
      tabsModel.openPageInNewTab(target.address, target.title);
      return true;
    }

    if (target.appId === "notification-center") {
      openNotificationCenterTab(notification.id);
      return true;
    }

    const existingTab = tabsModel.tabs.find(
      (tab) =>
        tab.pageKind === "app" &&
        tab.appId === target.appId &&
        tab.appInstanceId === target.appInstanceId
    );
    if (existingTab !== undefined) {
      tabsModel.setActiveTab(existingTab.id);
      return true;
    }

    tabsModel.openAppTab({
      appId: target.appId,
      appInstanceId: target.appInstanceId,
      title: target.title ?? notification.source.title,
      iconKey: target.iconKey ?? resolveNotificationAppIconKey(target.appId),
      ...(target.filePath === undefined ? {} : { filePath: target.filePath }),
      ...(target.fileSessionId === undefined ? {} : { fileSessionId: target.fileSessionId }),
      ...(target.isDirty === undefined ? {} : { isDirty: target.isDirty })
    });

    if (target.appId === "file-manager") {
      fileManagerModel.ensureInstance(target.appInstanceId);
      if (target.filePath !== undefined && target.filePath.trim().length > 0) {
        void fileManagerModel.openDirectory(target.appInstanceId, target.filePath, false);
      } else {
        void fileManagerModel.openHome(target.appInstanceId, false);
      }
    }

    if (
      target.appId === "file-editor" &&
      target.filePath !== undefined &&
      target.filePath.trim().length > 0
    ) {
      fileEditorModel.ensureInstance(target.appInstanceId, {
        filePath: target.filePath,
        ...(target.fileSessionId === undefined ? {} : { fileSessionId: target.fileSessionId })
      });
      void fileEditorModel.openFile(target.appInstanceId, target.filePath);
    }

    return true;
  }, [
    fileEditorModel,
    fileManagerModel,
    openNotificationCenterTab,
    tabsModel
  ]);

  const onOpenNotificationCenter = useCallback((): void => {
    notificationModel.acknowledgeTopbarPreview();
    openNotificationCenterTab();
  }, [notificationModel.acknowledgeTopbarPreview, openNotificationCenterTab]);

  const onOpenNotificationPreview = useCallback((): void => {
    const preview = notificationModel.topbarPreview;
    if (preview === null) {
      openNotificationCenterTab();
      return;
    }

    notificationModel.markNotificationRead(preview.id);
    notificationModel.acknowledgeTopbarPreview();
    const didNavigate = attemptNotificationNavigation(preview);
    if (didNavigate === false) {
      openNotificationCenterTab(preview.id);
    }
  }, [
    attemptNotificationNavigation,
    notificationModel.acknowledgeTopbarPreview,
    notificationModel.markNotificationRead,
    notificationModel.topbarPreview,
    openNotificationCenterTab
  ]);

  const onOpenNotificationSource = useCallback((notificationId: string): void => {
    const notification = notificationModel.getNotification(notificationId);
    if (notification === null) {
      return;
    }
    notificationModel.markNotificationRead(notification.id);
    const didNavigate = attemptNotificationNavigation(notification);
    if (didNavigate === false) {
      openNotificationCenterTab(notification.id);
    }
  }, [
    attemptNotificationNavigation,
    notificationModel.getNotification,
    notificationModel.markNotificationRead,
    openNotificationCenterTab
  ]);

  const onRequestClearNotifications = useCallback((): void => {
    openDialog({
      title: t("notification.centerClearConfirmTitle"),
      description: t("notification.centerClearConfirmDescription"),
      source: {
        title: t("notification.centerTabTitle"),
        subtitle: t("notification.centerTitle"),
        iconLabel: "NTF",
        iconTone: "danger"
      },
      actions: [
        {
          id: "notification-clear-cancel",
          label: t("notification.centerClearConfirmCancel")
        },
        {
          id: "notification-clear-confirm",
          label: t("notification.centerClearConfirmAction"),
          tone: "danger",
          onSelect: notificationModel.clearNotifications
        }
      ]
    });
  }, [notificationModel.clearNotifications, openDialog, t]);

  return {
    onOpenNotificationCenter,
    onOpenNotificationPreview,
    onOpenNotificationSource,
    onRequestClearNotifications
  };
};
