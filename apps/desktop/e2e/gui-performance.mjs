import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';
import { _electron as electron, chromium } from 'playwright';
import { checkRichText } from './gui-performance/rich-text-checks.mjs';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(desktop, '../..');
const fixture = resolve(desktop, 'e2e/gui-performance');
const output = resolve(repo, 'tmp/gui-performance');
const chromePath = process.env.LYRA_UI_TEST_BROWSER;
await mkdir(output, { recursive: true });
if (!process.argv.includes('--no-build')) {
  await build({
    root: fixture, configFile: false, plugins: [react()], logLevel: 'warn',
    resolve: {
      alias: {
        react: resolve(desktop, 'node_modules/react'), 'react-dom': resolve(desktop, 'node_modules/react-dom'),
        '@renderer': resolve(desktop, 'src/renderer'), '@workbench': resolve(desktop, 'src/modules/workbench'),
        '@lyra/app-runtime': resolve(repo, 'packages/app-runtime/src/index.ts')
      }, dedupe: ['react', 'react-dom']
    },
    css: { postcss: { plugins: [tailwind()] } },
    build: { target: 'esnext', minify: 'esbuild', outDir: resolve(output, 'dist'), emptyOutDir: true, reportCompressedSize: false, chunkSizeWarningLimit: 20_000 }
  });
}
const server = await preview({ root: fixture, configFile: false, build: { outDir: resolve(output, 'dist') }, preview: { host: '127.0.0.1', port: 0 } });
const url = `http://127.0.0.1:${server.httpServer.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'lyra-ui-perf-'));
let app;
let browser;
let page;
const errors = [];
const results = { environment: 'Production components and styles; synthetic session; empty workspace', passed: false, assertions: [], trials: [] };
try {
  if (chromePath) {
    browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url);
  } else {
    app = await electron.launch({ args: ['--no-sandbox', ...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []), resolve(fixture, 'electron-main.cjs'), `--fixture-url=${url}`, `--fixture-profile=${profile}`] });
    app.process().stderr?.on('data', (chunk) => { if (String(chunk).includes('Error')) console.error(String(chunk)); });
    page = await app.firstWindow({ timeout: 60_000 });
  }
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => window.audit);
  results.browser = await page.evaluate(() => navigator.userAgent);
  const scenario = async (count, kind = 'paragraphs', streaming = false) => {
    await page.evaluate(() => window.audit.scenario(0));
    await page.waitForTimeout(50);
    await page.evaluate(({ count, kind, streaming }) => window.audit.scenario(count, kind, streaming), { count, kind, streaming });
    await page.waitForFunction((count) => document.querySelectorAll('[data-chat-message-id]').length === count, count);
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))));
    await page.waitForTimeout(900);
  };
  const snapshot = () => page.evaluate(() => {
    const el = document.querySelector('.lyra-agents-chat-scroll');
    return { top: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight, anchor: el.style.overflowAnchor };
  });
  const captureReadingAnchor = () => page.evaluate(() => {
    const scroll = document.querySelector('.lyra-agents-chat-scroll');
    const y = scroll.getBoundingClientRect().top + 100;
    const slot = [...scroll.querySelectorAll('[data-chat-message-id]')].find((node) => node.getBoundingClientRect().bottom > y);
    window.readingAnchor = [...slot.querySelectorAll('p, h1, h2, h3, li')].find((node) => node.getBoundingClientRect().bottom > y);
    window.readingTop = window.readingAnchor.getBoundingClientRect().top;
  });
  const readingShift = () => page.evaluate(() => window.readingAnchor.getBoundingClientRect().top - window.readingTop);
  const scrollUp = async (delta) => {
    const bounds = await page.locator('.lyra-agents-chat-scroll').boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + Math.min(250, bounds.height / 2));
    await page.mouse.wheel(0, -delta);
    await page.waitForTimeout(500);
  };
  const drag = async (delta) => {
    const sash = await page.locator('.audit-sash').boundingBox();
    await page.mouse.move(sash.x + 3, 150);
    await page.mouse.down();
    await page.mouse.move(sash.x + 3 + delta, 150, { steps: 24 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  };
  await scenario(200);
  const initial = await snapshot();
  assert.ok(initial.gap < 2, `opens at bottom: ${JSON.stringify(initial)}`);
  await drag(150); await drag(-150);
  assert.ok((await snapshot()).gap < 2, 'follows bottom after width changes');
  results.assertions.push('200 loaded messages: bottom follow survives divider resize');
  await scrollUp(1700);
  await captureReadingAnchor();
  await drag(150); await drag(-150);
  const shift = await readingShift();
  assert.ok(Math.abs(shift) < 2, `history reading position shifted ${shift}px`);
  results.assertions.push('history reading anchor returns to the same pixel after resize');
  await page.evaluate(() => document.querySelector('[data-message-id="message-8"]').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(500);
  const selection = await page.evaluate(() => {
    const el = document.querySelector('[data-message-id="message-8"]');
    const text = el.querySelector('p'); const range = document.createRange(); range.selectNodeContents(text);
    const selected = getSelection(); selected.removeAllRanges(); selected.addRange(range);
    const result = { visible: el.checkVisibility({ contentVisibilityAuto: true }), expected: text.textContent, actual: selected.toString() };
    selected.removeAllRanges(); return result;
  });
  assert.ok(selection.visible); assert.equal(selection.actual, selection.expected);
  results.assertions.push('offscreen history reveals and selects complete text');
  await scenario(50, 'paragraphs', true);
  await scrollUp(1200);
  assert.equal((await snapshot()).anchor, 'auto', 'wheel up must pause follow');
  await captureReadingAnchor();
  await page.evaluate(() => window.audit.append('\n\n正在继续输出。'.repeat(100))); await page.waitForTimeout(400);
  assert.ok(Math.abs(await readingShift()) < 2, 'streaming moved the paragraph being read');
  results.assertions.push('incoming text does not steal history scroll position');
  await scenario(1, 'code', true);
  assert.equal(await page.locator('code span').count(), 0, 'streaming code must not create highlighted token DOM');
  await page.locator('.lyra-markdown-code-actions button').first().click();
  await page.evaluate(() => window.audit.append('\nconst finalMarker = "完整输出";\n```'));
  await page.waitForTimeout(80);
  await page.evaluate(() => window.audit.finish());
  assert.equal(await page.locator('.lyra-markdown-code-actions button').first().getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => document.querySelector('code span[style]'));
  assert.ok((await page.locator('code').textContent()).includes('finalMarker'));
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text) => { window.copiedCode = text; } } }));
  await page.locator('.lyra-markdown-code-actions button').nth(1).click();
  assert.equal(await page.evaluate(() => window.copiedCode), await page.evaluate(() => window.audit.source().replace(/^```typescript\n/, '').replace(/```$/, '')));
  results.assertions.push('stream completion preserves wrap control, full code and exact copy source');
  const sash = await page.locator('.audit-sash').boundingBox();
  await page.mouse.move(sash.x + 3, 150); await page.mouse.down(); await page.mouse.move(sash.x + 53, 150);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.mouse.up();
  assert.equal(await page.evaluate(() => document.body.classList.contains('lyra-layout-resizing')), false);
  results.assertions.push('interrupted drag cleans up interaction state');
  await scenario(50);
  results.beforeNativeResize = await snapshot();
  await page.evaluate(() => {
    window.resizeSamples = [];
    window.addEventListener('resize', () => window.resizeSamples.push({ time: performance.now(), width: innerWidth, height: innerHeight }));
  });
  for (const width of [1320, 1180, 1380, 1440]) {
    if (app) await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
    else await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(width => innerWidth === width && window.resizeSamples.some(sample => sample.width === width), width);
  }
  try {
    await page.waitForFunction(() => !document.body.classList.contains('lyra-window-resizing'), undefined, { timeout: 3000 });
  } catch (error) {
    results.nativeResizeFailure = await page.evaluate(() => ({ samples: window.resizeSamples, time: performance.now(), visibility: document.visibilityState }));
    throw error;
  }
  const afterNativeResize = await snapshot();
  results.afterNativeResize = afterNativeResize;
  results.nativeResizeSamples = await page.evaluate(() => window.resizeSamples);
  assert.ok(new Set(results.nativeResizeSamples.map((sample) => sample.width)).size >= 2, 'test host did not deliver viewport resize events');
  assert.ok(afterNativeResize.gap < 2, `native resize lost bottom follow: ${JSON.stringify({ before: results.beforeNativeResize, after: afterNativeResize })}`);
  results.assertions.push('native viewport resize settles and retains bottom follow');
  results.viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, devicePixelRatio }));
  await page.screenshot({ path: resolve(output, 'verified-history.png') });
  await checkRichText({ page, scenario, output, results });

  if (!process.argv.includes('--assertions-only')) {
    for (const item of [
      { count: 0 }, { count: 50 }, { count: 200 },
      { count: 1, kind: 'single', streaming: true },
      { count: 1, kind: 'code' }, { count: 1, kind: 'code', streaming: true }
    ]) {
      for (let repeat = 0; repeat < 2; repeat += 1) {
        await scenario(item.count, item.kind, item.streaming);
        const sash = await page.locator('.audit-sash').boundingBox();
        await page.mouse.move(sash.x + 3, 150); await page.mouse.down();
        await page.evaluate((item) => {
          window.gaps = []; window.auditRunning = true; let last = performance.now();
          const tick = (now) => { window.gaps.push(now - last); last = now; if (window.auditRunning) requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
          if (item.streaming) window.auditTimer = setInterval(() => window.audit.append(item.kind === 'code' ? '\nconst extra = "new content";' : ' 新的文字正在持续进入，面板仍需响应拖动。'), 16);
        }, item);
        for (let index = 0; index < 60; index += 1) {
          await page.mouse.move(460 + 130 * Math.sin(index / 59 * Math.PI * 4), 150);
          await page.waitForTimeout(8);
        }
        await page.mouse.up();
        const frames = await page.evaluate(() => {
          window.auditRunning = false; clearInterval(window.auditTimer);
          const sorted = window.gaps.slice(1).sort((a, b) => a - b);
          return { frames: sorted.length, p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) };
        });
        results.trials.push({ ...item, repeat, ...frames });
        console.log(JSON.stringify(results.trials.at(-1)));
      }
    }
  }
  assert.deepEqual(errors, [], 'renderer errors');
  results.passed = true;
  console.log(`Passed ${results.assertions.length} visible behavior checks.`);
} finally {
  results.errors = errors;
  if (!results.passed && page && !page.isClosed()) {
    try {
      results.failureState = await page.evaluate(() => {
        const el = document.querySelector('.lyra-agents-chat-scroll');
        return { width: innerWidth, height: innerHeight, visibility: document.visibilityState, classes: document.body.className, scroll: el && { top: el.scrollTop, height: el.scrollHeight, viewport: el.clientHeight, anchor: el.style.overflowAnchor, bounds: el.getBoundingClientRect().toJSON() } };
      });
      await page.screenshot({ path: resolve(output, 'failed-check.png') });
    } catch (error) {
      results.diagnosticError = String(error);
    }
  }
  await writeFile(resolve(output, chromePath ? 'chrome-results.json' : 'electron-results.json'), JSON.stringify(results, null, 2));
  await app?.close(); await browser?.close();
  await new Promise((done) => server.httpServer.close(done));
  await rm(profile, { recursive: true, force: true });
}
