import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent
} from "react";

import type { AgentImageAttachment } from "../../core/types";
import { useOptionalData } from "../../data/DataProvider";
import { t } from "@workbench/i18n";
import {
  AdaptiveImageLayers,
  imagePreviewSource,
  imagePreviewSourceFromSource
} from "../rich-text/ActionTargets";
import {
  applyImageSizes,
  aspectKindFromSize,
  figureCopy,
  groupMediaCardRuns,
  mediaCardColumnCount,
  SMALL_IMAGE_MAX_INTRINSIC_WIDTH,
  resolveMediaLayout,
  type MediaImage,
  type MediaToken,
  type ResolvedMediaSegment
} from "./layout";

const ASPECT_CLASS: Record<string, string> = {
  ultraWide: "is-ultra-wide",
  landscape: "is-landscape",
  squareLike: "is-square",
  portrait: "is-portrait",
  ultraTall: "is-ultra-tall"
};

export const displaySrcForMediaImage = (image: MediaImage): string | undefined => {
  if (image.attachment !== undefined) {
    return imagePreviewSource(image.attachment) ?? imagePreviewSourceFromSource(image.src);
  }
  return imagePreviewSourceFromSource(image.src) ?? (image.src.length === 0 ? undefined : image.src);
};

export const mediaImageFromAttachment = (image: AgentImageAttachment): MediaImage => {
  const src = imagePreviewSource(image) ?? image.source?.trim() ?? "";
  const width = image.width ?? undefined;
  const height = image.height ?? undefined;
  return {
    id: image.id,
    src,
    attachment: image,
    ...(image.label !== undefined && image.label !== null && image.label.length > 0
      ? { alt: image.label }
      : {}),
    ...(width !== undefined && width > 0 ? { intrinsicWidth: width } : {}),
    ...(height !== undefined && height > 0 ? { intrinsicHeight: height } : {})
  };
};

const attachmentsInGroup = (group: readonly MediaImage[]): AgentImageAttachment[] => {
  const attachments: AgentImageAttachment[] = [];
  for (const item of group) {
    if (item.attachment !== undefined) {
      attachments.push(item.attachment);
    }
  }
  return attachments;
};

export function AdaptiveImage({
  image,
  group,
  index = 0,
  className,
  presentation = "natural",
  onDimensions
}: {
  readonly image: MediaImage;
  readonly group?: readonly MediaImage[];
  readonly index?: number;
  readonly className?: string;
  readonly presentation?: "frame" | "natural";
  readonly onDimensions?: (id: string, width: number, height: number) => void;
}) {
  const data = useOptionalData();
  const [loadedSize, setLoadedSize] = useState<{ width: number; height: number } | null>(null);
  const displaySrc = displaySrcForMediaImage(image);
  const width = loadedSize?.width ?? image.intrinsicWidth;
  const height = loadedSize?.height ?? image.intrinsicHeight;
  const kind = aspectKindFromSize(width, height);
  const viewerGroup = group ?? [image];
  const attachment = image.attachment;
  const canOpen = attachment !== undefined
    && data !== null
    && data.canOpenImageInWorkbench(attachment);
  const pending = width === undefined || height === undefined;
  const framed = presentation === "frame";
  const small = width !== undefined && width > 0 && width < SMALL_IMAGE_MAX_INTRINSIC_WIDTH;
  const classes = [
    "lyra-agents-action-image-button",
    "lyra-agents-adaptive-image",
    framed ? "is-frame" : "is-natural",
    pending ? "is-pending" : "",
    small ? "is-small" : "",
    kind === null ? "" : (ASPECT_CLASS[kind] ?? ""),
    className
  ].filter((value): value is string => typeof value === "string" && value.length > 0).join(" ");

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const node = event.currentTarget;
    if (node.naturalWidth <= 0 || node.naturalHeight <= 0) {
      return;
    }
    setLoadedSize((current) => {
      if (current?.width === node.naturalWidth && current.height === node.naturalHeight) {
        return current;
      }
      return { width: node.naturalWidth, height: node.naturalHeight };
    });
    onDimensions?.(image.id, node.naturalWidth, node.naturalHeight);
  };

  const open = () => {
    if (data === null || attachment === undefined || !canOpen) {
      return;
    }
    const groupAttachments = attachmentsInGroup(viewerGroup);
    void (groupAttachments.length > 1
      ? data.openImageInWorkbench(attachment, { group: groupAttachments, index })
      : data.openImageInWorkbench(attachment)
    ).catch(() => undefined);
  };

  const imageNode = displaySrc === undefined
    ? (
        <span className="lyra-agents-action-image-placeholder-label">
          {image.alt ?? t("tool.imageAttachment")}
        </span>
      )
    : (
        <AdaptiveImageLayers
          src={displaySrc}
          alt={image.alt ?? ""}
          framed={framed}
          onLoad={handleLoad}
        />
      );

  if (!canOpen) {
    if (displaySrc === undefined) {
      return null;
    }
    return (
      <span className={classes}>
        {imageNode}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`${classes}${displaySrc === undefined ? " lyra-agents-action-image-placeholder" : ""}`}
      title={t("tool.openImageInWorkbench")}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        open();
      }}
    >
      {imageNode}
    </button>
  );
}

