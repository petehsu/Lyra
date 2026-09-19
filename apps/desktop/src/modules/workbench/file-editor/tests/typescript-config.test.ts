import { describe, expect, test } from "vitest";

import {
  isTypeScriptConfigPath,
  literalIncludeFilesFromTsconfig
} from "../typescript-config";

describe("typescript config paths", () => {
  test("recognizes tsconfig and jsconfig names", () => {
    expect(isTypeScriptConfigPath("/work/apps/desktop/tsconfig.json")).toBe(true);
    expect(isTypeScriptConfigPath("/work/jsconfig.json")).toBe(true);
    expect(isTypeScriptConfigPath("/work/tsconfig.app.json")).toBe(true);
    expect(isTypeScriptConfigPath("/work/package.json")).toBe(false);
    expect(isTypeScriptConfigPath("/work/src/index.ts")).toBe(false);
  });

  test("keeps only non-glob include files", () => {
    expect(literalIncludeFilesFromTsconfig(`{
      "include": ["src/**/*.ts", "electron.vite.config.ts", "vitest.config.ts"]
    }`)).toEqual(["electron.vite.config.ts", "vitest.config.ts"]);
  });
});
