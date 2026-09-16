import {
  hasTerminalTabDragPayload,
  readTerminalTabDragPayload
} from "../../../../terminal-dock/drag-transfer";
import type { TerminalDockTab } from "../../../../terminal-dock/types";
import {
  hasWorkspaceTabDragPayload,
  readWorkspaceTabDragPayload
} from "../../../../browser-tabs/workspace-drag-transfer";
import type { WorkspaceTab } from "../../../../workspace-tabs/types";
import {
  hasAttachableFileManagerEntryDragPayload,
  readFileManagerEntryDragPayload
} from "../../../../file-manager/drag-transfer";
import {
  hasPageDragCitationPayload,
  hydrateActivePageDragCitationFromMain,
  readPageDragCitationPayload
} from "../../../../browser-tabs/page-drag-transfer";
import { isPageDragCitationSessionActive } from "../../../../browser-tabs/page-drag-citation-session";
import type { AgentPageCitation } from "../../../../../../shared/agent";
import type { AgentImageAttachment } from "../../core/types";
import {
  buildFileAttachmentFromPath,
  readFileAttachmentsFromDataTransfer
} from "./composer-file";
import type { AgentFileAttachment } from "./composer-file";
import {
  imageAttachmentFromDataUrl,
  readImageAttachmentsFromDataTransfer
} from "./image-drop";
import { imageAttachmentMetadataFromPath } from "./read-image-attachment";
import { isImageViewerSupportedPath } from "../../../../image-viewer";
import {
  hasExternalPageDragPayload,
  readExternalPageDragPayload
} from "./external-page-drag";
import {
  buildPageCitationFromDragPayload,
  buildPageCitationFromExternalDrag
} from "./page-citation";

export type AiPanelDragAttachAction =
  | { readonly kind: "workspace-tab"; readonly tab: WorkspaceTab }
  | { readonly kind: "terminal-tab"; readonly tab: TerminalDockTab }
  | { readonly kind: "page-citation"; readonly citation: AgentPageCitation }
  | { readonly kind: "file"; readonly file: AgentFileAttachment }
  | { readonly kind: "files"; readonly files: readonly AgentFileAttachment[] }
  | { readonly kind: "images"; readonly images: readonly AgentImageAttachment[] };

const hasImageAttachDrag = (dataTransfer: DataTransfer): boolean => {
  const types = Array.from(dataTransfer.types);
  if (types.includes("Files")) {
    return true;
  }
  return types.some((type) => type.startsWith("image/"));
};

export const isAiPanelAttachDrag = (dataTransfer: DataTransfer): boolean => {
  hydrateActivePageDragCitationFromMain();
  return isPageDragCitationSessionActive()
    || hasWorkspaceTabDragPayload(dataTransfer)
    || hasTerminalTabDragPayload(dataTransfer)
    || hasPageDragCitationPayload(dataTransfer)
    || hasExternalPageDragPayload(dataTransfer)
    || hasAttachableFileManagerEntryDragPayload(dataTransfer)
    || hasImageAttachDrag(dataTransfer);
};

export const resolveAiPanelDropEffect = (dataTransfer: DataTransfer): DataTransfer["dropEffect"] => {
  if (
    hasImageAttachDrag(dataTransfer)
    || hasAttachableFileManagerEntryDragPayload(dataTransfer)
    || hasPageDragCitationPayload(dataTransfer)
    || hasExternalPageDragPayload(dataTransfer)
  ) {
    return "copy";
  }
  if (hasWorkspaceTabDragPayload(dataTransfer) || hasTerminalTabDragPayload(dataTransfer)) {
    return "move";
  }
  return "copy";
};

const resolveFileManagerDragAttachAction = (
  dataTransfer: DataTransfer
): AiPanelDragAttachAction | null => {
  const payload = readFileManagerEntryDragPayload(dataTransfer);
  if (payload === null) {
    return null;
  }

  const path = payload.path?.trim();
  if (path === undefined || path.length === 0) {
    return null;
  }

  if (isImageViewerSupportedPath(path)) {
    return {
      kind: "images",
      images: [imageAttachmentMetadataFromPath(path, { label: payload.name || undefined })]
    };
  }

  const file = buildFileAttachmentFromPath(path);
  if (file === null) {
    return null;
  }

  return { kind: "file", file };
};

