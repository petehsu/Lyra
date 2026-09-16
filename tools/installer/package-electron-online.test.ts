import assert from "node:assert/strict";
import test from "node:test";

import {
  ELECTRON_ONLINE_HAS_SIZE_LIMIT,
  resolveElectronOnlinePlan
} from "./package-electron-online.ts";

test("Mac/Windows/AppImage first downloads are Electron shells without the 25 MiB gate", () => {
  assert.equal(ELECTRON_ONLINE_HAS_SIZE_LIMIT, false);
  assert.deepEqual(resolveElectronOnlinePlan("darwin-arm64").builderArgs, ["--mac", "dmg"]);
  assert.deepEqual(resolveElectronOnlinePlan("windows-x64").builderArgs, ["--win", "portable"]);
  assert.equal(resolveElectronOnlinePlan("linux-x64").extension, "AppImage");
  assert.throws(() => resolveElectronOnlinePlan("linux-riscv64"));
});
