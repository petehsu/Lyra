// CSS UI cursor vocabulary. These are author-supplied hints, not capabilities.
export const CURSOR_DEFINITIONS = {
  auto: { kind: "neutral", hint: "browser-selected appearance" },
  default: { kind: "neutral", hint: "default arrow; no action implied" },
  none: { kind: "neutral", hint: "pointer hidden; not a disabled state" },
  "context-menu": { kind: "action", hint: "context menu; usually right-click" },
  help: { kind: "action", hint: "help or explanation" },
  pointer: { kind: "action", hint: "link or click" },
  progress: { kind: "status", hint: "processing; interaction may remain available" },
  wait: { kind: "status", hint: "waiting; availability unconfirmed" },
  cell: { kind: "selection", hint: "select cells" },
  crosshair: { kind: "selection", hint: "precise position or area selection" },
  text: { kind: "selection", hint: "horizontal text selection; editing unconfirmed" },
  "vertical-text": { kind: "selection", hint: "vertical text selection; editing unconfirmed" },
  alias: { kind: "action", hint: "create reference during drag/drop" },
  copy: { kind: "action", hint: "copy during drag/drop" },
  move: { kind: "action", hint: "move" },
  "no-drop": { kind: "status", hint: "drop rejected here; other actions unconfirmed" },
  "not-allowed": { kind: "status", hint: "operation disallowed; DOM disabled state is separate" },
  grab: { kind: "action", hint: "grab or drag" },
  grabbing: { kind: "action", hint: "grabbing appearance; drag outcome unconfirmed" },
  "all-scroll": { kind: "action", hint: "pan in any direction" },
  "col-resize": { kind: "action", hint: "resize column width (horizontal)" },
  "row-resize": { kind: "action", hint: "resize row height (vertical)" },
  "n-resize": { kind: "action", hint: "resize top edge (north)" },
  "e-resize": { kind: "action", hint: "resize right edge (east)" },
  "s-resize": { kind: "action", hint: "resize bottom edge (south)" },
  "w-resize": { kind: "action", hint: "resize left edge (west)" },
  "ne-resize": { kind: "action", hint: "resize top-right corner (northeast)" },
  "nw-resize": { kind: "action", hint: "resize top-left corner (northwest)" },
  "se-resize": { kind: "action", hint: "resize bottom-right corner (southeast)" },
  "sw-resize": { kind: "action", hint: "resize bottom-left corner (southwest)" },
  "ew-resize": { kind: "action", hint: "resize horizontally (east/west)" },
  "ns-resize": { kind: "action", hint: "resize vertically (north/south)" },
  "nesw-resize": { kind: "action", hint: "resize northeast/southwest diagonal" },
  "nwse-resize": { kind: "action", hint: "resize northwest/southeast diagonal" },
  "zoom-in": { kind: "action", hint: "zoom in" },
  "zoom-out": { kind: "action", hint: "zoom out" }
} as const;

export type BrowserCursorKeyword = keyof typeof CURSOR_DEFINITIONS;
export type BrowserCursorObservation = {
  readonly keyword: BrowserCursorKeyword;
  readonly customImage: boolean;
  /** Equal computed styles do not prove which stylesheet declaration supplied them. */
  readonly sameAsParent?: boolean;
};

export const readCursorObservation = (value: unknown): BrowserCursorObservation | undefined => {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.keyword !== "string" || !Object.hasOwn(CURSOR_DEFINITIONS, record.keyword)) return undefined;
  return { keyword: record.keyword as BrowserCursorKeyword, customImage: record.customImage === true,
    ...(record.sameAsParent === true ? { sameAsParent: true } : {}) };
};

export const formatCursorHint = (cursor: BrowserCursorObservation): string =>
  cursor.customImage
    ? `cursor=custom fallback=${cursor.keyword} fallbackHint=${JSON.stringify(CURSOR_DEFINITIONS[cursor.keyword].hint)} (image appearance uninspected)`
    : `cursor=${cursor.keyword} cssHint=${JSON.stringify(CURSOR_DEFINITIONS[cursor.keyword].hint)}`;

// Read-only and shared by normal/shadow/frame collection. Never return or fetch
// custom cursor URLs; only the mandatory keyword fallback has textual meaning.
export const CURSOR_RUNTIME = String.raw`(() => {
  const definitions = ${JSON.stringify(CURSOR_DEFINITIONS)};
  const parse = raw => {
    const value = String(raw || 'auto').trim().toLowerCase();
    const match = value.match(/(?:^|,)\s*([a-z-]+)\s*$/);
    const keyword = match?.[1] === 'hand' ? 'pointer' : match?.[1];
    if (!keyword || !Object.hasOwn(definitions, keyword)) return null;
    return { keyword, customImage: value.includes('(') };
  };
  const parent = node => node.parentElement || node.getRootNode?.()?.host || null;
  const read = node => {
    const win = node.ownerDocument.defaultView;
    const raw = win.getComputedStyle(node).cursor;
    const result = parse(raw);
    const owner = parent(node);
    return result ? { ...result, ...(owner && win.getComputedStyle(owner).cursor === raw ? { sameAsParent: true } : {}) } : null;
  };
  const discover = cursor => cursor && ['action', 'selection'].includes(definitions[cursor.keyword].kind);
  const describe = cursor => cursor.customImage
    ? 'custom cursor; fallback=' + cursor.keyword + '; fallback hint: ' + definitions[cursor.keyword].hint + '; image uninspected'
    : cursor.keyword + ': ' + definitions[cursor.keyword].hint;
  return { read, parse, parent, discover, describe, definitions };
})()`;
