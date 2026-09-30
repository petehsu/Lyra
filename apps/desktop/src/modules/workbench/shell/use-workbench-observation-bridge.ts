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
  activateEmbeddedBrowserTab,
  closeEmbeddedBrowserTab
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
      ...(activateEmbeddedBrowserTab === undefined ? {} : { activateEmbeddedBrowserTab }),
      ...(closeEmbeddedBrowserTab === undefined ? {} : { closeEmbeddedBrowserTab })
    });
  }, [
    activateEmbeddedBrowserTab,
    closeEmbeddedBrowserTab,
    desktopApi,
    embeddedBrowserPages,
    fileEditorModel,
    fileManagerModel,
    imageViewerModel,
    tabsModel,
    terminalModel
  ]);
};
