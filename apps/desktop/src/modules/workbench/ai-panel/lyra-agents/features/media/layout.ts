import type { AgentImageAttachment } from "../../core/types";

export const SMALL_IMAGE_MAX_INTRINSIC_WIDTH = 400;
export const BANNER_MIN_RATIO = 2;
// ponytail: upscale budget from source pixels, not Laplacian blur. Fog/bokeh 4K still full-bleeds; upgrade is a decoded sharpness metric if mist photos get punished.
export const UPSCALE_CAP = 1.5;
export const SHARE_ROW_RATIO_SLACK = 1.75;
export const SIDE_FLOW_MIN_WIDTH = 720;
export const COLUMN_PAIR_MIN_WIDTH = 352;
export const PAIR_TEXT_MIN_WIDTH = 240;
export const PAIR_HEIGHT_SLACK = 1.35;
export const STACK_MIN_IMAGES = 3;
export const SHORT_TEXT_MAX_LINES = 3;
export const WRAP_TEXT_MIN_LINES = 8;
export const LINE_HEIGHT_PX = 22;
export const IMAGE_SLOT_MIN = 160;
export const IMAGE_SLOT_MAX = 280;
export const IMAGE_SLOT_GAP = 14;
export const IMAGE_SLOT_IDEAL = 240;

export const mediaCardColumnCount = (width: number, cardCount = Number.POSITIVE_INFINITY): number => {
  if (!(width > 0) || !(cardCount > 0)) {
    return 1;
  }
  const maxFit = Math.max(1, Math.floor((width + IMAGE_SLOT_GAP) / (IMAGE_SLOT_MIN + IMAGE_SLOT_GAP)));
  const byIdeal = Math.max(1, Math.round((width + IMAGE_SLOT_GAP) / (IMAGE_SLOT_IDEAL + IMAGE_SLOT_GAP)));
  return Math.min(maxFit, byIdeal, Math.max(1, Math.floor(cardCount)));
};

export type AspectKind =
  | "ultraWide"
  | "landscape"
  | "squareLike"
  | "portrait"
  | "ultraTall";

export type MediaImage = {
  readonly id: string;
  readonly src: string;
  readonly alt?: string;
  readonly intrinsicWidth?: number;
  readonly intrinsicHeight?: number;
  readonly attachment?: AgentImageAttachment;
};

export type MediaToken =
  | {
      readonly type: "text";
      readonly id: string;
      readonly text: string;
      readonly sourceBlockId?: string | null;
    }
  | { readonly type: "image"; readonly id: string; readonly image: MediaImage };

export type ResolvedMediaSegment =
  | {
      readonly type: "text";
      readonly id: string;
      readonly text: string;
      readonly sourceBlockId?: string | null;
    }
  | {
      readonly type: "single";
      readonly id: string;
      readonly image: MediaImage;
      readonly group: readonly MediaImage[];
      readonly index: number;
      readonly after: string;
    }
  | {
      readonly type: "side-flow";
      readonly id: string;
      readonly text: string;
      readonly textId: string;
      readonly sourceBlockId?: string | null;
      readonly image: MediaImage;
      readonly order: "text-image" | "image-text";
      readonly wrap: boolean;
      readonly columnPair: boolean;
      readonly after: string;
      readonly group: readonly MediaImage[];
    }
  | {
      readonly type: "stack";
      readonly id: string;
      readonly images: readonly MediaImage[];
    };

export type ResolveMediaLayoutOptions = {
  readonly containerWidth?: number;
};

export const classifyAspect = (ratio: number): AspectKind => {
  if (ratio >= 2.2) return "ultraWide";
  if (ratio >= 1.35) return "landscape";
  if (ratio >= 0.8) return "squareLike";
  if (ratio >= 0.55) return "portrait";
  return "ultraTall";
};

export const isBannerRatio = (ratio: number): boolean => ratio >= BANNER_MIN_RATIO;

export const isBannerImage = (image: MediaImage): boolean => {
  const width = image.intrinsicWidth;
  const height = image.intrinsicHeight;
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return false;
  }
  return isBannerRatio(width / height);
};

export const isCompactIntrinsicImage = (image: MediaImage): boolean => {
  const width = image.intrinsicWidth;
  const height = image.intrinsicHeight;
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return false;
  }
  return Math.max(width, height) < SMALL_IMAGE_MAX_INTRINSIC_WIDTH && isBannerImage(image) === false;
};

const imageRatio = (image: MediaImage): number | null => {
  const width = image.intrinsicWidth;
  const height = image.intrinsicHeight;
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return null;
  }
  return width / height;
};

export const canFillWidth = (image: MediaImage, width: number): boolean => {
  const source = image.intrinsicWidth;
  if (source === undefined || source <= 0 || !(width > 0)) {
    return true;
  }
  return source * UPSCALE_CAP >= width;
};

export const similarShareAspect = (left: MediaImage, right: MediaImage): boolean => {
  const leftRatio = imageRatio(left);
  const rightRatio = imageRatio(right);
  if (leftRatio === null || rightRatio === null) {
    return false;
  }
  const narrow = Math.min(leftRatio, rightRatio);
  const wide = Math.max(leftRatio, rightRatio);
  return narrow >= 1.35 && wide / narrow <= SHARE_ROW_RATIO_SLACK;
};