export function SideFlow({
  text,
  image,
  order,
  group,
  index = 0,
  presentation = "natural",
  wrap = false,
  columnPair = false,
  renderText,
  onDimensions
}: {
  readonly text: string;
  readonly image: MediaImage;
  readonly order: "text-image" | "image-text";
  readonly group?: readonly MediaImage[];
  readonly index?: number;
  readonly presentation?: "frame" | "natural";
  readonly wrap?: boolean;
  readonly columnPair?: boolean;
  readonly renderText: (text: string) => ReactNode;
  readonly onDimensions?: (id: string, width: number, height: number) => void;
}) {
  const kind = aspectKindFromSize(image.intrinsicWidth, image.intrinsicHeight);
  const banner = presentation === "natural" && kind === "ultraWide";
  const textNode = (
    <div className="lyra-agents-side-flow-text">{renderText(text)}</div>
  );
  const mediaNode = (
    <div className="lyra-agents-side-flow-media">
      <AdaptiveImage
        image={image}
        group={group ?? [image]}
        index={index}
        presentation={presentation}
        {...(onDimensions === undefined ? {} : { onDimensions })}
      />
    </div>
  );
  return (
    <div className={[
      "lyra-agents-side-flow",
      `lyra-agents-side-flow-${order}`,
      presentation === "natural" ? "is-natural" : "",
      banner ? "is-banner" : "",
      wrap ? "is-wrap" : "",
      columnPair ? "is-column-pair" : ""
    ].filter((value) => value.length > 0).join(" ")}>
      {order === "text-image" ? <>{textNode}{mediaNode}</> : <>{mediaNode}{textNode}</>}
    </div>
  );
}

export function MediaStack({
  images,
  onDimensions
}: {
  readonly images: readonly MediaImage[];
  readonly onDimensions?: (id: string, width: number, height: number) => void;
}) {
  const data = useOptionalData();
  const layers = images.slice(0, 3);
  const front = images[0];
  const canOpen = front?.attachment !== undefined
    && data !== null
    && data.canOpenImageInWorkbench(front.attachment);

  const open = () => {
    if (data === null || front?.attachment === undefined || !canOpen) {
      return;
    }
    const groupAttachments = attachmentsInGroup(images);
    void (groupAttachments.length > 0
      ? data.openImageInWorkbench(front.attachment, { group: groupAttachments, index: 0 })
      : data.openImageInWorkbench(front.attachment)
    ).catch(() => undefined);
  };

  return (
    <button
      type="button"
      className="lyra-agents-action-image-button lyra-agents-media-stack"
      title={t("tool.openImageInWorkbench")}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        open();
      }}
    >
      {[...layers].reverse().map((image, reverseIndex) => {
        const depth = layers.length - 1 - reverseIndex;
        const src = displaySrcForMediaImage(image);
        return (
          <span
            key={image.id}
            className={`lyra-agents-media-stack-layer lyra-agents-media-stack-layer-${depth}`}
          >
            {src === undefined ? null : (
              <img
                src={src}
                alt=""
                decoding="async"
                loading="lazy"
                referrerPolicy="no-referrer"
                onLoad={(event) => {
                  const node = event.currentTarget;
                  onDimensions?.(image.id, node.naturalWidth, node.naturalHeight);
                }}
              />
            )}
          </span>
        );
      })}
      <span className="lyra-agents-media-stack-count">{images.length}</span>
    </button>
  );
}

