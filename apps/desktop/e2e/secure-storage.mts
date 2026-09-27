import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { buildSync } = createRequire(require.resolve("vite"))("esbuild");
const electron = require("electron") as string;
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "lyra-secure-storage-"));
const entry = join(temporaryRoot, "probe.cjs");
mkdirSync(join(temporaryRoot, "profile"));

// This opt-in check reads saved ciphertext through the production agent-fill
// resolver. It never prints, sends, or persists decrypted values. Default mode
// exercises only a synthetic in-memory encryption round trip.
buildSync({
  stdin: {
    resolveDir: desktopRoot,
    contents: `
      import { app, safeStorage } from "electron";
      import { readFileSync } from "node:fs";
      import { homedir } from "node:os";
      import { join } from "node:path";
      import { configureLinuxSecretStore } from "./src/main/sensitive-values/linux-secret-store";
      import { createSensitiveStorageAccess } from "./src/main/sensitive-values/storage-access";
      import { createSensitiveValuesIpcBridge } from "./src/main/sensitive-values/service";
      import { createOpaqueSensitiveValueRef } from "./src/shared/sensitive-value";
      import { LYRA_APP_NAME } from "./src/main/app-identity";
      app.setName(LYRA_APP_NAME);
      app.setPath("userData", process.env.LYRA_STORAGE_TEST_DIR);
      app.disableHardwareAcceleration();
      const configured = configureLinuxSecretStore(app);
      app.whenReady().then(async () => {
        const access = createSensitiveStorageAccess(safeStorage);
        const status = access.readStatus();
        if (!status.available) throw new Error("No secure keyring available for this integration check");
        const fixture = "lyra-storage-regression-fixture";
        if (access.decrypt(access.encrypt(fixture)) !== fixture) throw new Error("Fixture round trip failed");
        let verified = 0, skippedFixtures = 0, failed = 0;
        if (process.env.LYRA_STORAGE_VERIFY_SAVED === "1") {
          const file = join(homedir(), ".lyra", "agent", "sensitive-values.json");
          const before = readFileSync(file, "utf8");
          const records = JSON.parse(before).values;
          const bridge = createSensitiveValuesIpcBridge({ loginManager: {} });
          for (const record of records) {
            const bytes = Buffer.from(record.ciphertextBase64, "base64");
            // Old unit tests left mock ciphertext in some development stores.
            // Such records are not Electron-encrypted credentials.
            if (bytes.subarray(0, 10).toString() === "encrypted:") { skippedFixtures++; continue; }
            const ref = createOpaqueSensitiveValueRef({
              id: record.id, owner: record.owner, valueKind: record.valueKind,
              label: "Stored credential verification", displayHint: "hidden",
              ownerName: "sensitive-values", capabilities: record.capabilities
            });
            try {
              if ((await bridge.resolveForAgentFill(ref)).length > 0) verified++;
              else failed++;
            } catch { failed++; }
          }
          bridge.dispose();
          if (readFileSync(file, "utf8") !== before) throw new Error("Saved credential file changed during the read-only check");
        }
        console.log("LYRA_STORAGE_RESULT " + JSON.stringify({ ...status, configured, verified, skippedFixtures, failed }));
        app.exit(failed > 0 ? 1 : 0);
      }).catch(() => { console.error("Secure storage integration check failed; no credential values logged."); app.exit(1); });
    `
  },
  outfile: entry, bundle: true, platform: "node", format: "cjs", packages: "external",
  banner: { js: 'process.on("uncaughtException", () => { console.error("Secure storage integration startup failed."); require("electron").app.exit(1); });' },
  define: { "import.meta.url": JSON.stringify(pathToFileURL(entry).href) },
  logLevel: "silent"
});
try {
  const env = { ...process.env, LYRA_STORAGE_TEST_DIR: join(temporaryRoot, "profile"),
    LYRA_STORAGE_VERIFY_SAVED: process.argv.includes("--verify-saved") ? "1" : "0" };
  delete env.ELECTRON_RUN_AS_NODE;
  const output = execFileSync(electron, [entry], {
    env, encoding: "utf8", timeout: 20_000, killSignal: "SIGKILL", stdio: ["ignore", "pipe", "pipe"]
  });
  const result = output.split("\n").find(line => line.startsWith("LYRA_STORAGE_RESULT "));
  assert(result, "Electron did not return a capability result");
  console.log(result);
} catch (error) {
  const failure = error as { code?: string; status?: number; signal?: string; stderr?: string };
  console.error(JSON.stringify({ code: failure.code, status: failure.status, signal: failure.signal }));
  const output = (error as { stdout?: string }).stdout ?? "";
  const result = output.split("\n").find(line => line.startsWith("LYRA_STORAGE_RESULT "));
  if (result) console.log(result);
  console.error("Secure storage integration check failed. No credential contents were logged.");
  process.exitCode = 1;
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
