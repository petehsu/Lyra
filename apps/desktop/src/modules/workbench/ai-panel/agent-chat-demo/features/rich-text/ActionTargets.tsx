import type { ReactNode } from "react";

import type { AgentImageAttachment } from "../../core/types";
import { useData } from "../../data/DataProvider";

export type ActionTarget =
  | {
      readonly kind: "url";
      readonly label: string;
      readonly value: string;
    }
  | {
      readonly kind: "file";
      readonly label: string;
      readonly value: string;
    };

type TextSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "target"; readonly target: ActionTarget };

const URL_PATTERN = "(?:https?:\\/\\/|www\\.|localhost(?::\\d+)?(?:\\/|(?=[\\s),.;!?，。；！？]|$)))[^\\s<>\"'`]*";
const FILE_URL_PATTERN = "file:\\/\\/[^\\s<>\"'`]+";
const ABSOLUTE_PATH_PATTERN = "\\/(?:Users|Volumes|tmp|var|private|opt|etc|home|Applications)\\/[^\\s<>\"'`]+";
const PROJECT_PATH_PATTERN = "(?:(?:\\.{1,2}\\/)|(?:apps|crates|web|scripts|packages|vendor|docs|target|参考)\\/)[^\\s<>\"'`]+";
const BARE_FILE_PATTERN = "(?:README\\.md|Cargo\\.toml|package\\.json|pnpm-lock\\.yaml|tsconfig\\.json|vite\\.config\\.[cm]?[jt]s|[A-Za-z0-9_.-]+\\.(?:ts|tsx|js|jsx|json|rs|md|mdx|css|scss|html|png|jpe?g|gif|webp|svg|avif|heic|toml|yaml|yml|lock))(?:[:#][^\\s<>\"'`]+)?";

const ACTION_TOKEN_PATTERN = new RegExp(
  [URL_PATTERN, FILE_URL_PATTERN, ABSOLUTE_PATH_PATTERN, PROJECT_PATH_PATTERN, BARE_FILE_PATTERN].join("|"),
  "giu"
);

const IMAGE_DATA_URL_PATTERN = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/iu;
const IMAGE_EXTENSION_PATTERN = /\.(?:png|jpe?g|gif|webp|bmp|ico|tiff?|svg|avif|heic|heif|jxl|exr|hdr|dpx|dds|tga|psd|psb|fits?|dcm|dicom|cr2|nef|arw|dng|orf|raf|rw2)(?=$|[:#?])/iu;
const CONFIG_BASENAME_PATTERN = /^(?:README\.md|Cargo\.toml|package\.json|pnpm-lock\.yaml|tsconfig\.json|vite\.config\.[cm]?[jt]s)$/iu;
const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9]{1,12}(?=$|[:#?])/u;

const stripOuterPunctuation = (value: string): string => {
  let result = value.trim();
  while (/^[([{"'“‘]/u.test(result)) {
    result = result.slice(1);
  }
  while (/[)\].,;:!?，。；：！？、"'”’}]$/u.test(result)) {
    result = result.slice(0, -1);
  }
  return result;
};

const normalizeUrl = (value: string): string => {
  if (/^www\./iu.test(value)) {
    return `https://${value}`;
  }
  if (/^localhost(?::\d+)?(?:\/|$)/iu.test(value)) {
    return `http://${value}`;
  }
  return value;
};

const pathWithoutLocation = (value: string): string =>
  value
    .replace(/#L\d+(?:-L\d+)?$/iu, "")
    .replace(/:\d+(?::\d+)?$/u, "");

export const isLocalFileReference = (value: string): boolean => {
  const candidate = stripOuterPunctuation(value);
  if (candidate.length === 0) {
    return false;
  }
  if (/^https?:\/\//iu.test(candidate) || /^www\./iu.test(candidate)) {
    return false;
  }
  if (/^file:\/\//iu.test(candidate)) {
    return true;
  }
  if (/^(?:\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/])/u.test(candidate)) {
    return true;
  }
  if (/^(?:apps|crates|web|scripts|packages|vendor|docs|target|参考)\//u.test(candidate)) {
    return true;
  }
  const withoutLocation = pathWithoutLocation(candidate);
  if (CONFIG_BASENAME_PATTERN.test(withoutLocation)) {
    return true;
  }
  return withoutLocation.includes("/") && FILE_EXTENSION_PATTERN.test(withoutLocation);
};

export const classifyActionTarget = (value: string): ActionTarget | null => {
  const label = stripOuterPunctuation(value);
  if (label.length === 0) {
    return null;
  }
  if (/^(?:https?:\/\/|www\.|localhost(?::\d+)?(?:\/|$))/iu.test(label)) {
    return {
      kind: "url",
      label,
      value: normalizeUrl(label)
    };
  }
  if (isLocalFileReference(label)) {
    return {
      kind: "file",
      label,
      value: label
    };
  }
  return null;
};

export const isImageFileReference = (value: string): boolean => {
  const target = classifyActionTarget(value);
  return target?.kind === "file" && IMAGE_EXTENSION_PATTERN.test(pathWithoutLocation(target.value));
};

export const imageAttachmentFromDataUrl = (
  src: string,
  label?: string | null
): AgentImageAttachment | null => {
  const match = IMAGE_DATA_URL_PATTERN.exec(src.trim());
  if (match === null) {
    return null;
  }
  const data = (match[2] ?? "").trim();
  if (data.length === 0) {
    return null;
  }
  return {
    id: `inline-image-${Date.now().toString(36)}`,
    mediaType: match[1] ?? "image/png",
    data,
    label: label ?? null,
    source: "inline-data-url"
  };
};

const imageAttachmentFromActionTarget = (
  target: ActionTarget | null,
  label?: string | null
): AgentImageAttachment | null => {
  if (target === null) {
    return null;
  }
  if (target.kind === "file" && !IMAGE_EXTENSION_PATTERN.test(pathWithoutLocation(target.value))) {
    return null;
  }
  return {
    id: `image-source-${target.value}`,
    mediaType: "image/png",
    data: "",
    label: label ?? target.label,
    source: target.value
  };
};

export const imagePreviewSource = (image: AgentImageAttachment): string | undefined => {
  const mediaType = image.mediaType.trim().toLowerCase();
  if (mediaType.startsWith("image/") && image.data.trim().length > 0) {
    return `data:${image.mediaType};base64,${image.data}`;
  }
  const source = image.source?.trim() ?? "";
  if (/^www\./iu.test(source)) {
    return `https://${source}`;
  }
  if (/^localhost(?::\d+)?(?:\/|$)/iu.test(source)) {
    return `http://${source}`;
  }
  if (/^(?:https?:\/\/|file:\/\/)/iu.test(source)) {
    return source;
  }
  return undefined;
};

export const splitActionText = (text: string): readonly TextSegment[] => {
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(ACTION_TOKEN_PATTERN)) {
    const raw = match[0] ?? "";
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, index) });
    }
    const target = classifyActionTarget(raw);
    if (target === null) {
      segments.push({ kind: "text", text: raw });
    } else {
      segments.push({ kind: "target", target });
    }
    lastIndex = index + raw.length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return segments;
};

export function ActionText({ text }: { readonly text: string }) {
  const { openUrlInWorkbench, openFileInWorkbench } = useData();
  const segments = splitActionText(text);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          return <span key={index}>{segment.text}</span>;
        }
        const { target } = segment;
        const open = () => {
          if (target.kind === "url") {
            void openUrlInWorkbench(target.value, target.label).catch(() => undefined);
          } else {
            void openFileInWorkbench(target.value).catch(() => undefined);
          }
        };
        return (
          <button
            key={index}
            type="button"
            className={`action-text-link action-text-link-${target.kind}`}
            title={target.value}
            onClick={open}
          >
            {target.label}
          </button>
        );
      })}
    </>
  );
}

