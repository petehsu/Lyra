/** Isolated real Electron mechanics, including numbered screenshots and canvas input. */
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const requireDesktop = createRequire(join(root, "apps/desktop/package.json"));
const { build } = createRequire(requireDesktop.resolve("vite"))("esbuild");
const output = await mkdtemp(join(tmpdir(), "lyra-visual-audit-"));
const bundle = join(output, "test.cjs"),
  log = join(output, "result.log");
await build({
  entryPoints: [join(root, "apps/desktop/e2e/native-visual-browser.mts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outfile: bundle,
});
console.log("Visual browser audit: " + output);
const stream = createWriteStream(log);
const code = await new Promise<number>((resolve, reject) => {
  const child = spawn(requireDesktop("electron"), ["--no-sandbox", bundle], {
    cwd: root,
    env: { ...process.env, LYRA_VISUAL_TEST_OUTPUT: output },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(stream, { end: false });
  child.stderr.pipe(stream, { end: false });
  const timer = setTimeout(
    () => child.kill("SIGTERM"),
    process.env.LYRA_VISUAL_LIVE_INTERACTIVE === "1" ? 300000 : 120000,
  );
  child.on("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    resolve(code ?? 1);
  });
}).finally(() => new Promise<void>((resolve) => stream.end(resolve)));
const content = await readFile(log, "utf8");
console.log(content);
if (code !== 0 || !content.includes('"completed":true')) process.exitCode = 1;
