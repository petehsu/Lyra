// Native provider stream -> production StreamStore/ChatView -> browser paint.
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/postcss';

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(desktop, '../..');
const fixture = resolve(desktop, 'e2e/gui-performance');
const outDir = resolve(repo, 'tmp/agent-latency/ui-dist');
if (!process.argv.includes('--no-build')) await build({ root: fixture, configFile: false, plugins: [react()], logLevel: 'warn',
  resolve: { alias: {
    react: resolve(desktop, 'node_modules/react'), 'react-dom': resolve(desktop, 'node_modules/react-dom'),
    '@renderer': resolve(desktop, 'src/renderer'), '@workbench': resolve(desktop, 'src/modules/workbench'),
    '@lyra/app-runtime': resolve(repo, 'packages/app-runtime/src/index.ts')
  }, dedupe: ['react', 'react-dom'] },
  css: { postcss: { plugins: [tailwind()] } },
  build: { target: 'esnext', outDir, emptyOutDir: true, reportCompressedSize: false, chunkSizeWarningLimit: 20_000 }
});
const server = await preview({ root: fixture, configFile: false, build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
try {
  const child = spawn(process.execPath, [resolve(repo, 'tools/diagnostics/agent-latency.mjs'), 'sparse-text'], {
    cwd: repo, env: { ...process.env, LYRA_AUDIT_UI_URL: `http://127.0.0.1:${server.httpServer.address().port}` }, stdio: 'inherit'
  });
  const code = await new Promise((done, reject) => { child.once('error', reject); child.once('exit', done); });
  if (code !== 0) throw new Error(`Native to UI latency check failed (${code})`);
} finally { await new Promise(done => server.httpServer.close(done)); }
