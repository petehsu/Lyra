import type { FileManagerEntryDragPayload } from "../file-manager/drag-transfer";
import type {
  SidebarComposerFileToken,
  SidebarComposerSubmitPayload,
  SidebarComposerToken,
  SidebarComposerTextToken
} from "./types";
import {
  isSidebarFileChipIconKind,
  resolveSidebarFileChipIconKind,
  SIDEBAR_FILE_CHIP_ICON_DEFS_ATTRIBUTE,
  SIDEBAR_FILE_CHIP_ICON_KIND_ATTRIBUTE
} from "./file-chip-icon-kind";

const FILE_CHIP_CLASS_NAME = "lyra-sidebar-composer-file-chip";
const FILE_CHIP_ICON_KIND_PREFIX = "lyra-sidebar-composer-file-chip-kind-";
const FILE_CHIP_ICON_DEFS_SELECTOR = `[${SIDEBAR_FILE_CHIP_ICON_DEFS_ATTRIBUTE}="true"]`;

const escapeAttributeValue = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const resolveIconTemplateSelector = (iconKind: string): string =>
  `[${SIDEBAR_FILE_CHIP_ICON_KIND_ATTRIBUTE}="${escapeAttributeValue(iconKind)}"]`;

const isNodeInsideEditor = (editor: HTMLElement, node: Node | null): boolean => {
  if (node === null) {
    return false;
  }
  return editor === node || editor.contains(node);
};

const resolveRangeFromPoint = (
  documentRef: Document,
  x: number,
  y: number
): Range | null => {
  if (typeof documentRef.caretRangeFromPoint === "function") {
    return documentRef.caretRangeFromPoint(x, y);
  }

  if (typeof documentRef.caretPositionFromPoint === "function") {
    const caretPosition = documentRef.caretPositionFromPoint(x, y);
    if (caretPosition === null) {
      return null;
    }
    const range = documentRef.createRange();
    range.setStart(caretPosition.offsetNode, caretPosition.offset);
    range.collapse(true);
    return range;
  }

  return null;
};

const resolveInsertRange = (
  editor: HTMLElement,
  anchorPoint?: { readonly x: number; readonly y: number }
): Range => {
  const documentRef = editor.ownerDocument;
  if (anchorPoint !== undefined) {
    const byPoint = resolveRangeFromPoint(documentRef, anchorPoint.x, anchorPoint.y);
    if (byPoint !== null && isNodeInsideEditor(editor, byPoint.startContainer)) {
      return byPoint;
    }
  }

  const selection = documentRef.defaultView?.getSelection();
  if (selection !== undefined && selection !== null && selection.rangeCount > 0) {
    const selectedRange = selection.getRangeAt(0).cloneRange();
    if (isNodeInsideEditor(editor, selectedRange.startContainer)) {
      return selectedRange;
    }
  }

  const fallbackRange = documentRef.createRange();
  fallbackRange.selectNodeContents(editor);
  fallbackRange.collapse(false);
  return fallbackRange;
};

