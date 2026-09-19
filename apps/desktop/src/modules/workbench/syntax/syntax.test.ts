import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { languageFromPath } from "./language-from-path";
import { LYRA_SYNTAX_DARK, syntaxHex } from "./palette";

const here = dirname(fileURLToPath(import.meta.url));

describe("languageFromPath", () => {
  test("maps common source extensions onto Monaco/Shiki language ids", () => {
    expect(languageFromPath("src/app.ts")).toBe("typescript");
    expect(languageFromPath("src/app.tsx")).toBe("typescript");
    expect(languageFromPath("main.rs")).toBe("rust");
    expect(languageFromPath("script.py")).toBe("python");
    expect(languageFromPath("pkg/mod.go")).toBe("go");
    expect(languageFromPath("schema.prisma")).toBe("prisma");
    expect(languageFromPath("Dockerfile")).toBe("dockerfile");
    expect(languageFromPath("unknown.bin")).toBe("plaintext");
  });
});

describe("syntax palette", () => {
  test("strips hash for Monaco token foregrounds", () => {
    expect(syntaxHex(LYRA_SYNTAX_DARK.keyword)).toBe("c678dd");
  });

  test("chat and source CSS actually paint Shiki token variables", () => {
    const css = readFileSync(
      resolve(here, "../../../renderer/styles/agents.scss"),
      "utf8"
    );
    expect(css).toContain("color: var(--sdm-c, inherit);");
    expect(css).toContain("color: var(--shiki-dark, var(--sdm-c, inherit));");
  });
});