export const shouldShareRow = (
  left: MediaImage,
  right: MediaImage,
  containerWidth: number
): boolean =>
  containerWidth >= COLUMN_PAIR_MIN_WIDTH
  && similarShareAspect(left, right)
  && (canFillWidth(left, containerWidth) === false || canFillWidth(right, containerWidth) === false);

export const shouldShareCardRow = (
  images: readonly MediaImage[],
  containerWidth: number
): boolean => {
  if (images.length < 2) {
    return false;
  }
  for (let index = 1; index < images.length; index += 1) {
    const previous = images[index - 1];
    const current = images[index];
    if (
      previous === undefined
      || current === undefined
      || shouldShareRow(previous, current, containerWidth) === false
    ) {
      return false;
    }
  }
  return true;
};

export const letterboxWaste = (imageRatio: number, slotRatio: number): number => {
  if (!(imageRatio > 0) || !(slotRatio > 0)) {
    return 1;
  }
  return 1 - Math.min(imageRatio / slotRatio, slotRatio / imageRatio, 1);
};

export const sharedSlotRatio = (
  images: readonly MediaImage[]
): { readonly width: number; readonly height: number } | null => {
  // ponytail: min-max letterbox waste over each image ratio plus geometric mean. Upgrade: sample the slot from decoded pixels if photos already have baked-in bars.
  const sources: { readonly width: number; readonly height: number; readonly ratio: number }[] = [];
  for (const image of images) {
    const ratio = imageRatio(image);
    const width = image.intrinsicWidth;
    const height = image.intrinsicHeight;
    if (ratio === null || width === undefined || height === undefined) {
      continue;
    }
    sources.push({ width, height, ratio });
  }
  if (sources.length === 0) {
    return null;
  }
  const ratios = sources.map((item) => item.ratio);
  const minRatio = Math.min(...ratios);
  const maxRatio = Math.max(...ratios);
  const candidates = [...ratios];
  if (maxRatio / minRatio > 1.02) {
    candidates.push(Math.sqrt(minRatio * maxRatio));
  }
  let bestRatio = candidates[0] ?? minRatio;
  let bestWaste = Number.POSITIVE_INFINITY;
  let bestFlush = -1;
  for (const slot of candidates) {
    let maxWaste = 0;
    let flush = 0;
    for (const ratio of ratios) {
      const waste = letterboxWaste(ratio, slot);
      maxWaste = Math.max(maxWaste, waste);
      if (waste < 0.02) {
        flush += 1;
      }
    }
    if (maxWaste < bestWaste - 1e-6 || (Math.abs(maxWaste - bestWaste) < 1e-6 && flush > bestFlush)) {
      bestWaste = maxWaste;
      bestRatio = slot;
      bestFlush = flush;
    }
  }
  const match = sources.find((item) => Math.abs(item.ratio - bestRatio) < 1e-4);
  if (match !== undefined) {
    return { width: match.width, height: match.height };
  }
  return { width: Math.max(1, Math.round(bestRatio * 1000)), height: 1000 };
};

export const aspectKindFromSize = (
  width: number | undefined,
  height: number | undefined
): AspectKind | null => {
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return null;
  }
  return classifyAspect(width / height);
};

export const withIntrinsicSize = (
  image: MediaImage,
  width: number,
  height: number
): MediaImage => {
  if (width <= 0 || height <= 0) {
    return image;
  }
  if (image.intrinsicWidth === width && image.intrinsicHeight === height) {
    return image;
  }
  return {
    ...image,
    intrinsicWidth: width,
    intrinsicHeight: height
  };
};

export const applyImageSizes = (
  tokens: readonly MediaToken[],
  sizes: Readonly<Record<string, { readonly width: number; readonly height: number }>>
): MediaToken[] =>
  tokens.map((token) => {
    if (token.type !== "image") {
      return token;
    }
    const size = sizes[token.image.id];
    if (size === undefined) {
      return token;
    }
    return {
      ...token,
      image: withIntrinsicSize(token.image, size.width, size.height)
    };
  });

const isBlankText = (text: string): boolean => text.trim().length === 0;

const charsPerLineFor = (containerWidth: number): number =>
  Math.max(24, Math.floor(containerWidth / 8));