const renderSegment = (
  segment: ResolvedMediaSegment,
  renderText: (segment: Extract<ResolvedMediaSegment, { type: "text" } | { type: "side-flow" }>) => ReactNode,
  onDimensions: (id: string, width: number, height: number) => void,
  presentation: "frame" | "natural"
): ReactNode => {
  switch (segment.type) {
    case "text":
      return (
        <div key={segment.id} className="lyra-agents-media-text">
          {renderText(segment)}
        </div>
      );
    case "single":
      return (
        <figure key={segment.id} className="lyra-agents-message-image lyra-agents-message-image-agent">
          <AdaptiveImage
            image={segment.image}
            group={segment.group}
            index={segment.index}
            presentation={presentation}
            onDimensions={onDimensions}
          />
          {segment.image.alt !== undefined && segment.image.alt.length > 0 ? (
            <figcaption>{segment.image.alt}</figcaption>
          ) : null}
        </figure>
      );
    case "side-flow": {
      const copy = figureCopy(segment);
      return (
        <SideFlow
          key={segment.id}
          text={copy}
          image={segment.image}
          order={segment.order}
          group={segment.group}
          presentation={presentation}
          wrap={segment.wrap}
          columnPair={segment.columnPair}
          renderText={() => renderText({ ...segment, text: copy })}
          onDimensions={onDimensions}
        />
      );
    }
    case "stack":
      return (
        <MediaStack
          key={segment.id}
          images={segment.images}
          onDimensions={onDimensions}
        />
      );
    default:
      return null;
  }
};

function MediaCards({
  count,
  children
}: {
  readonly count: number;
  readonly children: ReactNode;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (node === null) {
      return;
    }
    const apply = () => {
      const cols = mediaCardColumnCount(node.clientWidth, count);
      const template = `repeat(${cols}, minmax(0, var(--lyra-agents-image-slot-max)))`;
      if (node.style.gridTemplateColumns === template) {
        return;
      }
      node.style.gridTemplateColumns = template;
    };
    apply();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, [count]);

  return (
    <div ref={nodeRef} className="lyra-agents-media-cards">
      {children}
    </div>
  );
}

export function ChatMediaLayout({
  tokens,
  renderText
}: {
  readonly tokens: readonly MediaToken[];
  readonly renderText: (
    segment: Extract<ResolvedMediaSegment, { type: "text" } | { type: "side-flow" }>
  ) => ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(720);
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({});
  const sizedTokens = useMemo(() => applyImageSizes(tokens, sizes), [sizes, tokens]);
  const segments = useMemo(
    () => resolveMediaLayout(sizedTokens, { containerWidth }),
    [sizedTokens, containerWidth]
  );
  const runs = useMemo(() => groupMediaCardRuns(segments), [segments]);
  const onDimensions = useCallback((id: string, width: number, height: number) => {
    setSizes((current) => {
      const existing = current[id];
      if (existing?.width === width && existing.height === height) {
        return current;
      }
      return {
        ...current,
        [id]: { width, height }
      };
    });
  }, []);

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (node === null) {
      return;
    }
    const apply = () => {
      const width = node.clientWidth;
      if (width > 0) {
        setContainerWidth(width);
      }
    };
    apply();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="lyra-agents-media-layout">
      {runs.map((run) => {
        if (run.type === "cards") {
          return (
            <MediaCards key={run.id} count={run.segments.length}>
              {run.segments.map((segment) => renderSegment(segment, renderText, onDimensions, "frame"))}
            </MediaCards>
          );
        }
        if (run.type === "figure-row") {
          const group = run.segments.map((segment) => segment.image);
          return (
            <div
              key={run.id}
              className={`lyra-agents-figure-row ${run.segments.length === 1 ? "is-single" : "is-multi"}`}
            >
              {run.segments.map((segment, index) => {
                if (segment.type !== "side-flow") {
                  return renderSegment(
                    { ...segment, group, index },
                    renderText,
                    onDimensions,
                    "natural"
                  );
                }
                const copy = figureCopy(segment);
                return (
                  <SideFlow
                    key={segment.id}
                    text={copy}
                    image={segment.image}
                    order={run.segments.length > 1 ? "text-image" : segment.order}
                    group={group}
                    index={index}
                    presentation="natural"
                    wrap={false}
                    columnPair={run.segments.length === 1 && segment.columnPair}
                    renderText={() => renderText({ ...segment, text: copy })}
                    onDimensions={onDimensions}
                  />
                );
              })}
            </div>
          );
        }
        return renderSegment(run.segment, renderText, onDimensions, "natural");
      })}
    </div>
  );
}
