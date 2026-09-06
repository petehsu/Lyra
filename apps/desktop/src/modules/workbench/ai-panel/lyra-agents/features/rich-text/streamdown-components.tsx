/**
 * Streamdown component overrides for Lyra.
 *
 * Ports the link click classification, image safety + local path rewriting, and
 * inline code click behavior from the old markdown-it/LyraDocument path to
 * streamdown's `components` prop. These overrides ensure the unified streamdown
 * renderer preserves Lyra's interaction semantics (open links in workbench,
 * classify file paths, rewrite local images, block unsafe image sources).
 */

import { useCallback, type ComponentProps, type MouseEvent } from "react";

import { useData } from "../../data/DataProvider";
import {
  classifyActionTarget,
  imageAttachmentFromDataUrl,
  isFileOpenTarget
} from "./ActionTargets";
import { WebsiteLinkIcon } from "../chat/page-citation-tab-icon";

// ---- Image safety + local path rewrite (ported from @lyra/markdown-render) ----

const isSafeMarkdownImageSrc = (value: string): boolean => {
  const src = value.trim();
  if (src.length === 0 || src.startsWith("//")) {
    return false;
  }
  if (/^data:/iu.test(src)) {
    return /^data:image\/[a-z0-9.+-]+;base64,/iu.test(src);
  }
  const protocolMatch = /^([a-z][a-z0-9+.-]*):/iu.exec(src);
  if (protocolMatch === null) {
    return true;
  }
  return ["http", "https", "file", "lyra-file", "blob"].includes(
    protocolMatch[1]?.toLowerCase() ?? ""
  );
};

const isLocalFilePath = (src: string): boolean =>
  (src.startsWith("/") && !src.startsWith("//")) ||
  /^[A-Za-z]:[\\/]/.test(src) ||
  /^file:\/\//i.test(src);

const rewriteLocalImagePath = (src: string): string => {
  if (!isLocalFilePath(src)) return src;
  let filePath = src;
  if (/^file:\/\//i.test(src)) {
    try {
      filePath = decodeURIComponent(new URL(src).pathname);
    } catch {
      return src;
    }
  }
  return `lyra-file://preview?path=${encodeURIComponent(filePath)}`;
};

// ---- Hook: shared click handler ----

function useRichTextClickHandler(
  rootContains: (el: Element | null) => boolean
) {
  const {
    openUrlInWorkbench,
    openFileInWorkbench,
    revealPathInWorkbench,
    openImageInWorkbench,
    canOpenImageInWorkbench
  } = useData();

  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target === null) return;

      // Image click: open in workbench image viewer
      const image = target.closest("img");
      if (
        image instanceof HTMLImageElement &&
        rootContains(image)
      ) {
        const src = image.getAttribute("src") ?? image.currentSrc;
        const alt = image.getAttribute("alt") ?? null;
        const attachment = imageAttachmentFromDataUrl(src, alt) ?? {
          id: `markdown-image-${src}`,
          mediaType: "image/png",
          data: "",
          label: alt,
          source: src
        };
        if (canOpenImageInWorkbench(attachment)) {
          event.preventDefault();
          void openImageInWorkbench(attachment);
        }
        return;
      }

      // Link click: classify and route
      const anchor = target.closest("a");
      if (anchor instanceof HTMLAnchorElement && rootContains(anchor)) {
        const href = anchor.getAttribute("href") ?? "";
        const classified = classifyActionTarget(href);
        if (classified !== null) {
          event.preventDefault();
          if (classified.kind === "url") {
            void openUrlInWorkbench(classified.value, anchor.textContent ?? classified.label);
          } else if (isFileOpenTarget(classified)) {
            void openFileInWorkbench(classified.value);
          } else {
            void revealPathInWorkbench(classified.value);
          }
        }
        return;
      }

      // Inline code click: classify file paths / URLs
      const code = target.closest("code");
      if (
        code instanceof HTMLElement &&
        rootContains(code) &&
        code.closest("pre") === null
      ) {
        const classified = classifyActionTarget(code.textContent ?? "");
        if (classified === null) return;
        event.preventDefault();
        if (classified.kind === "url") {
          void openUrlInWorkbench(classified.value, classified.label);
        } else if (isFileOpenTarget(classified)) {
          void openFileInWorkbench(classified.value);
        } else {
          void revealPathInWorkbench(classified.value);
        }
      }
    },
    [
      canOpenImageInWorkbench,
      openFileInWorkbench,
      openImageInWorkbench,
      openUrlInWorkbench,
      revealPathInWorkbench,
      rootContains
    ]
  );
}

// ---- Exported hook for the root container ----

export function useLyraRichTextClickHandler(
  rootRef: { current: HTMLElement | null }
) {
  const rootContains = useCallback(
    (el: Element | null) => rootRef.current?.contains(el) === true,
    [rootRef]
  );
  return useRichTextClickHandler(rootContains);
}

// ---- Declarative link component ----

/**
 * Render website links through the same borderless inline-resource contract
 * used by composer and sent-message attachments. This stays declarative: no
 * DOM scan and no secondary React root are needed.
 */
export function LyraLink({
  children,
  className,
  href = "",
  node: _node,
  ...props
}: ComponentProps<"a"> & { readonly node?: unknown }) {
  const target = classifyActionTarget(href);
  const isWebsite = target?.kind === "url" && /^https?:\/\//iu.test(target.value);
  const classes = [
    "lyra-agents-md-link",
    isWebsite ? "lyra-agents-md-url-link" : "",
    isWebsite ? "lyra-agents-inline-resource" : "",
    className
  ].filter(Boolean).join(" ");

  return (
    <a
      {...props}
      className={classes}
      href={href}
      title={isWebsite ? target.value : props.title}
    >
      {isWebsite ? (
        <>
          <WebsiteLinkIcon pageUrl={target.value} />
          <span className="lyra-agents-citation-chip-preview-wrap">
            <span className="lyra-agents-citation-chip-preview">{children}</span>
          </span>
        </>
      ) : children}
    </a>
  );
}

// ---- Exported components map ----

/**
 * Image component: rewrites local file paths to lyra-file:// and blocks
 * unsafe image sources (same logic as the old markdown-it image rule).
 */
export function LyraImage(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const src = props.src ?? "";
  if (!isSafeMarkdownImageSrc(src)) {
    return <span className="lyra-agents-md-blocked-image" />;
  }
  const rewritten = rewriteLocalImagePath(src);
  return (
    <img
      {...props}
      className="lyra-agents-md-image"
      decoding={props.decoding ?? "async"}
      loading={props.loading ?? "lazy"}
      referrerPolicy={props.referrerPolicy ?? "no-referrer"}
      src={rewritten}
    />
  );
}
