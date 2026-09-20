import { defaultSchema } from "rehype-sanitize";
import rehypeSanitize from "rehype-sanitize";
import remarkGemoji from "remark-gemoji";
import {
  defaultRehypePlugins,
  defaultRemarkPlugins,
  type StreamdownProps
} from "streamdown";

const NAMED_COLORS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black
  blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse
  chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
  darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
  darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet
  deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite
  forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green
  greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender
  lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink
  lightsalmon lightseagreen lightskyblue lightslategray lightslategrey
  lightsteelblue lightyellow lime limegreen linen magenta maroon
  mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
  mediumslateblue mediumspringgreen mediumturquoise mediumvioletred
  midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive
  olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise
  palevioletred papayawhip peachpuff peru pink plum powderblue purple
  rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
  seagreen seashell sienna silver skyblue slateblue slategray slategrey
  snow springgreen steelblue tan teal thistle tomato turquoise violet
  wheat white whitesmoke yellow yellowgreen transparent`.split(/\s+/u)
);

const HEX_COLOR = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu;
const RGB_COLOR =
  /^rgba?\(\s*(?:\d{1,3}%?\s*[, ]\s*){2}\d{1,3}%?(?:\s*[,/]\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\)$/iu;
const HSL_COLOR =
  /^hsla?\(\s*-?\d{1,3}(?:deg)?\s*[, ]\s*\d{1,3}%\s*[, ]\s*\d{1,3}%(?:\s*[,/]\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\)$/iu;

export const isSafeCssColor = (value: string): boolean => {
  const color = value.trim().toLowerCase();
  if (color.length === 0 || color.length > 64) return false;
  if (/url\(|expression|javascript|var\(|attr\(/iu.test(color)) return false;
  if (NAMED_COLORS.has(color)) return true;
  return HEX_COLOR.test(color) || RGB_COLOR.test(color) || HSL_COLOR.test(color);
};

const STYLE_KEEP = new Set(["color", "background-color"]);

export const sanitizeInlineStyle = (style: string): string | undefined => {
  const kept: string[] = [];
  for (const part of style.split(";")) {
    const separator = part.indexOf(":");
    if (separator <= 0) continue;
    const property = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim();
    if (!STYLE_KEEP.has(property) || !isSafeCssColor(value)) continue;
    kept.push(`${property}: ${value}`);
  }
  return kept.length > 0 ? kept.join("; ") : undefined;
};

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const classNamesOf = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.length > 0) {
    return value.split(/\s+/u);
  }
  return [];
};

const applySafeColor = (properties: Record<string, unknown>, color: string): void => {
  const next = sanitizeInlineStyle(`color: ${color}`);
  if (next === undefined) return;
  const existing = typeof properties.style === "string"
    ? sanitizeInlineStyle(properties.style)
    : undefined;
  properties.style = existing === undefined ? next : `${existing}; ${next}`;
};

const visitElement = (node: HastNode): void => {
  if (node.type === "element" && node.tagName !== undefined) {
    const properties = node.properties ?? {};
    if (typeof properties.style === "string") {
      const next = sanitizeInlineStyle(properties.style);
      if (next === undefined) delete properties.style;
      else properties.style = next;
    }
    if (typeof properties.color === "string" && isSafeCssColor(properties.color)) {
      applySafeColor(properties, properties.color);
    }
    delete properties.color;
    if (node.tagName === "font") {
      node.tagName = "span";
      properties.className = [...classNamesOf(properties.className), "lyra-agents-md-colored"];
    }
    node.properties = properties;
  }
  for (const child of node.children ?? []) visitElement(child);
};

export const rehypeSafeInlineColors = () => (tree: HastNode) => {
  visitElement(tree);
};

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string };
};

const toText = (node: MdNode): string => {
  if (node.type === "break") return "\n";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(toText).join("");
};

const startsWithColonDefinition = (node: MdNode): boolean =>
  /^:\s+\S/u.test(toText(node).trimStart());

const isUrlLikeTerm = (term: string, def: string): boolean =>
  /^(?:https?|ftp|file)$/iu.test(term) || def.startsWith("//");

const parseCjkGlossary = (
  text: string
): { terms: string[]; defs: string[] } | null => {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length < 2) return null;
  const terms: string[] = [];
  const defs: string[] = [];
  for (const line of lines) {
    const match = /^([^\n：:]{1,48})[：:](.+)$/u.exec(line);
    if (match === null) return null;
    const term = (match[1] ?? "").trim();
    const def = (match[2] ?? "").trim();
    if (term.length === 0 || def.length === 0 || !/\p{L}/u.test(term)) return null;
    if (isUrlLikeTerm(term, def)) return null;
    terms.push(term);
    defs.push(def);
  }
  return { terms, defs };
};

const parseExtraDeflist = (
  text: string
): { terms: string[]; defs: string[] } | null => {
  const lines = text.split("\n");
  if (lines.length < 2) return null;
  const terms: string[] = [];
  const defs: string[] = [];
  let seenDef = false;
  for (const raw of lines) {
    if (/^:\s+\S/u.test(raw)) {
      seenDef = true;
      defs.push(raw.replace(/^:\s+/u, "").trim());
      continue;
    }
    const line = raw.trim();
    if (line.length === 0) continue;
    if (seenDef) {
      const last = defs.length - 1;
      if (last < 0) return null;
      defs[last] = `${defs[last]} ${line}`;
      continue;
    }
    terms.push(line);
  }
  if (terms.length === 0 || defs.length === 0) return null;
  return { terms, defs };
};

const phrasing = (tag: string, value: string): MdNode => ({
  type: "paragraph",
  data: { hName: tag },
  children: [{ type: "text", value }]
});

const makeDl = (terms: string[], defs: string[]): MdNode => {
  const children: MdNode[] = [];
  if (terms.length === defs.length) {
    for (let index = 0; index < terms.length; index += 1) {
      children.push(phrasing("dt", terms[index] ?? ""), phrasing("dd", defs[index] ?? ""));
    }
  } else {
    children.push(
      ...terms.map((term) => phrasing("dt", term)),
      ...defs.map((def) => phrasing("dd", def))
    );
  }
  return {
    type: "paragraph",
    data: { hName: "dl" },
    children
  };
};

const parseParagraphDeflist = (node: MdNode): MdNode | null => {
  const text = toText(node);
  const parsed = parseExtraDeflist(text) ?? parseCjkGlossary(text);
  return parsed === null ? null : makeDl(parsed.terms, parsed.defs);
};

const transformContainer = (node: MdNode): void => {
  const children = node.children;
  if (children === undefined) return;
  for (const child of children) {
    if (
      child.type === "blockquote"
      || child.type === "listItem"
      || child.type === "footnoteDefinition"
    ) {
      transformContainer(child);
    }
  }
  const next: MdNode[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const current = children[index];
    if (current === undefined) continue;
    if (current.type === "paragraph") {
      const parsed = parseParagraphDeflist(current);
      if (parsed !== null) {
        next.push(parsed);
        continue;
      }
    }
    const following = children[index + 1];
    if (
      current.type === "paragraph"
      && following?.type === "paragraph"
      && startsWithColonDefinition(following)
    ) {
      const terms = [toText(current).trim()].filter((term) => term.length > 0);
      const defs: string[] = [];
      let cursor = index + 1;
      while (cursor < children.length) {
        const colonPara = children[cursor];
        if (
          colonPara === undefined
          || colonPara.type !== "paragraph"
          || !startsWithColonDefinition(colonPara)
        ) {
          break;
        }
        defs.push(toText(colonPara).replace(/^:\s+/u, "").trim());
        cursor += 1;
      }
      if (terms.length > 0 && defs.length > 0) {
        next.push(makeDl(terms, defs));
        index = cursor - 1;
        continue;
      }
    }
    next.push(current);
  }
  node.children = next;
};

export const remarkDefinitionLists = () => (tree: MdNode) => {
  transformContainer(tree);
};

const EXTRA_TAGS = ["font", "mark", "u", "abbr"] as const;

const unique = <T,>(items: readonly T[]): T[] => [...new Set(items)];

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? value as Record<string, unknown> : {};

const buildSanitizeSchema = (): typeof defaultSchema => {
  const overlay = asRecord(
    Array.isArray(defaultRehypePlugins.sanitize) ? defaultRehypePlugins.sanitize[1] : undefined
  );
  const baseTags = Array.isArray(overlay.tagNames)
    ? overlay.tagNames as string[]
    : defaultSchema.tagNames ?? [];
  const baseAttributes = {
    ...defaultSchema.attributes,
    ...asRecord(overlay.attributes)
  } as NonNullable<typeof defaultSchema.attributes>;
  const divAttrs = baseAttributes.div;
  return {
    ...defaultSchema,
    ...overlay,
    tagNames: unique([...baseTags, ...EXTRA_TAGS]),
    attributes: {
      ...baseAttributes,
      span: ["className", "style"],
      div: unique([
        ...(Array.isArray(divAttrs) ? divAttrs.filter((item): item is string => typeof item === "string") : []),
        "className"
      ]),
      font: ["color"],
      mark: ["className"],
      u: [],
      abbr: ["title"]
    }
  };
};

export const lyraRemarkPlugins: NonNullable<StreamdownProps["remarkPlugins"]> = [
  ...Object.values(defaultRemarkPlugins),
  remarkGemoji,
  remarkDefinitionLists
];

export const lyraRehypePlugins: NonNullable<StreamdownProps["rehypePlugins"]> = [
  defaultRehypePlugins.raw,
  [rehypeSanitize, buildSanitizeSchema()],
  rehypeSafeInlineColors,
  defaultRehypePlugins.harden
];