const isImagePageDrag = (payload: {
  readonly selectionText?: string;
  readonly mediaType?: string;
  readonly srcUrl?: string;
}): boolean => {
  if ((payload.selectionText?.trim().length ?? 0) > 0) {
    return false;
  }
  if (payload.mediaType === "image") {
    return true;
  }
  const srcUrl = payload.srcUrl?.trim() ?? "";
  return srcUrl.startsWith("data:image/")
    || /\.(?:png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)(?:$|[?#])/iu.test(srcUrl);
};

const resolveImageAttachFromPageDrag = async (
  dataTransfer: DataTransfer,
  srcUrl: string | undefined
): Promise<AiPanelDragAttachAction | null> => {
  const fromTransfer = await readImageAttachmentsFromDataTransfer(dataTransfer);
  if (fromTransfer.length > 0) {
    return { kind: "images", images: fromTransfer };
  }
  const fromDataUrl = srcUrl === undefined ? null : imageAttachmentFromDataUrl(srcUrl);
  if (fromDataUrl === null) {
    return null;
  }
  return { kind: "images", images: [fromDataUrl] };
};

export const resolveAiPanelDragAttachAction = async (
  dataTransfer: DataTransfer,
  workspaceTabs: readonly WorkspaceTab[],
  terminalTabs: readonly TerminalDockTab[]
): Promise<AiPanelDragAttachAction | null> => {
  hydrateActivePageDragCitationFromMain();
  const pageDragPayload = readPageDragCitationPayload(dataTransfer);
  if (pageDragPayload !== null) {
    if (isImagePageDrag(pageDragPayload)) {
      const imageAction = await resolveImageAttachFromPageDrag(
        dataTransfer,
        pageDragPayload.srcUrl
      );
      if (imageAction !== null) {
        return imageAction;
      }
    }
    const tab = workspaceTabs.find((entry) => entry.id === pageDragPayload.tabId);
    const tabTitle = tab?.title.trim() || pageDragPayload.pageTitle;
    return {
      kind: "page-citation",
      citation: buildPageCitationFromDragPayload(pageDragPayload, tabTitle, tab)
    };
  }

  const workspacePayload = readWorkspaceTabDragPayload(dataTransfer);
  if (workspacePayload !== null) {
    const tab = workspaceTabs.find((entry) => entry.id === workspacePayload.tabId);
    if (tab !== undefined) {
      return { kind: "workspace-tab", tab };
    }
  }

  const terminalPayload = readTerminalTabDragPayload(dataTransfer);
  if (terminalPayload !== null) {
    const tab = terminalTabs.find((entry) => entry.id === terminalPayload.tabId);
    if (tab !== undefined) {
      return { kind: "terminal-tab", tab };
    }
  }

  const fileManagerAction = resolveFileManagerDragAttachAction(dataTransfer);
  if (fileManagerAction !== null) {
    return fileManagerAction;
  }

  const externalPagePayload = readExternalPageDragPayload(dataTransfer);
  if (externalPagePayload !== null) {
    if (isImagePageDrag(externalPagePayload)) {
      const imageAction = await resolveImageAttachFromPageDrag(
        dataTransfer,
        externalPagePayload.srcUrl
      );
      if (imageAction !== null) {
        return imageAction;
      }
    }
    return {
      kind: "page-citation",
      citation: buildPageCitationFromExternalDrag(externalPagePayload)
    };
  }

  const externalFiles = readFileAttachmentsFromDataTransfer(dataTransfer);
  if (externalFiles.length === 1) {
    return { kind: "file", file: externalFiles[0]! };
  }
  if (externalFiles.length > 1) {
    return { kind: "files", files: externalFiles };
  }

  const images = await readImageAttachmentsFromDataTransfer(dataTransfer);
  if (images.length > 0) {
    return { kind: "images", images };
  }

  return null;
};
