import { useEffect } from "react";

import { attachWorkbenchObservationBridge } from "../observation/service";

type WorkbenchObservationBridgeParams = Parameters<typeof attachWorkbenchObservationBridge>[0];

export const useWorkbenchObservationBridge = ({
  desktopApi,
  tabsModel,
  fileEditorModel,
  fileManagerModel,
  imageViewerModel,
  terminalModel
}: WorkbenchObservationBridgeParams): void => {
  useEffect(() => {
    return attachWorkbenchObservationBridge({
      desktopApi,
      tabsModel,
      fileEditorModel,
      fileManagerModel,
      imageViewerModel,
      terminalModel
    });
  }, [desktopApi, fileEditorModel, fileManagerModel, imageViewerModel, tabsModel, terminalModel]);
};
