import { describe, expect, test } from "vitest";
import type { HighlightOptions } from "streamdown";

import { lyraCodePlugin } from "./code-plugin";

type Result = NonNullable<ReturnType<typeof lyraCodePlugin.highlight>>;
const highlight = (code: string, language = "typescript") => new Promise<Result>((resolve) => {
  const result = lyraCodePlugin.highlight({
    code, language: language as HighlightOptions["language"], themes: lyraCodePlugin.getThemes()
  }, resolve);
  if (result !== null) resolve(result);
});
const source = (result: Result) => result.tokens.map((line) => line.map((token) => token.content).join("")).join("\n");

describe("shared code highlighter", () => {
  test("preserves source and both theme colors through the WASM engine", async () => {
    const code = 'const value = `你好\n${1 + 2}`;\n/* comment\nend */\n';
    const result = await highlight(code);
    expect(source(result)).toBe(code);
    expect(result.tokens.flat().some((token) => token.htmlStyle?.["--shiki-dark"])).toBe(true);
    expect(await highlight(code)).toBe(result);
  });

  test("does not return stale text for same-length edits with identical ends", async () => {
    const padding = '// padding\n'.repeat(12);
    const oldCode = `${padding}const value = 12;\n${padding}`;
    const newCode = oldCode.replace('value = 12', 'value = 34');
    await highlight(oldCode);
    expect(source(await highlight(newCode))).toBe(newCode);
  });

  test("preserves unsupported languages and oversized lines as readable source", async () => {
    expect(source(await highlight('unknown\n  内容\n', 'not-a-language'))).toBe('unknown\n  内容\n');
    const code = `const value = "${'x'.repeat(20_000)}";\nconst after = true;`;
    expect(source(await highlight(code))).toBe(code);
  });

  test("bounds cached documents instead of retaining every past revision", async () => {
    const first = await highlight('const evicted = 0;');
    for (let index = 0; index < 17; index += 1) await highlight(`const cached${index} = ${index};`);
    expect(await highlight('const evicted = 0;')).not.toBe(first);
  });
});