const isRichBlocked = (text: string): boolean =>
  /(^|\n)\s*(```|~~~)/u.test(text)
  || /(^|\n)\s*\|.+\|/u.test(text)
  || /(^|\n)\s{0,3}#{1,6}\s/u.test(text);

export const estimateLineCount = (text: string, containerWidth: number): number => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 0;
  }
  const charsPerLine = charsPerLineFor(containerWidth);
  let lines = 0;
  for (const line of trimmed.split("\n")) {
    lines += Math.max(1, Math.ceil(line.length / Math.max(charsPerLine, 1)));
  }
  return lines;
};

export const estimateImageDisplayHeight = (
  image: MediaImage,
  maxWidth: number
): number => {
  const width = image.intrinsicWidth;
  const height = image.intrinsicHeight;
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return Math.min(IMAGE_SLOT_IDEAL, IMAGE_SLOT_MAX);
  }
  if (isBannerImage(image)) {
    return (height / width) * Math.max(maxWidth, 1);
  }
  return height * Math.min(maxWidth / width, IMAGE_SLOT_MAX / height, 1);
};

export const isShortText = (text: string, containerWidth: number): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0 || isRichBlocked(trimmed)) {
    return false;
  }
  return estimateLineCount(trimmed, containerWidth) <= SHORT_TEXT_MAX_LINES;
};

export const isWrapText = (text: string, containerWidth: number): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0 || isShortText(trimmed, containerWidth) || isRichBlocked(trimmed)) {
    return false;
  }
  return estimateLineCount(trimmed, containerWidth) >= WRAP_TEXT_MIN_LINES;
};

const PARAGRAPH_SPLIT = /\n{2,}/u;
const MARKDOWN_LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s+\S/u;

const rawLines = (text: string): string[] =>
  text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

export const isCompactText = (text: string, containerWidth: number): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0 || isRichBlocked(trimmed) || containerWidth <= 0) {
    return false;
  }
  const lines = rawLines(trimmed);
  if (lines.length < 3) {
    return false;
  }
  const listed = lines.filter((line) => MARKDOWN_LIST_LINE.test(line)).length;
  return listed * 2 >= lines.length;
};

const isLabelLine = (text: string, containerWidth: number): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.includes("\n") || isRichBlocked(trimmed)) {
    return false;
  }
  if (/[。！？.!?]/u.test(trimmed)) {
    return false;
  }
  return estimateLineCount(trimmed, containerWidth) === 1
    && trimmed.length <= Math.max(8, charsPerLineFor(containerWidth) * 0.4);
};

const joinParagraphs = (parts: readonly string[]): string =>
  parts.filter((part) => part.trim().length > 0).join("\n\n").trim();

export const splitTrailingPairText = (
  text: string,
  containerWidth: number
): { readonly lead: string; readonly trailing: string } | null => {
  const trimmed = text.trimEnd();
  const parts = trimmed.split(PARAGRAPH_SPLIT);
  let end = parts.length;
  let seenCompact = false;
  while (end > 0) {
    const part = parts[end - 1] ?? "";
    if (isCompactText(part, containerWidth)) {
      seenCompact = true;
      end -= 1;
      continue;
    }
    if (seenCompact && isLabelLine(part, containerWidth)) {
      end -= 1;
      break;
    }
    if (seenCompact) {
      break;
    }
    if (isShortText(part, containerWidth) && !part.includes("\n") && end === parts.length) {
      end -= 1;
      break;
    }
    break;
  }
  if (end < parts.length) {
    const trailing = joinParagraphs(parts.slice(end));
    const lead = joinParagraphs(parts.slice(0, end));
    if (trailing.length === 0) {
      return null;
    }
    return { lead, trailing };
  }

  const lines = (parts[parts.length - 1] ?? trimmed).split("\n");
  let start = lines.length;
  while (start > 0 && MARKDOWN_LIST_LINE.test((lines[start - 1] ?? "").trim())) {
    start -= 1;
  }
  if (start > 0 && start < lines.length) {
    const before = (lines[start - 1] ?? "").trim();
    if (isLabelLine(before, containerWidth)) {
      start -= 1;
    }
  }
  if (start <= 0 || start >= lines.length) {
    return isCompactText(trimmed, containerWidth) ? { lead: "", trailing: trimmed.trim() } : null;
  }
  const localLead = lines.slice(0, start).join("\n").trim();
  const trailing = lines.slice(start).join("\n").trim();
  if (trailing.length === 0) {
    return null;
  }
  return {
    lead: joinParagraphs([...parts.slice(0, -1), localLead]),
    trailing
  };
};

const withText = (
  token: Extract<MediaToken, { type: "text" }>,
  id: string,
  value: string
): Extract<MediaToken, { type: "text" }> => ({
  ...token,
  id,
  text: value
});

const isUltraWideImage = (image: MediaImage): boolean => isBannerImage(image);

const skipBlank = (tokens: readonly MediaToken[], start: number): number => {
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token?.type === "text" && isBlankText(token.text)) {
      index += 1;
      continue;
    }
    break;
  }
  return index;
};

const countImageTokensBefore = (tokens: readonly MediaToken[], end: number): number => {
  let count = 0;
  for (let index = 0; index < end; index += 1) {
    if (tokens[index]?.type === "image") {
      count += 1;
    }
  }
  return count;
};

const hasImageAfter = (tokens: readonly MediaToken[], start: number): boolean => {
  const index = skipBlank(tokens, start);
  return tokens[index]?.type === "image";
};

const collectImageRun = (
  tokens: readonly MediaToken[],
  start: number
): { readonly images: MediaImage[]; readonly next: number } => {
  const images: MediaImage[] = [];
  let index = start;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) {
      break;
    }
    if (token.type === "image") {
      images.push(token.image);
      index += 1;
      continue;
    }
    if (token.type === "text" && isBlankText(token.text)) {
      index += 1;
      continue;
    }
    break;
  }
  return { images, next: index };
};

const singleSegment = (
  image: MediaImage,
  group: readonly MediaImage[],
  index: number
): Extract<ResolvedMediaSegment, { type: "single" }> => ({
  type: "single",
  id: `single:${image.id}`,
  image,
  group,
  index,
  after: ""
});

const emitSingles = (
  images: readonly MediaImage[],
  out: ResolvedMediaSegment[]
): void => {
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    if (image === undefined) {
      continue;
    }
    out.push(singleSegment(image, images, index));
  }
};

const pairImageSlot = (containerWidth: number): number =>
  Math.min(IMAGE_SLOT_MAX, Math.max(IMAGE_SLOT_MIN, containerWidth * 0.48));

const pairTextWidth = (containerWidth: number): number =>
  Math.max(0, containerWidth - pairImageSlot(containerWidth) - IMAGE_SLOT_GAP);

const asciiRunOverflows = (text: string, width: number): boolean => {
  const limit = charsPerLineFor(width);
  for (const token of text.split(/\s+/u)) {
    if (token.length <= limit) {
      continue;
    }
    let ascii = true;
    for (const char of token) {
      if (char.charCodeAt(0) > 127) {
        ascii = false;
        break;
      }
    }
    if (ascii) {
      return true;
    }
  }
  return false;
};

const isCaptionCopy = (text: string, containerWidth: number): boolean => {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.includes("\n") || isRichBlocked(trimmed)) {
    return false;
  }
  if (asciiRunOverflows(trimmed, Math.max(PAIR_TEXT_MIN_WIDTH, containerWidth / 2))) {
    return false;
  }
  return isShortText(trimmed, containerWidth);
};

const copyFitsBesideImage = (
  image: MediaImage,
  text: string,
  containerWidth: number
): boolean => {
  const textWidth = pairTextWidth(containerWidth);
  if (textWidth < PAIR_TEXT_MIN_WIDTH) {
    return false;
  }
  if (asciiRunOverflows(text, textWidth)) {
    return false;
  }
  const textHeight = estimateLineCount(text, textWidth) * LINE_HEIGHT_PX;
  const imageHeight = estimateImageDisplayHeight(image, pairImageSlot(containerWidth));
  return textHeight <= imageHeight * PAIR_HEIGHT_SLACK;
};

const canColumnPair = (
  image: MediaImage,
  text: string,
  containerWidth: number
): boolean =>
  containerWidth >= COLUMN_PAIR_MIN_WIDTH
  && !isUltraWideImage(image)
  && isCompactText(text, containerWidth)
  && estimateLineCount(text, Math.max(PAIR_TEXT_MIN_WIDTH, pairTextWidth(containerWidth))) >= 4
  && copyFitsBesideImage(image, text, containerWidth);

const pairCopyWithImage = (
  token: Extract<MediaToken, { type: "text" }>,
  image: MediaImage,
  containerWidth: number,
  order: "text-image" | "image-text",
  shareRow = false
): Extract<ResolvedMediaSegment, { type: "side-flow" }> | null => {
  if (
    shareRow
    && isUltraWideImage(image)
    && (isShortText(token.text, containerWidth) || isCompactText(token.text, containerWidth))
  ) {
    return sideFlowSegment(token, image, "text-image");
  }
  if (canColumnPair(image, token.text, containerWidth)) {
    return sideFlowSegment(token, image, "image-text", false, true);
  }
  if (!isUltraWideImage(image) && isCompactText(token.text, containerWidth)) {
    return sideFlowSegment(token, image, "image-text");
  }
  if (!isUltraWideImage(image) && isCaptionCopy(token.text, containerWidth)) {
    return sideFlowSegment(token, image, order);
  }
  if (
    !isUltraWideImage(image)
    && containerWidth >= SIDE_FLOW_MIN_WIDTH
    && isWrapText(token.text, containerWidth)
  ) {
    return sideFlowSegment(token, image, order, true);
  }
  return null;
};

type ShareNeighbor = {
  readonly caption: Extract<MediaToken, { type: "text" }> | null;
  readonly image: MediaImage;
  readonly next: number;
};

const peekFollowingShare = (
  tokens: readonly MediaToken[],
  start: number,
  current: MediaImage,
  containerWidth: number
): ShareNeighbor | null => {
  let index = skipBlank(tokens, start);
  const token = tokens[index];
  let caption: Extract<MediaToken, { type: "text" }> | null = null;
  if (token?.type === "text") {
    if (
      isShortText(token.text, containerWidth) === false
      && isCompactText(token.text, containerWidth) === false
    ) {
      return null;
    }
    caption = token;
    index = skipBlank(tokens, index + 1);
  }
  const imageToken = tokens[index];
  if (imageToken?.type !== "image") {
    return null;
  }
  const run = collectImageRun(tokens, index);
  if (run.images.length !== 1) {
    return null;
  }
  const image = run.images[0];
  if (image === undefined || shouldShareRow(current, image, containerWidth) === false) {
    return null;
  }
  return { caption, image, next: run.next };
};

const withShareGroup = (
  first: Extract<ResolvedMediaSegment, { type: "single" | "side-flow" }>,
  second: Extract<ResolvedMediaSegment, { type: "single" | "side-flow" }>
): [
  Extract<ResolvedMediaSegment, { type: "single" | "side-flow" }>,
  Extract<ResolvedMediaSegment, { type: "single" | "side-flow" }>
] => {
  const group = [first.image, second.image];
  return [
    first.type === "single" ? { ...first, group, index: 0 } : { ...first, group },
    second.type === "single" ? { ...second, group, index: 1 } : { ...second, group }
  ];
};

const shareNeighborSegment = (
  neighbor: ShareNeighbor
): Extract<ResolvedMediaSegment, { type: "single" | "side-flow" }> => {
  if (neighbor.caption === null) {
    return singleSegment(neighbor.image, [neighbor.image], 0);
  }
  return sideFlowSegment(neighbor.caption, neighbor.image, "text-image");
};

const isCopyFit = (
  text: string,
  containerWidth: number,
  image: MediaImage
): boolean => {
  if (isBlankText(text) || isRichBlocked(text) || isUltraWideImage(image)) {
    return false;
  }
  if (isCaptionCopy(text, containerWidth)) {
    return true;
  }
  if (isCompactText(text, containerWidth)) {
    return canColumnPair(image, text, containerWidth);
  }
  return false;
};

const textSegment = (
  token: Extract<MediaToken, { type: "text" }>
): Extract<ResolvedMediaSegment, { type: "text" }> => ({
  type: "text",
  id: token.id,
  text: token.text,
  ...(token.sourceBlockId === undefined ? {} : { sourceBlockId: token.sourceBlockId })
});

const sideFlowSegment = (
  token: Extract<MediaToken, { type: "text" }>,
  image: MediaImage,
  order: "text-image" | "image-text",
  wrap = false,
  columnPair = false
): Extract<ResolvedMediaSegment, { type: "side-flow" }> => ({
  type: "side-flow",
  id: `side:${token.id}:${image.id}`,
  text: token.text,
  textId: token.id,
  ...(token.sourceBlockId === undefined ? {} : { sourceBlockId: token.sourceBlockId }),
  image,
  order,
  wrap,
  columnPair,
  after: "",
  group: [image]
});

const joinCopy = (left: string, right: string): string =>
  [left, right].filter((part) => part.trim().length > 0).join("\n\n");

export const figureCopy = (
  segment: Extract<ResolvedMediaSegment, { type: "single" | "side-flow" }>
): string => {
  if (segment.type === "single") {
    return segment.after;
  }
  return joinCopy(segment.text, segment.after);
};

const isImageCard = (
  segment: ResolvedMediaSegment
): segment is Extract<ResolvedMediaSegment, { type: "single" | "side-flow" }> =>
  (segment.type === "single" || segment.type === "side-flow")
  && !(segment.type === "side-flow" && segment.wrap);

const galleryImageCountEndingAt = (
  segments: readonly ResolvedMediaSegment[],
  index: number,
  containerWidth: number
): number => {
  let count = 0;
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const segment = segments[cursor];
    if (segment === undefined) {
      break;
    }
    if (isImageCard(segment)) {
      count += 1;
      continue;
    }
    if (segment.type === "text" && isShortText(segment.text, containerWidth)) {
      continue;
    }
    break;
  }
  return count;
};

const copyAlreadyFilled = (
  card: Extract<ResolvedMediaSegment, { type: "single" | "side-flow" }>,
  containerWidth: number
): boolean => {
  if (card.type === "side-flow" && card.columnPair) {
    return true;
  }
  return estimateLineCount(figureCopy(card), containerWidth) > SHORT_TEXT_MAX_LINES;
};

const attachCopy = (
  card: Extract<ResolvedMediaSegment, { type: "single" | "side-flow" }>,
  copy: Extract<ResolvedMediaSegment, { type: "text" }>,
  containerWidth: number
): Extract<ResolvedMediaSegment, { type: "side-flow" }> => {
  const columnPair = canColumnPair(card.image, copy.text, containerWidth);
  if (card.type === "side-flow") {
    return {
      ...card,
      after: joinCopy(card.after, copy.text),
      columnPair: card.columnPair || columnPair,
      order: columnPair ? "image-text" : card.order
    };
  }
  return {
    type: "side-flow",
    id: `side:${copy.id}:${card.image.id}`,
    text: copy.text,
    textId: copy.id,
    ...(copy.sourceBlockId === undefined ? {} : { sourceBlockId: copy.sourceBlockId }),
    image: card.image,
    order: "image-text",
    wrap: false,
    columnPair,
    after: "",
    group: card.group
  };
};

const captionAsText = (
  card: Extract<ResolvedMediaSegment, { type: "side-flow" }>
): Extract<ResolvedMediaSegment, { type: "text" }> => ({
  type: "text",
  id: card.textId,
  text: card.text,
  ...(card.sourceBlockId === undefined ? {} : { sourceBlockId: card.sourceBlockId })
});

export const attachTrailingCopy = (
  segments: readonly ResolvedMediaSegment[],
  containerWidth = 720
): ResolvedMediaSegment[] => {
  const out: ResolvedMediaSegment[] = [];
  let index = 0;
  while (index < segments.length) {
    const current = segments[index];
    const next = segments[index + 1];
    const following = segments[index + 2];
    const betweenImages = following !== undefined && isImageCard(following);
    const afterGroup = !betweenImages
      && current !== undefined
      && galleryImageCountEndingAt(segments, index, containerWidth) >= 2;
    if (
      current !== undefined
      && isImageCard(current)
      && next?.type === "text"
      && !(isLabelLine(next.text, containerWidth) && following !== undefined && isImageCard(following))
      && !copyAlreadyFilled(current, containerWidth)
      && isCopyFit(next.text, containerWidth, current.image)
      && (following === undefined || isImageCard(following))
      && !afterGroup
    ) {
      if (
        current.type === "side-flow"
        && !current.columnPair
        && current.text.trim().length > 0
        && isShortText(current.text, containerWidth)
      ) {
        out.push(captionAsText(current));
        out.push({
          ...current,
          text: next.text,
          textId: next.id,
          after: "",
          columnPair: canColumnPair(current.image, next.text, containerWidth),
          order: "image-text"
        });
      } else {
        out.push(attachCopy(current, next, containerWidth));
      }
      index += 2;
      continue;
    }
    if (current !== undefined) {
      out.push(current);
    }
    index += 1;
  }
  return out;
};

export const resolveMediaLayout = (
  tokens: readonly MediaToken[],
  options: ResolveMediaLayoutOptions = {}
): ResolvedMediaSegment[] => {
  const containerWidth = options.containerWidth ?? 720;
  const out: ResolvedMediaSegment[] = [];
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) {
      break;
    }

    if (token.type === "text") {
      if (isBlankText(token.text)) {
        index += 1;
        continue;
      }
      const imageStart = skipBlank(tokens, index + 1);
      const imageToken = tokens[imageStart];
      if (imageToken?.type === "image") {
        const run = collectImageRun(tokens, imageStart);
        if (run.images.length >= STACK_MIN_IMAGES) {
          out.push(textSegment(token));
          out.push({
            type: "stack",
            id: `stack:${run.images[0]?.id ?? token.id}`,
            images: run.images
          });
          index = run.next;
          continue;
        }
        if (run.images.length === 2) {
          out.push(textSegment(token));
          emitSingles(run.images, out);
          index = run.next;
          continue;
        }
        const image = run.images[0];
        if (image !== undefined) {
          const pairSplit = splitTrailingPairText(token.text, containerWidth);
          if (pairSplit !== null && pairSplit.lead.length > 0) {
            out.push(textSegment(withText(token, token.id, pairSplit.lead)));
          }
          const copyToken = pairSplit === null
            ? token
            : withText(token, `${token.id}:pair`, pairSplit.trailing);
          const followingShare = peekFollowingShare(tokens, run.next, image, containerWidth);
          const shared = pairCopyWithImage(
            copyToken,
            image,
            containerWidth,
            "text-image",
            followingShare !== null
          );
          if (followingShare !== null && shared !== null) {
            const [first, second] = withShareGroup(shared, shareNeighborSegment(followingShare));
            out.push(first);
            out.push(second);
            index = followingShare.next;
            continue;
          }
          const paired = pairCopyWithImage(copyToken, image, containerWidth, "text-image");
          if (paired !== null) {
            out.push(paired);
            index = run.next;
            continue;
          }
          out.push(textSegment(copyToken));
          const afterImages = skipBlank(tokens, run.next);
          const following = tokens[afterImages];
          if (
            following?.type === "text"
            && !isBlankText(following.text)
            && !(isLabelLine(following.text, containerWidth) && hasImageAfter(tokens, afterImages + 1))
            && (countImageTokensBefore(tokens, imageStart) === 0 || hasImageAfter(tokens, afterImages + 1))
          ) {
            const trailing = pairCopyWithImage(following, image, containerWidth, "image-text");
            if (trailing !== null) {
              out.push(trailing);
              index = afterImages + 1;
              continue;
            }
          }
          out.push(singleSegment(image, [image], 0));
          index = run.next;
          continue;
        }
      }
      out.push(textSegment(token));
      index += 1;
      continue;
    }

    const run = collectImageRun(tokens, index);
    if (run.images.length >= STACK_MIN_IMAGES) {
      out.push({
        type: "stack",
        id: `stack:${run.images[0]?.id ?? token.id}`,
        images: run.images
      });
      index = run.next;
      continue;
    }
    if (run.images.length === 2) {
      emitSingles(run.images, out);
      index = run.next;
      continue;
    }
    const image = run.images[0];
    if (image === undefined) {
      index = run.next;
      continue;
    }
    const followingShare = peekFollowingShare(tokens, run.next, image, containerWidth);
    if (followingShare !== null) {
      const [first, second] = withShareGroup(
        singleSegment(image, [image], 0),
        shareNeighborSegment(followingShare)
      );
      out.push(first);
      out.push(second);
      index = followingShare.next;
      continue;
    }
    const afterImages = skipBlank(tokens, run.next);
    const following = tokens[afterImages];
    if (
      following?.type === "text"
      && !isBlankText(following.text)
      && !(isLabelLine(following.text, containerWidth) && hasImageAfter(tokens, afterImages + 1))
      && (countImageTokensBefore(tokens, index) === 0 || hasImageAfter(tokens, afterImages + 1))
    ) {
      const trailing = pairCopyWithImage(following, image, containerWidth, "image-text");
      if (trailing !== null) {
        out.push(trailing);
        index = afterImages + 1;
        continue;
      }
    }
    out.push(singleSegment(image, [image], 0));
    index = run.next;
  }

  return attachTrailingCopy(out, containerWidth);
};

export const shouldFrameGallery = (images: readonly MediaImage[]): boolean => {
  if (images.length < 3) {
    return false;
  }
  const known: AspectKind[] = [];
  for (const item of images) {
    const kind = aspectKindFromSize(item.intrinsicWidth, item.intrinsicHeight);
    if (kind !== null) {
      known.push(kind);
    }
  }
  if (known.length === 0 || known.length < images.length) {
    return true;
  }
  const first = known[0];
  if (first === undefined) {
    return true;
  }
  return known.some((kind) => kind !== first);
};

type MediaCardSegment = Extract<ResolvedMediaSegment, { type: "single" | "side-flow" }>;

const isMediaCardSegment = (
  segment: ResolvedMediaSegment
): segment is MediaCardSegment =>
  segment.type === "single" || segment.type === "side-flow";

const imageFromCard = (segment: MediaCardSegment): MediaImage => segment.image;

const canFigure = (segment: MediaCardSegment): boolean => {
  if (segment.type === "side-flow" && segment.wrap) {
    return false;
  }
  return isBannerImage(segment.image) === false;
};

const copyFitsFigureNeighbor = (
  segment: MediaCardSegment,
  containerWidth: number
): boolean => {
  const copy = figureCopy(segment).trim();
  if (copy.length === 0) {
    return true;
  }
  return isCaptionCopy(copy, containerWidth);
};

const hasCopy = (segment: MediaCardSegment): boolean =>
  figureCopy(segment).trim().length > 0;

export type MediaLayoutRun =
  | { readonly type: "item"; readonly segment: ResolvedMediaSegment }
  | {
      readonly type: "cards";
      readonly id: string;
      readonly segments: readonly MediaCardSegment[];
      readonly slotRatio?: { readonly width: number; readonly height: number };
    }
  | {
      readonly type: "figure-row";
      readonly id: string;
      readonly segments: readonly MediaCardSegment[];
    };

const pushFigureRuns = (
  cards: readonly MediaCardSegment[],
  runs: MediaLayoutRun[],
  containerWidth: number
): void => {
  let index = 0;
  while (index < cards.length) {
    const start = cards[index];
    if (start === undefined) {
      break;
    }
    if (!canFigure(start)) {
      runs.push({ type: "item", segment: start });
      index += 1;
      continue;
    }
    const row: MediaCardSegment[] = [start];
    index += 1;
    if (copyFitsFigureNeighbor(start, containerWidth)) {
      while (index < cards.length) {
        const next = cards[index];
        if (
          next === undefined
          || !canFigure(next)
          || copyFitsFigureNeighbor(next, containerWidth) === false
        ) {
          break;
        }
        row.push(next);
        index += 1;
      }
    }
    const lead = row[0];
    if (lead === undefined || (row.length < 2 && !row.some(hasCopy))) {
      runs.push({ type: "item", segment: start });
      continue;
    }
    runs.push({
      type: "figure-row",
      id: `figures:${lead.id}`,
      segments: row
    });
  }
};

export type GroupMediaCardRunsOptions = {
  readonly containerWidth?: number;
};

export const groupMediaCardRuns = (
  segments: readonly ResolvedMediaSegment[],
  options: GroupMediaCardRunsOptions = {}
): MediaLayoutRun[] => {
  const containerWidth = options.containerWidth ?? 720;
  const runs: MediaLayoutRun[] = [];
  let index = 0;
  while (index < segments.length) {
    const segment = segments[index];
    if (segment === undefined) {
      break;
    }
    if (!isMediaCardSegment(segment) || (segment.type === "side-flow" && segment.wrap)) {
      runs.push({ type: "item", segment });
      index += 1;
      continue;
    }
    const cards: MediaCardSegment[] = [segment];
    index += 1;
    while (index < segments.length) {
      const next = segments[index];
      if (
        next === undefined
        || !isMediaCardSegment(next)
        || (next.type === "side-flow" && next.wrap)
      ) {
        break;
      }
      cards.push(next);
      index += 1;
    }
    const images = cards.map(imageFromCard);
    if (cards.length >= 2 && (shouldFrameGallery(images) || shouldShareCardRow(images, containerWidth))) {
      const slotRatio = sharedSlotRatio(images);
      runs.push({
        type: "cards",
        id: `cards:${cards[0]?.id ?? segment.id}`,
        segments: cards,
        ...(slotRatio === null ? {} : { slotRatio })
      });
      continue;
    }
    pushFigureRuns(cards, runs, containerWidth);
  }
  return runs;
};

const isSafeImageSrc = (value: string): boolean => {
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

const unwrapMarkdownDestination = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const MARKDOWN_IMAGE_LINE =
  /^\s*!\[([^\]]*)\]\(\s*(<[^>\s]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)\s*$/u;
const HTML_IMAGE_LINE = /^\s*<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*\/?>\s*$/iu;
const STANDALONE_LINKED_IMAGE_LINE =
  /^\s*\[!\[([^\]]*)\]\(\s*(<[^>\s]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)\]\(\s*(?:<[^>\s]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)\s*$/u;
const PREFIX_LINKED_IMAGE_LINE =
  /^(\S.*?)\s*\[!\[([^\]]*)\]\(\s*(<[^>\s]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)\]\(\s*(?:<[^>\s]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)\s*$/u;
const PREFIX_BARE_IMAGE_LINE =
  /^(\S.*?)\s*!\[([^\]]*)\]\(\s*(<[^>\s]+>|[^\s)]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)\s*$/u;

const isIndentedOrListed = (line: string): boolean =>
  /^\s{4,}|\t/u.test(line) || /^\s{0,3}(?:>|\* |\+ |- |\d+\. )/u.test(line);

const isPeelableImagePrefix = (prefix: string): boolean => {
  const trimmed = prefix.trim();
  if (trimmed.length === 0 || trimmed.length > 32) {
    return false;
  }
  if (trimmed.includes("![") || trimmed.includes("`") || trimmed.includes("|")) {
    return false;
  }
  return /[:：]$/u.test(trimmed) || [...trimmed].length <= 12;
};

