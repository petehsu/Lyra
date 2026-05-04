import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../"
);
const afterPackLinux = require(
  path.join(repoRoot, "scripts/desktop/after-pack-linux.cjs")
) as (context: {
  readonly electronPlatformName: string;
  readonly appOutDir: string;
  readonly packager: {
    readonly executableName?: string;
    readonly appInfo: {
      readonly productFilename?: string;
      readonly productName: string;
    };
  };
}) => Promise<void>;

describe("linux afterPack launcher", () => {
  test("wraps the packaged Linux executable with one-shot recovery launch logic", async () => {
    const appOutDir = mkdtempSync(path.join(os.tmpdir(), "lyra-linux-pack-"));
    const executablePath = path.join(appOutDir, "Lyra");
    writeFileSync(executablePath, "#!/usr/bin/env bash\nexit 1\n", "utf8");

    await afterPackLinux({
      electronPlatformName: "linux",
      appOutDir,
      packager: {
        executableName: "Lyra",
        appInfo: {
          productFilename: "Lyra",
          productName: "Lyra"
        }
      }
    });

    expect(existsSync(path.join(appOutDir, "Lyra.bin"))).toBe(true);
    const launcher = readFileSync(executablePath, "utf8");
    expect(launcher).toContain("LYRA_LINUX_RECOVERY=1");
    expect(launcher).toContain("launch-health.json");
  });
});