const focusCaretAfterNode = (node: Node): void => {
  const documentRef = node.ownerDocument;
  if (documentRef === null) {
    return;
  }
  const selection = documentRef.defaultView?.getSelection();
  if (selection === undefined || selection === null) {
    return;
  }

  const range = documentRef.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

const createFileChipNode = (
  documentRef: Document,
  payload: FileManagerEntryDragPayload
): HTMLSpanElement => {
  const resolvedIconKind = resolveSidebarFileChipIconKind(payload.kind, payload.iconKind);
  const chip = documentRef.createElement("span");
  chip.className = FILE_CHIP_CLASS_NAME;
  chip.classList.add(`${FILE_CHIP_ICON_KIND_PREFIX}${resolvedIconKind}`);
  chip.setAttribute("contenteditable", "false");
  chip.setAttribute("draggable", "false");
  chip.dataset.lyraFileName = payload.name;
  chip.dataset.lyraFileKind = payload.kind;
  chip.dataset.lyraFileSource = payload.source;
  chip.dataset.lyraFileIconKind = resolvedIconKind;
  if (payload.path !== undefined) {
    chip.dataset.lyraFilePath = payload.path;
    chip.title = payload.path;
  } else {
    chip.title = payload.name;
  }

  const icon = documentRef.createElement("span");
  icon.className = "lyra-sidebar-composer-file-chip-icon";
  icon.setAttribute("aria-hidden", "true");
  const defsHost = documentRef.querySelector(FILE_CHIP_ICON_DEFS_SELECTOR);
  if (defsHost !== null) {
    const iconTemplate = defsHost.querySelector(resolveIconTemplateSelector(resolvedIconKind));
    const glyph = iconTemplate?.firstElementChild?.cloneNode(true);
    if (glyph !== undefined && glyph !== null) {
      icon.append(glyph);
    }
  }
  chip.append(icon);

  const label = documentRef.createElement("span");
  label.className = "lyra-sidebar-composer-file-chip-label";
  label.textContent = payload.name;
  chip.append(label);

  return chip;
};

const createTextToken = (value: string): SidebarComposerTextToken => ({
  kind: "text",
  value
});

const isFileChipElement = (element: HTMLElement): boolean =>
  element.classList.contains(FILE_CHIP_CLASS_NAME);

const normalizeTokenPath = (path: string | undefined): string | undefined => {
  if (path === undefined) {
    return undefined;
  }
  const trimmed = path.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const normalizeTokenIconKind = (
  iconKind: string | undefined
): SidebarComposerFileToken["iconKind"] | undefined => {
  if (iconKind === undefined) {
    return undefined;
  }
  const trimmed = iconKind.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  return isSidebarFileChipIconKind(trimmed) ? trimmed : undefined;
};

const toFileTokenFromChip = (element: HTMLElement): SidebarComposerFileToken | null => {
  const name = element.dataset.lyraFileName?.trim() ?? "";
  if (name.length === 0) {
    return null;
  }

  const entryKind =
    element.dataset.lyraFileKind === "directory"
      ? "directory"
      : element.dataset.lyraFileKind === "file"
        ? "file"
        : null;
  if (entryKind === null) {
    return null;
  }

  const source =
    element.dataset.lyraFileSource === "trash"
      ? "trash"
      : element.dataset.lyraFileSource === "directory"
        ? "directory"
        : null;
  if (source === null) {
    return null;
  }

  const path = normalizeTokenPath(element.dataset.lyraFilePath);
  const iconKind = normalizeTokenIconKind(element.dataset.lyraFileIconKind);
  return {
    kind: "file",
    name,
    entryKind,
    source,
    ...(path === undefined ? {} : { path }),
    ...(iconKind === undefined ? {} : { iconKind })
  };
};

const collectTokensFromNode = (node: ChildNode): SidebarComposerToken[] => {
  if (node.nodeType === Node.TEXT_NODE) {
    return [createTextToken(node.textContent ?? "")];
  }

  if ((node instanceof HTMLElement) === false) {
    return [];
  }

  const element = node;
  if (isFileChipElement(element)) {
    const token = toFileTokenFromChip(element);
    return token === null ? [] : [token];
  }

  if (element.tagName === "BR") {
    return [createTextToken("\n")];
  }

  const content = Array.from(element.childNodes).flatMap((child) =>
    collectTokensFromNode(child)
  );
  if (
    (element.tagName === "DIV" || element.tagName === "P") && content.length > 0
  ) {
    const lastToken = content[content.length - 1];
    if (lastToken === undefined || lastToken.kind === "file") {
      content.push(createTextToken("\n"));
      return content;
    }

    if (lastToken.value.endsWith("\n") === false) {
      content.push(createTextToken("\n"));
    }
  }

  return content;
};

const normalizeComposerTokens = (
  tokens: readonly SidebarComposerToken[]
): readonly SidebarComposerToken[] => {
  const normalized: SidebarComposerToken[] = [];
  for (const token of tokens) {
    if (token.kind === "file") {
      normalized.push(token);
      continue;
    }

    const normalizedValue = token.value.replace(/\u00A0/g, " ");
    if (normalizedValue.length === 0) {
      continue;
    }

    const lastToken = normalized[normalized.length - 1];
    if (lastToken !== undefined && lastToken.kind === "text") {
      normalized[normalized.length - 1] = {
        kind: "text",
        value: `${lastToken.value}${normalizedValue}`
      };
      continue;
    }

    normalized.push({
      kind: "text",
      value: normalizedValue
    });
  }

  return normalized;
};

const serializeTokensToText = (
  tokens: readonly SidebarComposerToken[]
): string =>
  tokens
    .map((token) => (token.kind === "file" ? token.name : token.value))
    .join("")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const readComposerEditorSubmission = (
  editor: HTMLElement
): SidebarComposerSubmitPayload => {
  const rawTokens = Array.from(editor.childNodes).flatMap((node) =>
    collectTokensFromNode(node)
  );
  const tokens = normalizeComposerTokens(rawTokens);

  return {
    text: serializeTokensToText(tokens),
    tokens
  };
};

export const serializeComposerEditorContent = (editor: HTMLElement): string =>
  readComposerEditorSubmission(editor).text;

export const clearComposerEditorContent = (editor: HTMLElement): void => {
  editor.textContent = "";
};

export const insertFileChipAtComposerEditor = (
  editor: HTMLElement,
  payload: FileManagerEntryDragPayload,
  anchorPoint?: { readonly x: number; readonly y: number }
): void => {
  const range = resolveInsertRange(editor, anchorPoint);
  const chip = createFileChipNode(editor.ownerDocument, payload);
  range.deleteContents();
  range.insertNode(chip);

  const trailingSpace = editor.ownerDocument.createTextNode(" ");
  chip.after(trailingSpace);
  focusCaretAfterNode(trailingSpace);
};
