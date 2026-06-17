import { ipcRenderer } from "electron";

import { readPageDragContextFromTarget } from "../shared/page-drag-context";
import {
  PAGE_DRAG_CITATION_MIME,
  PAGE_DRAG_CITATION_PLAIN_PREFIX,
  PAGE_DRAG_CITATION_PLAIN_SUFFIX
} from "../shared/workbench-browser";

const PAGE_DRAG_CITATION_CHANNEL = "lyra:workbench-browser/page-drag-citation";

const encodePlainPayload = (encoded: string): string =>
  `${PAGE_DRAG_CITATION_PLAIN_PREFIX}${encoded}${PAGE_DRAG_CITATION_PLAIN_SUFFIX}`;

const publishPageDragBegin = (target: EventTarget | null, transfer: DataTransfer | null): void => {
  const pageUrl = window.location.href.trim();
  const pageTitle = document.title.trim() || pageUrl;
  const context = readPageDragContextFromTarget(target);
  const payload = {
    pageUrl,
    pageTitle,
    ...context
  };
  const encoded = JSON.stringify(payload);
  if (transfer !== null) {
    try {
      transfer.setData(PAGE_DRAG_CITATION_MIME, encoded);
      transfer.setData("text/plain", encodePlainPayload(encoded));
      transfer.effectAllowed = "copy";
    } catch (_error) {
      // Some pages block custom drag payloads.
    }
  }
  ipcRenderer.send(PAGE_DRAG_CITATION_CHANNEL, {
    phase: "begin",
    payload
  });
};

const handleDragStart = (event: DragEvent): void => {
  publishPageDragBegin(event.target, event.dataTransfer);
};

const installDragCitationBridge = (): void => {
  if (document.documentElement.dataset.lyraPageFrameDragCitation === "1") {
    return;
  }
  document.documentElement.dataset.lyraPageFrameDragCitation = "1";
  document.addEventListener("dragstart", handleDragStart, true);
};

const bootstrap = (): void => {
  installDragCitationBridge();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
window.addEventListener("load", bootstrap);
window.addEventListener("pageshow", bootstrap);