const parseStandaloneImageLine = (line: string): { alt: string; src: string } | null => {
  if (isIndentedOrListed(line)) {
    return null;
  }
  const markdown = MARKDOWN_IMAGE_LINE.exec(line);
  if (markdown !== null) {
    const src = unwrapMarkdownDestination(markdown[2] ?? "");
    if (src.length === 0 || !isSafeImageSrc(src)) {
      return null;
    }
    return { alt: markdown[1] ?? "", src };
  }
  const html = HTML_IMAGE_LINE.exec(line);
  if (html !== null) {
    const src = (html[1] ?? "").trim();
    if (src.length === 0 || !isSafeImageSrc(src)) {
      return null;
    }
    const altMatch = /\balt\s*=\s*["']([^"']*)["']/iu.exec(line);
    return { alt: altMatch?.[1] ?? "", src };
  }
  return null;
};

type ExtractedImageLine = {
  readonly prefix: string;
  readonly alt: string;
  readonly src: string;
};

const parseExtractableImageLine = (line: string): ExtractedImageLine | null => {
  const standalone = parseStandaloneImageLine(line);
  if (standalone !== null) {
    return { prefix: "", alt: standalone.alt, src: standalone.src };
  }
  if (isIndentedOrListed(line)) {
    return null;
  }
  const linked = STANDALONE_LINKED_IMAGE_LINE.exec(line);
  if (linked !== null) {
    const src = unwrapMarkdownDestination(linked[2] ?? "");
    if (src.length === 0 || !isSafeImageSrc(src)) {
      return null;
    }
    return { prefix: "", alt: linked[1] ?? "", src };
  }
  const prefixLinked = PREFIX_LINKED_IMAGE_LINE.exec(line);
  const linkedPrefix = prefixLinked?.[1] ?? "";
  if (prefixLinked !== null && isPeelableImagePrefix(linkedPrefix)) {
    const src = unwrapMarkdownDestination(prefixLinked[3] ?? "");
    if (src.length === 0 || !isSafeImageSrc(src)) {
      return null;
    }
    return { prefix: linkedPrefix.trimEnd(), alt: prefixLinked[2] ?? "", src };
  }
  const prefixBare = PREFIX_BARE_IMAGE_LINE.exec(line);
  const barePrefix = prefixBare?.[1] ?? "";
  if (prefixBare !== null && isPeelableImagePrefix(barePrefix)) {
    const src = unwrapMarkdownDestination(prefixBare[3] ?? "");
    if (src.length === 0 || !isSafeImageSrc(src)) {
      return null;
    }
    return { prefix: barePrefix.trimEnd(), alt: prefixBare[2] ?? "", src };
  }
  return null;
};

