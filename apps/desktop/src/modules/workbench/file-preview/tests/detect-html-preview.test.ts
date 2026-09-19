import { describe, expect, test } from "vitest";

import { htmlPreviewPlanFromPackageJson } from "../detect-html-preview";

describe("htmlPreviewPlanFromPackageJson", () => {
  test("uses the package dev script for vite apps", () => {
    expect(htmlPreviewPlanFromPackageJson("/app", JSON.stringify({
      scripts: { dev: "vite" },
      devDependencies: { vite: "7.0.0" }
    }), true)).toEqual({
      kind: "command",
      cwd: "/app",
      command: "pnpm run dev",
      url: "http://127.0.0.1:5173"
    });
  });

  test("falls back to next when no dev script exists", () => {
    expect(htmlPreviewPlanFromPackageJson("/app", JSON.stringify({
      dependencies: { next: "15.0.0" }
    }), false)).toEqual({
      kind: "command",
      cwd: "/app",
      command: "pnpm exec next dev",
      url: "http://127.0.0.1:3000"
    });
  });

  test("returns null for packages without a preview command", () => {
    expect(htmlPreviewPlanFromPackageJson("/app", JSON.stringify({
      name: "lib"
    }), false)).toBeNull();
  });
});
