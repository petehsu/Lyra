import { useMemo, type ComponentProps } from "react";

import type { WorkbenchNotificationTopbar } from "../notifications";
import type { WorkbenchUiRuntime } from "../ui-platform";
import type {
  WorkbenchChromeLayoutActions,
  WorkbenchChromeLayoutState,
  WorkbenchChromeSlots,
  WorkbenchShellAdapterProps
} from "./workbench-chrome";
import type {
  WorkbenchActionApi,
  WorkbenchChromeLabels,
  WorkbenchPresentationState
} from "./use-workbench-action-api";
import type { PanelLayoutModel } from "./use-panel-layout";

type UseWorkbenchShellAdapterPropsParams = Pick<
  WorkbenchShellAdapterProps,
  | "rootRef"
  | "rootClassName"
  | "rootStyle"
  | "onRootDragStartCapture"
> & {
  readonly uiRuntime: WorkbenchUiRuntime;
  readonly actions: WorkbenchActionApi;
  readonly labels: WorkbenchChromeLabels;
  readonly presentationState: WorkbenchPresentationState;
  readonly isMac: boolean;
  readonly panelLayoutModel: PanelLayoutModel;
  readonly slots: WorkbenchChromeSlots;
  readonly notificationTopbar: ComponentProps<typeof WorkbenchNotificationTopbar>;
  readonly aiLaunch: WorkbenchShellAdapterProps["aiLaunch"];
};

export const createWorkbenchShellLayoutState = (
  panelLayoutModel: PanelLayoutModel
): WorkbenchChromeLayoutState => ({
  aiPanelSide: panelLayoutModel.aiPanelSide,
  terminalPanelSide: panelLayoutModel.terminalPanelSide,
  isLeftPanelVisible: panelLayoutModel.isLeftPanelVisible,
  isBottomPanelVisible: panelLayoutModel.isBottomPanelVisible
});

export const createWorkbenchShellLayoutActions = (
  panelLayoutModel: PanelLayoutModel
): WorkbenchChromeLayoutActions => ({
  onLeftResizeMouseDown: panelLayoutModel.onLeftResizeMouseDown,
  onBottomResizeMouseDown: panelLayoutModel.onBottomResizeMouseDown
});

export const useWorkbenchShellAdapterProps = ({
  rootRef,
  rootClassName,
  rootStyle,
  uiRuntime,
  actions,
  labels,
  presentationState,
  isMac,
  panelLayoutModel,
  slots,
  notificationTopbar,
  aiLaunch,
  onRootDragStartCapture
}: UseWorkbenchShellAdapterPropsParams): WorkbenchShellAdapterProps =>
  useMemo(
    () => ({
      rootRef,
      rootClassName,
      rootStyle,
      uiRuntime,
      actions,
      labels,
      presentationState,
      isMac,
      layout: createWorkbenchShellLayoutState(panelLayoutModel),
      layoutActions: createWorkbenchShellLayoutActions(panelLayoutModel),
      slots,
      notificationTopbar,
      aiLaunch,
      onRootDragStartCapture
    }),
    [
      actions,
      aiLaunch,
      isMac,
      labels,
      notificationTopbar,
      onRootDragStartCapture,
      panelLayoutModel,
      presentationState,
      rootClassName,
      rootRef,
      rootStyle,
      slots,
      uiRuntime
    ]
  );
