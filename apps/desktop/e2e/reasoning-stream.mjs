// Frozen action: open an in-progress thinking snapshot, then receive new text.
// Uses production ChatView and StreamStore; no provider or user data is loaded.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import { chromium } from 'playwright';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(desktop, '../..');
const phase = process.argv.includes('--before') ? 'before' : 'after';
const output = resolve(repo, 'tmp/agent-reasoning-ui');
await mkdir(output, { recursive: true });
await build({
  root: resolve(desktop, 'e2e/gui-performance'), configFile: false, plugins: [react()], logLevel: 'warn',
  resolve: { alias: {
    react: resolve(desktop, 'node_modules/react'), 'react-dom': resolve(desktop, 'node_modules/react-dom'),
    '@renderer': resolve(desktop, 'src/renderer'), '@workbench': resolve(desktop, 'src/modules/workbench'),
    '@lyra/app-runtime': resolve(repo, 'packages/app-runtime/src/index.ts')
  }, dedupe: ['react', 'react-dom'] },
  css: { postcss: { plugins: [tailwind()] } },
  build: { target: 'esnext', outDir: resolve(output, 'dist'), emptyOutDir: true, reportCompressedSize: false, chunkSizeWarningLimit: 20_000 }
});
const server = await preview({ configFile: false, root: resolve(desktop, 'e2e/gui-performance'), build: { outDir: resolve(output, 'dist') }, preview: { host: '127.0.0.1', port: 0 } });
let browser;
const result = { phase, passed: false, environment: 'Production ChatView build in Chromium; synthetic snapshot and deltas', updates: [] };
try {
  browser = await chromium.launch({ executablePath: process.env.LYRA_UI_TEST_BROWSER, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.waitForFunction(() => window.audit, undefined, { timeout: 60_000 });
  await page.evaluate(() => window.audit.reasoningSnapshot('已读取快照。'));
  await page.locator('.lyra-agents-tool-group-head').click();
  await page.locator('.lyra-agents-tool-call-twist').click();
  const body = page.locator('.lyra-agents-thinking-body');
  assert.equal(await body.textContent(), '已读取快照。');
  await page.evaluate(() => { window.thinkingNode = document.querySelector('.lyra-agents-thinking-body'); });
  let expected = '已读取快照。';
  for (const delta of ['新的思考正在到达。', '继续更新。']) {
    expected += delta;
    const started = Date.now();
    await page.evaluate(delta => window.audit.appendReasoning(delta), delta);
    await page.waitForFunction(expected => document.querySelector('.lyra-agents-thinking-body')?.textContent === expected, expected, { timeout: 2_000 }).catch(() => {});
    const actual = await body.textContent();
    result.updates.push({ expected, actual, observedAfterMs: Date.now() - started });
    await page.screenshot({ path: resolve(output, `${phase}.png`) });
    assert.equal(actual, expected, 'expanded reasoning must continue after loading a running snapshot');
    assert.equal(await page.evaluate(() => window.thinkingNode === document.querySelector('.lyra-agents-thinking-body')), true);
  }
  result.passed = true;
} catch (error) {
  result.error = String(error);
  throw error;
} finally {
  await writeFile(resolve(output, `${phase}.json`), JSON.stringify(result, null, 2) + '\n');
  await browser?.close();
  await new Promise(done => server.httpServer.close(done));
}
