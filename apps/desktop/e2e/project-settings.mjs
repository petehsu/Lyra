import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(desktop, '../..');
const fixture = resolve(desktop, 'e2e/project-settings');
const output = resolve(repo, 'tmp/project-settings');
const temp = await mkdtemp(resolve(tmpdir(), 'lyra-project-settings-'));
const project = resolve(temp, 'Draft project');
const other = resolve(temp, 'Other project');
const skill = resolve(temp, 'review');
await Promise.all([mkdir(project), mkdir(other), mkdir(skill), mkdir(output, { recursive: true })]);
await writeFile(resolve(skill, 'SKILL.md'), '---\nname: review\ndescription: Review changes\n---\nReview this project.');
let child;
let sequence = 0;
const pending = new Map();
const streams = new Set();
const start = () => {
  child = spawn(resolve(repo, 'target/debug/examples/project_settings_fixture'), [], { env: { ...process.env, LYRA_AGENT_RUNTIME_HOME: resolve(temp, 'runtime') }, stdio: ['pipe', 'pipe', 'pipe'] });
  createInterface({ input: child.stdout }).on('line', (line) => {
    const value = JSON.parse(line);
    if (value.event) { for (const stream of streams) stream.write(`data: ${JSON.stringify(value.event)}\n\n`); return; }
    const entry = pending.get(value.id);
    if (entry) { clearTimeout(entry.timer); pending.delete(value.id); value.error ? entry.reject(new Error(value.error)) : entry.resolve(value.result); }
  });
  child.stderr.on('data', (data) => { if (String(data).includes('panicked')) console.error(String(data)); });
};
const rpc = (method, payload = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${method}`)); }, 30_000);
  pending.set(id, { resolve, reject, timer });
  child.stdin.write(`${JSON.stringify({ id, method, payload })}\n`);
});
const stop = () => new Promise((resolve) => { child.once('exit', resolve); child.stdin.end(); });
start();
const middleware = (server) => { server.middlewares.use(async (req, res, next) => {
  if (req.url === '/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); res.write(': ready\n\n'); streams.add(res); req.on('close', () => streams.delete(res)); return; }
  if (req.url === '/project') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ path: project })); return; }
  if (req.url !== '/rpc') return next();
  let body = ''; for await (const data of req) body += data;
  const { method, payload } = JSON.parse(body);
  try { res.end(JSON.stringify({ result: await rpc(method, payload) })); }
  catch (error) { res.end(JSON.stringify({ error: error.message })); }
}); };
let browser, server, page;
const results = [];
try {
  await rpc('agent.mcp.upsert', { id: 'fixture-server', name: 'Local MCP', command: 'never-started-by-settings', enabled: false });
  for (const enabled of [true, false]) {
    const updated = await rpc('agent.mcp.setEnabled', { serverId: 'fixture-server', enabled });
    assert.equal(updated.server.enabled, enabled);
    assert.equal(updated.server.state, 'disconnected');
  }
  results.push('Global MCP defaults update through the public runtime dispatcher without connecting.');
  await rpc('agent.skills.installFromLocal', { sourcePath: skill });
  await rpc('agent.skills.activate', { skillId: 'review' });
  const otherProject = (await rpc('agent.projects.register', { workingDir: other })).project;
  if (!process.argv.includes('--no-build')) await build({
    root: fixture, configFile: false, plugins: [react()], logLevel: 'warn',
    resolve: { alias: { react: resolve(desktop, 'node_modules/react'), 'react-dom': resolve(desktop, 'node_modules/react-dom'), '@renderer': resolve(desktop, 'src/renderer'), '@workbench': resolve(desktop, 'src/modules/workbench'), '@lyra/app-runtime': resolve(repo, 'packages/app-runtime/src/index.ts') }, dedupe: ['react', 'react-dom'] },
    css: { postcss: { plugins: [tailwind()] } },
    build: { target: 'esnext', outDir: resolve(output, 'dist'), emptyOutDir: true, reportCompressedSize: false, chunkSizeWarningLimit: 20_000 }
  });
  server = await preview({ root: fixture, configFile: false, plugins: [{ name: 'fixture-rpc', configurePreviewServer: middleware }], build: { outDir: resolve(output, 'dist') }, preview: { host: '127.0.0.1', port: 0 } });
  browser = await chromium.launch({ executablePath: process.env.LYRA_UI_TEST_BROWSER ?? '/opt/google/chrome-beta/chrome', headless: true, args: ['--no-sandbox'] });
  page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New project', exact: true }).click();
  await page.locator('.lyra-settings-section').getByRole('button', { name: 'Draft project', exact: true }).click();
  const mcp = page.getByRole('switch', { name: 'Local MCP' });
  await mcp.waitFor(); assert.equal(await mcp.isChecked(), false);
  await mcp.click(); await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true');
  const registered = (await rpc('agent.projects.list')).projects.find((item) => item.path === project);
  assert(registered); assert.equal((await rpc('agent.projects.settings', { projectId: otherProject.id })).mcp[0].enabled, false);
  results.push('Unsent composer project appears immediately; project can enable a globally disabled MCP without affecting another project.');
  await page.waitForTimeout(250);
  await page.screenshot({ path: resolve(output, 'projects-light.png') });
  await page.getByRole('tab', { name: 'MCP', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  const skillSwitch = page.getByRole('switch', { name: 'review', exact: true });
  await skillSwitch.waitFor(); assert.equal(await skillSwitch.isChecked(), true);
  await skillSwitch.click(); await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'false');
  results.push('Keyboard tab navigation and Skill override persist through the real backend.');
  await page.evaluate(() => window.projectsAudit.theme('dark'));
  await page.waitForTimeout(350);
  await page.screenshot({ path: resolve(output, 'projects-dark.png') });
  await stop(); start();
  const restored = await rpc('agent.projects.settings', { projectId: registered.id });
  assert.equal(restored.mcp[0].enabled, true); assert.equal(restored.skills[0].enabled, false);
  await page.getByRole('button', { name: 'Restore global default' }).click();
  await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'true');
  assert.equal((await rpc('agent.projects.settings', { projectId: registered.id })).skills[0].override, null);
  await page.getByRole('tab', { name: 'MCP', exact: true }).click();
  await page.getByRole('button', { name: 'Restore global default' }).click();
  await page.waitForFunction(() => document.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'false');
  const denied = await rpc('agent.mcp.executeTool', { serverId: 'fixture-server', toolName: 'stale-reference' }).then(() => false, () => true);
  assert(denied); results.push('Restart retains overrides; reset follows global defaults; disabled stale MCP call is rejected.');
  await rm(project, { recursive: true });
  await page.getByRole('button', { name: 'All projects' }).click(); await page.reload();
  await page.getByText(/Directory unavailable/).waitFor();
  assert.equal((await rpc('agent.projects.list')).projects.find((item) => item.id === registered.id).available, false);
  results.push('Missing directory remains listed as unavailable.');
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(JSON.stringify({ passed: results.length, results }, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
    await writeFile(resolve(output, 'failure.txt'), await page.locator('body').innerText().catch(() => 'Page unavailable'));
  }
  throw error;
} finally {
  await browser?.close();
  for (const stream of streams) stream.end();
  await new Promise((resolve) => server ? server.httpServer.close(resolve) : resolve());
  if (child?.exitCode === null) await stop();
  await rm(temp, { recursive: true, force: true });
}
