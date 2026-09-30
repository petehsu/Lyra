// Controlled native-runtime audit. Requires:
// cargo build -p lyra-agent-runtime --example agent_latency_fixture
// node tools/diagnostics/agent-latency.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const binary = process.env.LYRA_AUDIT_BINARY ?? resolve(repo, 'target/debug/examples/agent_latency_fixture');
const output = resolve(repo, 'tmp/agent-latency', process.env.LYRA_AUDIT_UI_URL ? 'ui' : process.env.LYRA_AUDIT_PREWARM_TOKENIZER ? 'prewarmed' : '');
await mkdir(output, { recursive: true });
const measurements = [];
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const hash = (value) => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16);
const round = (value) => Math.round(value * 10) / 10;

async function scenario(mode, hostDelayMs = 0, turns = 1) {
  const anthropic = mode === 'tool-tail-anthropic';
  const responses = mode === 'tool-tail-responses';
  const toolTail = mode.startsWith('tool-tail');
  const root = await mkdtemp(resolve(tmpdir(), 'lyra-latency-'));
  const project = resolve(root, 'project');
  await mkdir(project);
  await writeFile(resolve(project, 'README.md'), 'Latency fixture. Only local synthetic data.\n');
  const timeline = [];
  const requests = [];
  const sockets = new Map();
  let currentTurn = 0;
  let turnRequestCount = 0;
  let t0 = performance.now();
  const mark = (type, detail = {}) => timeline.push({ ms: round(performance.now() - t0), turn: currentTurn, type, ...detail });
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (mode === 'auth-switch') assert.equal(req.headers.authorization, `Bearer synthetic-audit-key-${currentTurn}`,
      'Pooled transports must use the current request credentials');
    const requestIndex = requests.length;
    const socketId = sockets.get(req.socket);
    const auxiliary = body.stream !== true;
    requests.push({ index: requestIndex, turn: currentTurn, socketId, auxiliary, bytes: bytes(body),
      tools: body.tools?.length ?? 0, toolBytes: bytes(body.tools ?? []),
      messageBytes: bytes(body.messages ?? body.input ?? []), stream: body.stream,
      toolsHash: hash(body.tools ?? []), firstSystemHash: hash(body.system ?? body.instructions ?? body.messages?.[0]),
      toolNames: body.tools?.map((tool) => tool.function?.name ?? tool.name),
      messageRoles: body.messages?.map((m) => m.role),
      systemBytes: bytes(body.system ?? body.messages?.filter((m) => m.role === 'system') ?? []) });
    mark(auxiliary ? 'auxiliaryRequest' : 'request', { requestIndex, socketId });
    if (auxiliary) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(anthropic
        ? { id: `msg-${requestIndex}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: '{"candidates":[]}' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }
        : { choices: [{ message: { role: 'assistant', content: '{"candidates":[]}' }, finish_reason: 'stop' }] }));
      return;
    }
    turnRequestCount++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.flushHeaders();
    if (responses) {
      const event = (type, fields = {}) => res.write(`data: ${JSON.stringify({ type, ...fields })}\n\n`);
      let items;
      if (turnRequestCount === 1) {
        const item = { type: 'function_call', id: 'fc-read', call_id: 'audit-read', name: 'read_file', arguments: '' };
        event('response.output_item.added', { output_index: 0, item });
        item.arguments = JSON.stringify({ path: resolve(project, 'README.md') });
        event('response.function_call_arguments.delta', { output_index: 0, item_id: item.id, delta: item.arguments });
        event('response.output_item.done', { output_index: 0, item });
        items = [item];
        mark('toolArgumentsSent', { inputExplicitlyComplete: true });
        await sleep(800);
      } else {
        const text = 'OK. This is a sufficiently long deterministic streaming response.';
        event('response.output_text.delta', { delta: text });
        mark('firstProviderText');
        items = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }];
      }
      event('response.completed', { response: { id: `resp-${requestIndex}`, status: 'completed', output: items } });
      res.end(); mark('streamEnded', { requestIndex }); return;
    }
    if (anthropic) {
      const event = (type, fields = {}) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
      event('message_start', { message: { id: `msg-${requestIndex}`, type: 'message', role: 'assistant', content: [], model: 'claude-sonnet-4-5', usage: { input_tokens: 10, output_tokens: 0 } } });
      if (turnRequestCount === 1) {
        event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'audit-read', name: 'read_file', input: {} } });
        event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ path: resolve(project, 'README.md') }) } });
        event('content_block_stop', { index: 0 });
        mark('toolArgumentsSent', { inputExplicitlyComplete: true });
        await sleep(800);
      } else {
        event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
        event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'OK. This is a sufficiently long deterministic streaming response.' } });
        mark('firstProviderText');
        event('content_block_stop', { index: 0 });
      }
      event('message_delta', { delta: { stop_reason: turnRequestCount === 1 ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 20 } });
      event('message_stop');
      res.end();
      mark('streamEnded', { requestIndex });
      return;
    }
    const delta = (value) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: value }] })}\n\n`);
    if (mode === 'tool-tail' && turnRequestCount === 1) {
      delta({ tool_calls: [{ index: 0, id: 'audit-read', type: 'function', function: {
        name: 'read_file', arguments: JSON.stringify({ path: resolve(project, 'README.md') })
      } }] });
      mark('toolArgumentsSent');
      await sleep(800);
    } else if (mode === 'sparse-text') {
      delta({ content: 'Hi' });
      mark('firstProviderText');
      await sleep(600);
      delta({ content: ' there' });
    } else {
      delta({ content: 'OK. This is a sufficiently long deterministic streaming response.' });
      mark('firstProviderText');
    }
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: mode === 'tool-tail' && turnRequestCount === 1 ? 'tool_calls' : 'stop' }] })}\n\n`);
    res.end('data: [DONE]\n\n');
    mark('streamEnded', { requestIndex });
  });
  server.on('connection', (socket) => { sockets.set(socket, sockets.size + 1); socket.setNoDelay(true); });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const child = spawn(binary, [], { cwd: project, env: {
    ...process.env,
    LYRA_AGENT_RUNTIME_HOME: resolve(root, 'runtime'),
    LYRA_MCP_HOME: resolve(root, 'mcp'), LYRA_SKILLS_HOME: resolve(root, 'skills'),
    LYRA_AUDIT_HOST_DELAY_MS: String(hostDelayMs),
    NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost',
  }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  let browser; let page; let paints = Promise.resolve();
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const pending = new Map();
  let sequence = 0;
  let completed;
  createInterface({ input: child.stdout }).on('line', (line) => {
    const value = JSON.parse(line);
    if (value.host) { mark('host', value.host); return; }
    if (value.event) {
      const event = value.event;
      mark('event', { kind: event.kind, reason: event.reason, state: event.state,
        status: event.status, delta: event.delta, toolStatus: event.tool?.status,
        toolId: event.tool?.id });
      if (page && event.kind === 'messageDelta') {
        paints = paints.then(async () => {
          const browserRenderMs = await page.evaluate(async (delta) => {
            const received = performance.now();
            window.audit.append(delta);
            await new Promise((done) => {
              const observe = () => {
                if (document.querySelector('[data-chat-message-id]')?.textContent.includes(delta)) {
                  requestAnimationFrame(() => requestAnimationFrame(done));
                } else requestAnimationFrame(observe);
              };
              observe();
            });
            return performance.now() - received;
          }, event.delta);
          mark('textPainted', { browserRenderMs: round(browserRenderMs) });
        });
      }
      if (event.kind === 'turnFinished') completed?.(event);
      return;
    }
    const entry = pending.get(value.id);
    if (entry) { pending.delete(value.id); clearTimeout(entry.timer); value.error ? entry.reject(new Error(value.error)) : entry.resolve(value.result); }
  });
  const rpc = (method, payload = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${method}`)); }, 20_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, payload })}\n`);
  });
  try {
    if (process.env.LYRA_AUDIT_UI_URL) {
      const { chromium } = createRequire(resolve(repo, 'apps/desktop/package.json'))('playwright');
      browser = await chromium.launch({ executablePath: process.env.LYRA_UI_TEST_BROWSER, headless: true, args: ['--no-sandbox'] });
      page = await browser.newPage();
      await page.goto(process.env.LYRA_AUDIT_UI_URL);
      await page.waitForFunction(() => window.audit);
    }
    await rpc('agent.provider.profile.save', { profileName: 'audit-local', routeId: anthropic ? 'anthropic' : responses ? 'openai' : 'custom_openai_compatible',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, defaultModel: anthropic ? 'claude-sonnet-4-5' : 'gpt-4o', apiKey: mode === 'auth-switch' ? 'synthetic-audit-key-1' : 'synthetic-audit-key', setDefault: true });
    const startCreate = performance.now();
    const session = await rpc('agent.session.create', { title: 'Latency audit', workingDir: project });
    const createMs = round(performance.now() - startCreate);
    timeline.length = 0; t0 = performance.now();
    for (let i = 1; i <= turns; i++) {
      currentTurn = i; turnRequestCount = 0;
      if (mode === 'auth-switch' && i > 1) await rpc('agent.provider.profile.save', {
        profileName: 'audit-local', routeId: 'custom_openai_compatible', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        defaultModel: 'gpt-4o', apiKey: `synthetic-audit-key-${i}`, setDefault: true
      });
      let timer;
      const finished = new Promise((resolve, reject) => {
        completed = resolve;
        timer = setTimeout(() => reject(new Error('Turn timeout')), 25_000);
      });
      if (page) {
        await page.evaluate(() => window.audit.scenario(1, 'empty', true));
        await page.waitForFunction(() => document.querySelectorAll('[data-chat-message-id]').length === 1);
      }
      mark('send');
      await rpc('agent.turn.send', { sessionId: session.id, text: toolTail ? 'Read README.md and reply OK.' : 'Only reply OK.' });
      mark('sendAccepted');
      try { const event = await finished; assert.equal(event.status, 'finished', JSON.stringify(event)); }
      finally { clearTimeout(timer); completed = undefined; }
      await paints;
      if (page) await page.evaluate(() => window.audit.finish());
      await sleep(80);
    }
    assert(timeline.some((e) => e.kind === 'messageDelta'), 'Expected streamed text');
    if (toolTail) assert(timeline.some((e) => e.kind === 'toolFinished' && e.toolStatus === 'completed'), 'Expected a successful file read');
    const perTurn = Array.from({ length: turns }, (_, index) => {
      const events = timeline.filter((e) => e.turn === index + 1);
      const first = (predicate) => events.find(predicate)?.ms;
      const send = first((e) => e.type === 'send');
      const request = first((e) => e.type === 'request');
      const firstText = first((e) => e.type === 'firstProviderText');
      const delta = first((e) => e.kind === 'messageDelta');
      const toolStart = first((e) => e.kind === 'toolStarted');
      const toolFinish = first((e) => e.kind === 'toolFinished');
      const secondRequest = events.filter((e) => e.type === 'request')[1]?.ms;
      const toolArgs = first((e) => e.type === 'toolArgumentsSent');
      const finished = first((e) => e.kind === 'turnFinished');
      const diff = (a, b) => a === undefined || b === undefined ? null : round(a - b);
      return { turn: index + 1, sendAcceptedMs: diff(first(e => e.type === 'sendAccepted'), send), sendToRequestMs: diff(request, send),
        providerTextToPaintMs: diff(first(e => e.type === 'textPainted'), firstText),
        browserRenderMs: events.find(e => e.type === 'textPainted')?.browserRenderMs ?? null, providerTextToDeltaMs: diff(delta, firstText),
        toolArgsToStartMs: diff(toolStart, toolArgs), toolFinishedToRequestMs: diff(secondRequest, toolFinish),
        totalMs: diff(finished, send), hostCalls: events.filter((e) => e.type === 'host').length };
    });
    for (const turn of perTurn) {
      assert.equal(turn.hostCalls, 1, 'Turn setup must capture host metadata once');
      if (mode === 'sparse-text') {
        assert(turn.providerTextToDeltaMs < 250, 'Sparse text must not wait for the next chunk');
        if (page) {
          const events = timeline.filter(e => e.turn === turn.turn);
          assert(events.find(e => e.type === 'textPainted').ms < events.find(e => e.type === 'streamEnded').ms, 'Text must paint before the provider resumes');
        }
      }
      if (anthropic || responses) assert(turn.toolArgsToStartMs < 400, 'Complete read must overlap the provider tail');
      if (mode === 'tool-tail') assert(turn.toolArgsToStartMs >= 750, 'Parsable partial JSON is not a tool completion signal');
    }
    assert.equal(requests.filter(request => request.auxiliary).length, 0, 'Read-only turns must not invoke the memory model');
    assert.equal(sockets.size, 1, 'Sequential provider requests must reuse their connection');
    const result = { mode, hostDelayMs, createMs, perTurn, requests, connections: sockets.size, stderr, timeline };
    await writeFile(resolve(output, `${mode}-${hostDelayMs}.json`), JSON.stringify(result, null, 2));
    measurements.push({ mode, hostDelayMs, createMs, perTurn, requests, connections: sockets.size });
    console.log(JSON.stringify(measurements.at(-1), null, 2));
  } catch (error) {
    await writeFile(resolve(output, `${mode}-${hostDelayMs}-failure.json`), JSON.stringify({ timeline, requests, stderr }, null, 2));
    throw error;
  } finally {
    await browser?.close();
    child.stdin.end();
    if (child.exitCode === null) await new Promise((done) => { child.once('exit', done); const timer = setTimeout(() => child.kill(), 1500); timer.unref(); });
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  }
}

const cases = process.argv.slice(2);
if (!cases.length || cases.includes('baseline')) await scenario('baseline', 0, 3);
if (!cases.length || cases.includes('host-delay')) await scenario('baseline', 100, 3);
if (!cases.length || cases.includes('sparse-text')) await scenario('sparse-text', 0, 3);
if (!cases.length || cases.includes('tool-tail')) await scenario('tool-tail', 0, 3);
if (!cases.length || cases.includes('tool-tail-anthropic')) await scenario('tool-tail-anthropic', 0, 3);
if (!cases.length || cases.includes('tool-tail-responses')) await scenario('tool-tail-responses', 0, 3);
if (!cases.length || cases.includes('auth-switch')) await scenario('auth-switch', 0, 3);
await writeFile(resolve(output, 'results.json'), JSON.stringify({
  capturedAt: new Date().toISOString(), binary, tokenizerPrewarmed: !!process.env.LYRA_AUDIT_PREWARM_TOKENIZER,
  note: 'Synthetic local provider; native event receipt, not desktop paint time. Debug build.', measurements,
}, null, 2));