export const mediaTypeFromSrc = (src: string): string => {
  const data = /^data:(image\/[a-z0-9.+-]+);base64,/iu.exec(src);
  if (data?.[1] !== undefined) {
    return data[1];
  }
  const path = src.split("?")[0]?.split("#")[0] ?? src;
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "avif":
      return "image/avif";
    default:
      return "image/png";
  }
};

export const imageAttachmentFromSrc = (
  id: string,
  src: string,
  alt: string
): AgentImageAttachment => {
  const dataMatch = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/iu.exec(src.trim());
  if (dataMatch !== null) {
    return {
      id,
      mediaType: dataMatch[1] ?? "image/png",
      data: (dataMatch[2] ?? "").trim(),
      label: alt.length === 0 ? null : alt,
      source: "inline-data-url"
    };
  }
  return {
    id,
    mediaType: mediaTypeFromSrc(src),
    data: "",
    label: alt.length === 0 ? null : alt,
    source: src
  };
};

const FENCE_OPEN = /^(\s{0,3})(`{3,}|~{3,})(.*)$/u;
const FENCE_CLOSE = /^(\s{0,3})(`{3,}|~{3,})\s*$/u;

export const scanMarkdownMediaTokens = (source: string): MediaToken[] => {
  const lines = source.split("\n");
  const tokens: MediaToken[] = [];
  const buf: string[] = [];
  const seenSrc = new Map<string, number>();
  let fence: { readonly marker: string; readonly length: number } | null = null;
  let textSerial = 0;

  const flushText = (): void => {
    const text = buf.join("\n");
    buf.length = 0;
    if (isBlankText(text)) {
      return;
    }
    const id = `md-text-${textSerial}`;
    textSerial += 1;
    tokens.push({ type: "text", id, text });
  };

  for (const line of lines) {
    if (fence !== null) {
      buf.push(line);
      const close = FENCE_CLOSE.exec(line);
      if (
        close !== null
        && (close[2]?.[0] ?? "") === fence.marker
        && (close[2]?.length ?? 0) >= fence.length
      ) {
        fence = null;
      }
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    const marker = open?.[2] ?? "";
    if (open !== null && marker.length > 0) {
      const info = open[3] ?? "";
      const fenceChar = marker[0] ?? "";
      if (fenceChar.length === 0 || !info.includes(fenceChar)) {
        fence = { marker: fenceChar, length: marker.length };
        buf.push(line);
        continue;
      }
    }

    const image = parseExtractableImageLine(line);
    if (image !== null) {
      if (image.prefix.length > 0) {
        buf.push(image.prefix);
      }
      flushText();
      const occurrence = (seenSrc.get(image.src) ?? 0) + 1;
      seenSrc.set(image.src, occurrence);
      const id = `md-img:${image.src}#${occurrence}`;
      const media: MediaImage = {
        id,
        src: image.src,
        ...(image.alt.length === 0 ? {} : { alt: image.alt }),
        attachment: imageAttachmentFromSrc(id, image.src, image.alt)
      };
      tokens.push({ type: "image", id, image: media });
      continue;
    }

    buf.push(line);
  }

  flushText();
  return tokens;
};
