import { resolveFileManagerEntryIconKind } from "../../file-manager/entry-icon-classifier";
import { renderFileManagerEntryIconByKind } from "../../file-manager/icon-registry";
import { measureAiHotzone } from "../hotzone-profile";
import { aiTextLayoutService } from "../text-layout";
import type { AiTaskCardRenderer } from "./types";

const resolvePathFileName = (filePath: string): string => {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? filePath;
};

const resolvePathExtension = (fileName: string): string | undefined => {
  const index = fileName.lastIndexOf(".");
  if (index <= 0 || index >= fileName.length - 1) {
    return undefined;
  }
  return fileName.slice(index + 1).toLowerCase();
};

const TASK_CARD_TEXT_FONT = "500 11px system-ui";
const TASK_CARD_TEXT_LINE_HEIGHT_PX = 14.3;

const shouldShowOverflowTitle = (
  text: string,
  maxWidthPx: number,
  maxLines = 1
): boolean =>
  measureAiHotzone("task-card", () =>
    aiTextLayoutService.isOverflowing({
      text,
      font: TASK_CARD_TEXT_FONT,
      lineHeightPx: TASK_CARD_TEXT_LINE_HEIGHT_PX,
      maxWidthPx,
      maxLines,
      whiteSpace: "normal"
    })
  );

const renderGenericCopyblock: AiTaskCardRenderer = ({
  item,
  isWorking,
  renderScanText
}) => {
  const titleOverflow = shouldShowOverflowTitle(item.title, 160);
  const summaryOverflow = shouldShowOverflowTitle(item.summary, 220);

  return (
    <span className="lyra-ai-task-card-copyblock" title={`${item.title} ${item.summary}`.trim()}>
      <span
        className="lyra-ai-task-card-copyblock-title"
        {...(titleOverflow ? { title: item.title } : {})}
      >
        {item.title}
      </span>
    <span className="lyra-ai-task-card-copyblock-separator" aria-hidden="true">
      ·
    </span>
      <span
        className="lyra-ai-task-card-copyblock-summary"
        {...(summaryOverflow ? { title: item.summary } : {})}
      >
      {isWorking ? renderScanText(item.summary, `${item.id}-summary`) : item.summary}
    </span>
    </span>
  );
};

const renderFileCopyblock: AiTaskCardRenderer = ({
  item,
  isWorking,
  renderScanText
}) => {
  const filePath = item.filePath ?? item.title;
  const fileName = resolvePathFileName(filePath);
  const extension = resolvePathExtension(fileName);
  const iconKind = resolveFileManagerEntryIconKind({
    id: `ai-task-card-file-${item.id}`,
    kind: "file",
    name: fileName,
    path: filePath,
    isHidden: fileName.startsWith("."),
    ...(extension === undefined ? {} : { extension })
  });
  const filePathOverflow = shouldShowOverflowTitle(filePath, 320);

  return (
    <span className="lyra-ai-task-card-fileblock" title={filePath}>
      <span className="lyra-ai-task-card-file-icon" aria-hidden="true">
        {renderFileManagerEntryIconByKind(iconKind, {
          className: "lyra-ai-task-card-file-icon-glyph",
          size: 13
        })}
      </span>
      <span
        className="lyra-ai-task-card-file-path"
        {...(filePathOverflow ? { title: filePath } : {})}
      >
        {isWorking ? renderScanText(filePath, `${item.id}-path`) : filePath}
      </span>
      <span className="lyra-ai-task-card-delta">
        <span className="lyra-ai-task-card-delta-added">
          +{item.metrics?.addedLines ?? 0}
        </span>
        <span className="lyra-ai-task-card-delta-removed">
          -{item.metrics?.removedLines ?? 0}
        </span>
      </span>
    </span>
  );
};

export const getBuiltInTaskCardRenderer = (kind: string): AiTaskCardRenderer => {
  if (kind === "file") {
    return renderFileCopyblock;
  }
  if (kind === "web" || kind === "app") {
    return renderGenericCopyblock;
  }
  return renderGenericCopyblock;
};
