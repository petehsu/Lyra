import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  collectTypeScriptConfigOptionDiagnostics,
  collectTypeScriptProjectFileDiagnostics,
  mapTsCategoryToLspSeverity,
  offsetToPosition
} from "../tsconfig-option-diagnostics";

const tsserverPath = path.resolve(
  __dirname,
  "../../../../../../web/docs/node_modules/typescript/lib/tsserver.js"
);

describe("tsconfig option diagnostics", () => {
  test("maps offsets and TS categories onto LSP", () => {
    expect(offsetToPosition("a\nb", 2)).toEqual({ line: 1, character: 0 });
    expect(mapTsCategoryToLspSeverity(1)).toBe(1);
    expect(mapTsCategoryToLspSeverity(0)).toBe(2);
  });

  test("reports TS 6 baseUrl deprecation on apps/desktop/tsconfig.json", () => {
    const filePath = path.resolve(__dirname, "../../../../tsconfig.json");
    const content = fs.readFileSync(filePath, "utf8");
    const items = collectTypeScriptConfigOptionDiagnostics(filePath, content, tsserverPath);
    const baseUrl = items.find((item) => item.message.includes("Option 'baseUrl' is deprecated"));
    expect(baseUrl).toMatchObject({
      source: "ts",
      code: "5101",
      severity: 1
    });
    const line = content.split("\n")[baseUrl?.startLine ?? -1] ?? "";
    expect(line.slice(baseUrl?.startCharacter ?? 0, baseUrl?.endCharacter ?? 0)).toBe('"baseUrl"');
  });

  const tempRoots: string[] = [];
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports source-file semantic errors without opening the file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lyra-ts-project-diag-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          module: "ESNext",
          moduleResolution: "bundler",
          target: "ES2022"
        },
        include: ["src/**/*.ts"]
      })
    );
    fs.writeFileSync(path.join(root, "src", "ok.ts"), "export const n: number = 1;\n");
    fs.writeFileSync(path.join(root, "src", "fail.ts"), "export const n: number = \"x\";\n");
    const configPath = path.join(root, "tsconfig.json");
    const groups = collectTypeScriptProjectFileDiagnostics(
      configPath,
      fs.readFileSync(configPath, "utf8"),
      tsserverPath
    );
    const fail = groups.find((group) => group.filePath.replaceAll("\\", "/").endsWith("/src/fail.ts"));
    expect(fail?.diagnostics.some((item) => item.message.includes("not assignable"))).toBe(true);
    expect(groups.some((group) => group.filePath.replaceAll("\\", "/").endsWith("/src/ok.ts"))).toBe(false);
  });
});
