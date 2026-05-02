import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  nativeImage: {
    createFromPath: vi.fn(() => ({
      isEmpty: () => false
    }))
  }
}));

import {
  LYRA_APP_NAME,
  LYRA_APP_USER_MODEL_ID,
  resolveExistingPathForTests
} from "./app-identity";

const tempDirs: string[] = [];

const createTempDir = (): string => {
  const tempDir = mkdtempSync(join(tmpdir(), "lyra-app-identity-"));
  tempDirs.push(tempDir);
  return tempDir;
};

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("app identity", () => {
  test("uses the Lyra product identity", () => {
    expect(LYRA_APP_NAME).toBe("Lyra");
    expect(LYRA_APP_USER_MODEL_ID).toBe("dev.lyra.desktop");
  });

  test("resolves the first existing app icon candidate", () => {
    const tempDir = createTempDir();
    const missing = join(tempDir, "missing.png");
    const expected = join(tempDir, "lyra.png");
    const fallback = join(tempDir, "fallback.png");
    writeFileSync(expected, "");
    writeFileSync(fallback, "");

    expect(resolveExistingPathForTests([missing, expected, fallback])).toBe(expected);
  });

  test("returns null when no app icon candidate exists", () => {
    const tempDir = createTempDir();

    expect(resolveExistingPathForTests([join(tempDir, "missing.png")])).toBeNull();
  });
});
