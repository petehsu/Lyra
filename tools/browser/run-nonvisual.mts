/** One command for production browser mechanics. Uses isolated local fixtures,
 * no accounts, screenshots, model tokens, or website business APIs. */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const desktop = join(root, "apps/desktop");
const requireDesktop = createRequire(join(desktop, "package.json"));
const requireVite = createRequire(requireDesktop.resolve("vite"));
const { build } = requireVite("esbuild");
const electron = requireDesktop("electron") as string;
const output = await mkdtemp(join(tmpdir(), "lyra-nonvisual-audit-"));
const profiles = join(output, "profiles");
await mkdir(profiles);
const results: object[] = [];
let failed = false;
console.log(`Browser audit logs: ${output}`);

const run = async (name: string, command: string, args: string[], minimumCases: number) => {
  const path = join(output, `${name}.log`);
  const stream = createWriteStream(path);
  const started = Date.now();
  console.log(`Running ${name}`);
  let timedOut = false;
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, TMPDIR: profiles }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(stream, {end:false});
    child.stderr.pipe(stream, {end:false});
    const timeout = setTimeout(() => {timedOut=true;child.kill("SIGTERM");}, 600_000);
    child.on("error", error => {clearTimeout(timeout);reject(error);});
    child.on("close", code => {clearTimeout(timeout);resolve(code ?? 1);});
  }).finally(() => new Promise<void>(resolve => stream.end(resolve)));
  const log = await readFile(path, "utf8");
  const passedCases = log.split("\n").filter(line => {
    try {return JSON.parse(line).passed === true;} catch {return false;}
  }).length;
  // A crashed/early-exiting Electron can return zero without reaching the end.
  const passed = code === 0 && !timedOut && passedCases >= minimumCases;
  failed ||= !passed;
  const result = {name,passed,passedCases,code,timedOut,elapsedMs:Date.now()-started,log:path};
  results.push(result);
  console.log(JSON.stringify(result));
};

try {
  for (const [name, minimum] of [["native-browser-input",21],["native-browser-upload",15],["native-browser-capabilities",18],["native-workspace-focus",12]] as const) {
    const bundle = join(output, `${name}.cjs`);
    await build({entryPoints:[join(desktop,"e2e",`${name}.mts`)],bundle:true,platform:"node",format:"cjs",external:["electron"],outfile:bundle});
    await run(name, electron, ["--no-sandbox",bundle], minimum);
  }
  await run("nonvisual-browser", process.execPath, ["--import","tsx",join(desktop,"e2e/nonvisual-browser.mts")], 87);
} catch (error) {
  failed=true;
  results.push({name:"runner",passed:false,error:String(error)});
  throw error;
} finally {
  await writeFile(join(output,"summary.json"),JSON.stringify({passed:!failed,results},null,2));
  await rm(profiles,{recursive:true,force:true});
}
if (failed) process.exitCode=1;
