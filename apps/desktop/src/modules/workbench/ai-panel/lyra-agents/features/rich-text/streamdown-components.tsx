/**
 * Streamdown component overrides for Lyra.
 *
 * Ports the link click classification, image safety + local path rewriting, and
 * inline code click behavior from the old markdown-it/LyraDocument path to
 * streamdown's `components` prop. These overrides ensure the unified streamdown
 * renderer preserves Lyra's interaction semantics (open links in workbench,
 * classify file paths, rewrite local images, block unsafe image sources).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent } from "react";

import { useData } from "../../data/DataProvider";
import {
  classifyActionTarget,
  imageAttachmentFromDataUrl,
  isFileOpenTarget
} from "./ActionTargets";
import { knownFaviconUrlForUrl } from "../chat/web-link";
import { mountWebsiteLinkIcon } from "../chat/page-citation-tab-icon";

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

// ---- Favicon decoration (ported from LyraDocument.tsx) ----
//
// Streamdown renders plain `<a>` tags without the `lyra-agents-md-link` class
// the old markdown-it path added. We decorate HTTP/HTTPS links the same way —
// wrap the label, add a favicon icon host, and add both classes so the
// existing `.lyra-agents-md-link.lyra-agents-md-url-link` CSS still applies.

interface DecoratedLink {
  readonly anchor: HTMLAnchorElement;
  readonly iconHost: HTMLElement;
  readonly label: HTMLElement;
  readonly originalTitle: string | null;
  readonly unmountIcon: () => void;
  readonly url: string;
}

/**
 * Decorates HTTP/HTTPS links rendered by streamdown with a favicon chip.
 * Run as a layout effect after streamdown has rendered, and re-run when the
 * rendered text changes. A separate effect keyed on `workspaceTabs` re-resolves
 * favicons for already-decorated links (so a newly-loaded tab's favicon
 * replaces a stale/empty one) without re-running the full decoration pass.
 */
export function useLyraRichTextFaviconDecoration(
  rootRef: { current: HTMLElement | null },
  streaming: boolean,
  renderedText: string
) {
  const { aiRichRenderingEnabled, workspaceTabs } = useData();
  const decoratedLinksRef = useRef<DecoratedLink[]>([]);
  const workspaceTabsRef = useRef(workspaceTabs);
  workspaceTabsRef.current = workspaceTabs;

  useLayoutEffect(() => {
    if (!aiRichRenderingEnabled || streaming) return;
    const root = rootRef.current;
    if (root === null) return;

    // Streamdown anchors are plain `<a>`; match any anchor with an http(s) href.
    const decorated = [...root.querySelectorAll<HTMLAnchorElement>("a[href]")]
      .flatMap((anchor): DecoratedLink[] => {
        const target = classifyActionTarget(anchor.getAttribute("href") ?? "");
        if (target?.kind !== "url") return [];
        let url: URL;
        try {
          url = new URL(target.value);
        } catch {
          return [];
        }
        if (url.protocol !== "http:" && url.protocol !== "https:") return [];

        const originalTitle = anchor.getAttribute("title");
        const iconHost = document.createElement("span");
        iconHost.className = "lyra-agents-md-url-link-icon-host";
        const label = document.createElement("span");
        label.className = "lyra-agents-md-url-link-label";
        label.append(...anchor.childNodes);
        anchor.append(iconHost, label);
        // Add both classes so the existing `.lyra-agents-md-link.lyra-agents-md-url-link`
        // CSS rule (which requires both classes) continues to style the chip.
        anchor.classList.add("lyra-agents-md-link", "lyra-agents-md-url-link");
        anchor.title = url.href;
        const unmountIcon = mountWebsiteLinkIcon(
          iconHost,
          knownFaviconUrlForUrl(url.href, workspaceTabsRef.current),
          12,
          "lyra-agents-md-url-link-icon",
          url.href
        );
        return [{
          anchor,
          iconHost,
          label,
          originalTitle,
          unmountIcon,
          url: url.href
        }];
      });
    decoratedLinksRef.current = decorated;

    return () => {
      if (decoratedLinksRef.current === decorated) {
        decoratedLinksRef.current = [];
      }
      for (const { anchor, iconHost, label, originalTitle, unmountIcon } of decorated) {
        queueMicrotask(unmountIcon);
        if (anchor.contains(iconHost) && anchor.contains(label)) {
          anchor.replaceChildren(...label.childNodes);
          anchor.classList.remove("lyra-agents-md-link", "lyra-agents-md-url-link");
          if (originalTitle === null) {
            anchor.removeAttribute("title");
          } else {
            anchor.title = originalTitle;
          }
        }
      }
    };
  }, [aiRichRenderingEnabled, renderedText, rootRef, streaming]);

  useEffect(() => {
    for (const { iconHost, url } of decoratedLinksRef.current) {
      const faviconUrl = knownFaviconUrlForUrl(url, workspaceTabs);
      if (faviconUrl !== null) {
        mountWebsiteLinkIcon(
          iconHost,
          faviconUrl,
          12,
          "lyra-agents-md-url-link-icon",
          url
        );
      }
    }
  }, [workspaceTabs]);
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
  return <img {...props} src={rewritten} className="lyra-agents-md-image" />;
}