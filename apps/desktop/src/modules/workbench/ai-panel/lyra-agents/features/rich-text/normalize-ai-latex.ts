const FENCE_OPEN = /^(\s{0,3})(`{3,}|~{3,})(.*)$/u;
const FENCE_CLOSE = /^(\s{0,3})(`{3,}|~{3,})\s*$/u;
const MATH_FENCE_INFO = /^(?:math|katex)\b/iu;
const KATEX_ENVIRONMENT =
  /\\begin\{(align\*?|aligned|alignedat\*?|equation\*?|gather\*?|gathered|multline\*?|eqnarray\*?|cases|dcases|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|split)\}/u;

const isEscapedAt = (source: string, index: number): boolean => {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
};

const indexOfUnescaped = (source: string, needle: string, from: number): number => {
  let index = from;
  while (index < source.length) {
    const found = source.indexOf(needle, index);
    if (found < 0) {
      return -1;
    }
    if (!isEscapedAt(source, found)) {
      return found;
    }
    index = found + needle.length;
  }
  return -1;
};

const isInsideDisplayMath = (text: string): boolean => {
  let open = false;
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("$$", index) && isEscapedAt(text, index) === false) {
      open = !open;
      index += 2;
      continue;
    }
    index += 1;
  }
  return open;
};

const looksLikeLatexBody = (body: string): boolean =>
  /\\[a-zA-Z]+|[_^&=+\-*/]/u.test(body);

const replaceDelimited = (
  source: string,
  open: string,
  close: string,
  wrap: (body: string, start: number) => string | null
): string => {
  let cursor = 0;
  let result = "";
  while (cursor < source.length) {
    const start = indexOfUnescaped(source, open, cursor);
    if (start < 0) {
      result += source.slice(cursor);
      break;
    }
    const end = indexOfUnescaped(source, close, start + open.length);
    if (end < 0) {
      result += source.slice(cursor);
      break;
    }
    const replaced = wrap(source.slice(start + open.length, end), start);
    if (replaced === null) {
      result += source.slice(cursor, start + open.length);
      cursor = start + open.length;
      continue;
    }
    result += source.slice(cursor, start);
    result += replaced;
    cursor = end + close.length;
  }
  return result;
};

const wrapBareEnvironments = (source: string): string => {
  let cursor = 0;
  let result = "";
  while (cursor < source.length) {
    const begin = source.indexOf("\\begin{", cursor);
    if (begin < 0) {
      result += source.slice(cursor);
      break;
    }
    if (isEscapedAt(source, begin)) {
      result += source.slice(cursor, begin + 7);
      cursor = begin + 7;
      continue;
    }
    const match = KATEX_ENVIRONMENT.exec(source.slice(begin));
    if (match === null || match.index !== 0) {
      result += source.slice(cursor, begin + 7);
      cursor = begin + 7;
      continue;
    }
    const name = match[1] ?? "";
    const endToken = `\\end{${name}}`;
    const end = source.indexOf(endToken, begin + match[0].length);
    if (end < 0) {
      result += source.slice(cursor);
      break;
    }
    result += source.slice(cursor, begin);
    const body = source.slice(begin, end + endToken.length);
    result += isInsideDisplayMath(result) ? body : `$$\n${body}\n$$`;
    cursor = end + endToken.length;
  }
  return result;
};

const normalizeLatexChunk = (source: string): string => {
  const display = replaceDelimited(source, "\\[", "\\]", (body, start) => {
    const trimmed = body.trim();
    const atLineStart = start === 0 || source[start - 1] === "\n";
    if (atLineStart === false && looksLikeLatexBody(trimmed) === false) {
      return null;
    }
    return `$$\n${trimmed}\n$$`;
  });
  const inline = replaceDelimited(display, "\\(", "\\)", (body) => `$${body.trim()}$`);
  return wrapBareEnvironments(inline);
};

const INLINE_CODE = /(`+)([\s\S]*?)\1/g;

const normalizeOutsideInlineCode = (source: string): string => {
  let result = "";
  let cursor = 0;
  for (const match of source.matchAll(INLINE_CODE)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      result += normalizeLatexChunk(source.slice(cursor, index));
    }
    result += match[0];
    cursor = index + match[0].length;
  }
  if (cursor < source.length) {
    result += normalizeLatexChunk(source.slice(cursor));
  }
  return result;
};

const fenceInfo = (raw: string): string => raw.trim().split(/\s+/u)[0] ?? "";

/**
 * Map AI TeX delimiters onto remark-math / KaTeX (`$`, `$$`) without touching
 * fenced or inline code. Streamdown's math plugin is the renderer; this only
 * accepts the extra dialects models actually emit.
 */
export const normalizeAiLatex = (source: string): string => {
  const lines = source.split("\n");
  const out: string[] = [];
  let fence: { readonly marker: string; readonly length: number; readonly math: boolean } | null = null;
  let mathFence: string[] | null = null;
  let textBuf: string[] = [];

  const flushText = (): void => {
    if (textBuf.length === 0) {
      return;
    }
    out.push(normalizeOutsideInlineCode(textBuf.join("\n")));
    textBuf = [];
  };

  for (const line of lines) {
    if (fence !== null) {
      const close = FENCE_CLOSE.exec(line);
      const closed =
        close !== null
        && (close[2]?.[0] ?? "") === fence.marker
        && (close[2]?.length ?? 0) >= fence.length;
      if (fence.math) {
        if (closed) {
          const body = (mathFence ?? []).join("\n").trim();
          out.push(body.length === 0 ? "$$" : `$$\n${body}\n$$`);
          fence = null;
          mathFence = null;
          continue;
        }
        mathFence?.push(line);
        continue;
      }
      out.push(line);
      if (closed) {
        fence = null;
      }
      continue;
    }

    const open = FENCE_OPEN.exec(line);
    const marker = open?.[2] ?? "";
    if (open !== null && marker.length > 0) {
      const info = open[3] ?? "";
      const fenceChar = marker[0] ?? "";
      if (fenceChar.length > 0 && !info.includes(fenceChar)) {
        flushText();
        const math = MATH_FENCE_INFO.test(fenceInfo(info));
        fence = { marker: fenceChar, length: marker.length, math };
        mathFence = math ? [] : null;
        if (!math) {
          out.push(line);
        }
        continue;
      }
    }

    textBuf.push(line);
  }

  if (fence?.math === true) {
    out.push("```math");
    if (mathFence !== null && mathFence.length > 0) {
      out.push(mathFence.join("\n"));
    }
  }
  flushText();
  return out.join("\n");
};