export function ActionTargetButton({
  target,
  className,
  children
}: {
  readonly target: ActionTarget;
  readonly className?: string | undefined;
  readonly children?: ReactNode;
}) {
  const { openUrlInWorkbench, openFileInWorkbench } = useData();
  const open = () => {
    if (target.kind === "url") {
      void openUrlInWorkbench(target.value, target.label).catch(() => undefined);
    } else {
      void openFileInWorkbench(target.value).catch(() => undefined);
    }
  };
  return (
    <button
      type="button"
      className={className ?? `action-text-link action-text-link-${target.kind}`}
      title={target.value}
      onClick={open}
    >
      {children ?? target.label}
    </button>
  );
}

export function ClickableImage({
  src,
  alt,
  image,
  className
}: {
  readonly src: string | undefined;
  readonly alt?: string | null | undefined;
  readonly image?: AgentImageAttachment | null | undefined;
  readonly className?: string | undefined;
}) {
  const {
    openUrlInWorkbench,
    openFileInWorkbench,
    openImageInWorkbench,
    canOpenImageInWorkbench
  } = useData();
  const dataImage = src === undefined ? null : imageAttachmentFromDataUrl(src, alt ?? null);
  const target = src === undefined ? null : classifyActionTarget(src);
  const targetImage = imageAttachmentFromActionTarget(target, alt ?? null);
  const imageToOpen = image ?? dataImage ?? targetImage;
  const canOpenImage = imageToOpen !== null && canOpenImageInWorkbench(imageToOpen);
  const canOpenTarget = imageToOpen === null && target !== null;
  const canOpen = canOpenImage || canOpenTarget;

  const open = () => {
    if (canOpenImage && imageToOpen !== null) {
      void openImageInWorkbench(imageToOpen).catch(() => undefined);
      return;
    }
    if (target?.kind === "url") {
      void openUrlInWorkbench(target.value, target.label).catch(() => undefined);
      return;
    }
    if (target?.kind === "file") {
      void openFileInWorkbench(target.value).catch(() => undefined);
    }
  };

  if (src === undefined) {
    if (!canOpenImage || imageToOpen === null) {
      return null;
    }
    return (
      <button
        type="button"
        className={["action-image-button", "action-image-placeholder", className]
          .filter(Boolean)
          .join(" ")}
        title="Open image in Workbench"
        onClick={open}
      >
        <span className="action-image-placeholder-label">{alt ?? "Image attachment"}</span>
      </button>
    );
  }

  if (!canOpen) {
    if (className === undefined) {
      return <img src={src} alt={alt ?? ""} />;
    }
    return (
      <span className={className}>
        <img src={src} alt={alt ?? ""} />
      </span>
    );
  }

  return (
    <button
      type="button"
      className={["action-image-button", className].filter(Boolean).join(" ")}
      title="Open image in Workbench"
      onClick={open}
    >
      <img src={src} alt={alt ?? ""} />
      <span className="action-image-overlay">Open in Workbench</span>
    </button>
  );
}
