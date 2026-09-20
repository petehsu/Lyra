import { useEffect } from "react";

import { attachWorkbenchObservationBridge } from "../observation/service";

type WorkbenchObservationBridgeParams = Parameters<typeof attachWorkbenchObservationBridge>[0];

export const useWorkbenchObservationBridge = ({
  desktopApi,
  tabsModel,
  fileEditorModel,
  fileManagerModel,
  imageViewerModel,
  terminalModel,
  embeddedBrowserPages,
  activateEmbeddedBrowserTab
}: WorkbenchObservationBridgeParams): void => {
  useEffect(() => {
    return attachWorkbenchObservationBridge({
      desktopApi,
      tabsModel,
      fileEditorModel,
      fileManagerModel,
      imageViewerModel,
      terminalModel,
      ...(embeddedBrowserPages === undefined ? {} : { embeddedBrowserPages }),
      ...(activateEmbeddedBrowserTab === undefined ? {} : { activateEmbeddedBrowserTab })
    });
  }, [
    activateEmbeddedBrowserTab,
    desktopApi,
    embeddedBrowserPages,
    fileEditorModel,
    fileManagerModel,
    imageViewerModel,
    tabsModel,
    terminalModel
  ]);
};
