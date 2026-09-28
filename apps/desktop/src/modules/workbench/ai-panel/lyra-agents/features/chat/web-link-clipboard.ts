import { useEffect } from "react";

const linkSelector = ".lyra-agents-citation-chip[data-link-url], .lyra-agents-inline-resource[data-web-link-url]";

/** Expand selected visual tokens only; never put shortened labels on the clipboard. */
export const selectedWebLinkText = (selection: Selection | null): string | null => {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
  const fragment = selection.getRangeAt(0).cloneContents();
  const links = fragment.querySelectorAll<HTMLElement>(linkSelector);
  // A range wholly inside a link has no enclosing element in cloneContents().
  const ancestor = selection.getRangeAt(0).commonAncestorContainer;
  const enclosing = (ancestor instanceof Element ? ancestor : ancestor.parentElement)?.closest<HTMLElement>(linkSelector);
  if (links.length === 0 && enclosing !== undefined && enclosing !== null) {
    return enclosing.dataset.linkUrl ?? enclosing.dataset.webLinkUrl ?? null;
  }
  if (links.length === 0) return null;
  for (const link of links) {
    link.replaceWith(document.createTextNode(link.dataset.linkUrl ?? link.dataset.webLinkUrl ?? ""));
  }
  const read = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (node instanceof HTMLBRElement) return "\n";
    let result = "";
    for (const child of node.childNodes) {
      if (child instanceof HTMLElement && /^(DIV|P|LI|PRE|BLOCKQUOTE|H[1-6])$/u.test(child.tagName)
        && result.length > 0 && !result.endsWith("\n")) result += "\n";
      result += read(child);
    }
    return result;
  };
  return read(fragment);
};

let consumers = 0;
const copy = (event: ClipboardEvent) => {
  if (event.defaultPrevented || event.clipboardData === null) return;
  const text = selectedWebLinkText(window.getSelection());
  if (text === null) return;
  event.clipboardData.setData("text/plain", text);
  event.preventDefault();
};

export const useWebLinkClipboard = (): void => {
  useEffect(() => {
    if (consumers++ === 0) document.addEventListener("copy", copy);
    return () => {
      if (--consumers === 0) document.removeEventListener("copy", copy);
    };
  }, []);
};
