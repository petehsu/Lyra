import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  isTypeScriptConfigFileName,
  listTypeScriptConfigPaths
} from "../tsconfig-project-scan";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const makeRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lyra-tsconfig-scan-"));
  tempRoots.push(root);
  return root;
};

describe("listTypeScriptConfigPaths", () => {
  test("recognizes tsconfig and jsconfig names", () => {
    expect(isTypeScriptConfigFileName("tsconfig.json")).toBe(true);
    expect(isTypeScriptConfigFileName("jsconfig.json")).toBe(true);
    expect(isTypeScriptConfigFileName("tsconfig.app.json")).toBe(true);
    expect(isTypeScriptConfigFileName("package.json")).toBe(false);
  });

  test("finds nested configs and skips node_modules and tmp-test", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "apps", "desktop"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", "dep"), { recursive: true });
    fs.mkdirSync(path.join(root, ".tmp-test"), { recursive: true });
    fs.writeFileSync(path.join(root, "tsconfig.json"), "{}");
    fs.writeFileSync(path.join(root, "apps", "desktop", "tsconfig.json"), "{}");
    fs.writeFileSync(path.join(root, "apps", "desktop", "tsconfig.build.json"), "{}");
    fs.writeFileSync(path.join(root, "node_modules", "dep", "tsconfig.json"), "{}");
    fs.writeFileSync(path.join(root, ".tmp-test", "tsconfig.json"), "{}");

    const found = listTypeScriptConfigPaths(root).map((filePath) =>
      path.relative(root, filePath).split(path.sep).join("/")
    );
    expect(found.sort()).toEqual([
      "apps/desktop/tsconfig.build.json",
      "apps/desktop/tsconfig.json",
      "tsconfig.json"
    ]);
  });
});
