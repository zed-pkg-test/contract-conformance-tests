import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const sourceDir = process.env.ORES_SW_SOURCE;
const harnessDir = process.env.ORES_SW_HARNESS_DIR;
if (!sourceDir || !harnessDir) throw new Error('ORES_SW_SOURCE and ORES_SW_HARNESS_DIR are required');

const requireFromHarness = createRequire(path.join(harnessDir, 'package.json'));
const { WebSocketServer } = requireFromHarness('ws');
const { chromium } = requireFromHarness('playwright');

const distDir = path.join(sourceDir, 'dist');
for (const file of ['client.js', 'socket.shared-worker.js']) {
  assert.ok(fs.existsSync(path.join(distDir, file)), `missing built asset ${file}`);
}

const sockets = new Set();
const stats = {
  total_physical_opened: 0,
  active_physical: 0,
  max_active_physical: 0,
  stream_open_frames: 0,
  stream_close_frames: 0,
  mux_data_frames: 0,
  send_only_frames: 0,
  protocol_counts: new Map(),
  active_streams: new Set(),
};

function jsonStats() {
  return {
    total_physical_opened: stats.total_physical_opened,
    active_physical: stats.active_physical,
    max_active_physical: stats.max_active_physical,
    active_logical_streams: stats.active_streams.size,
    stream_open_frames: stats.stream_open_frames,
    stream_close_frames: stats.stream_close_frames,
    mux_data_frames: stats.mux_data_frames,
    send_only_frames: stats.send_only_frames,
    protocol_counts: Object.fromEntries(stats.protocol_counts),
  };
}

const testClientJs = `
import { createOresSharedSocket } from '/ores-workers/client.js';
const params = new URLSearchParams(location.search);
const poolKey = params.get('key') || 'session-a';
const mode = params.get('mode') || 'ores_mux_v1';
window.__ores = { opens: 0, reconnects: 0, messages: [], closes: [], errors: [] };
const socket = createOresSharedSocket('/ws', { pool_key: poolKey, mode });
window.__ores_socket = socket;
socket.onopen = () => { window.__ores.opens += 1; };
socket.onreconnecting = (event) => { window.__ores.reconnects += 1; window.__ores.last_reconnect = event.detail; };
socket.onmessage = (event) => { window.__ores.messages.push(event.data); };
socket.onclose = (event) => { window.__ores.closes.push({ code: event.code, reason: event.reason }); };
socket.onerror = (event) => { window.__ores.errors.push(event?.detail?.message || 'error'); };
window.oresSend = (value) => socket.send(value);
window.oresClose = () => socket.close(1000, 'test complete');
window.oresTryCrossOrigin = () => {
  try {
    createOresSharedSocket('ws://127.0.0.1:9/ws', { pool_key: 'cross-origin-test', mode: 'ores_mux_v1' });
    return 'unexpected-success';
  } catch (error) {
    return String(error?.message || error);
  }
};
window.oresTryWrongProtocol = () => {
  try {
    createOresSharedSocket('/ws', { pool_key: 'protocol-test', mode: 'ores_mux_v1', protocols: ['not-ores'] });
    return 'unexpected-success';
  } catch (error) {
    return String(error?.message || error);
  }
};
`;

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/stats') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(jsonStats()));
    return;
  }
  if (url.pathname === '/disconnect') {
    for (const socket of [...sockets]) socket.close(1012, 'test restart');
    response.writeHead(204);
    response.end();
    return;
  }
  if (url.pathname === '/ores-workers/client.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    response.end(fs.readFileSync(path.join(distDir, 'client.js')));
    return;
  }
  if (url.pathname === '/ores-workers/socket.shared-worker.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    response.end(fs.readFileSync(path.join(distDir, 'socket.shared-worker.js')));
    return;
  }
  if (url.pathname === '/test-client.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    response.end(testClientJs);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end('<!doctype html><meta charset="utf-8"><title>ores-sw proof</title><script type="module" src="/test-client.js"></script>');
});

const wss = new WebSocketServer({
  noServer: true,
  handleProtocols(protocols) {
    if (protocols.has('ores.ws.mux.v1')) return 'ores.ws.mux.v1';
    if (protocols.has('ores.ws.send-only.v1')) return 'ores.ws.send-only.v1';
    return false;
  },
});

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (websocket) => wss.emit('connection', websocket, request));
});

wss.on('connection', (socket) => {
  const ownedStreams = new Set();
  sockets.add(socket);
  stats.total_physical_opened += 1;
  stats.active_physical += 1;
  stats.max_active_physical = Math.max(stats.max_active_physical, stats.active_physical);
  stats.protocol_counts.set(socket.protocol, (stats.protocol_counts.get(socket.protocol) ?? 0) + 1);

  socket.on('message', (raw, isBinary) => {
    assert.equal(isBinary, false, 'v1 proof expects text websocket frames');
    const text = raw.toString('utf8');
    if (socket.protocol === 'ores.ws.send-only.v1') {
      stats.send_only_frames += 1;
      JSON.parse(text);
      return;
    }

    const envelope = JSON.parse(text);
    assert.equal(envelope.protocol_version, 'ores.ws.mux/v1');
    assert.match(envelope.stream_id, /^[A-Za-z0-9._:-]+$/);
    if (envelope.kind === 'stream_open') {
      ownedStreams.add(envelope.stream_id);
      stats.active_streams.add(envelope.stream_id);
      stats.stream_open_frames += 1;
      return;
    }
    if (envelope.kind === 'stream_close') {
      ownedStreams.delete(envelope.stream_id);
      stats.active_streams.delete(envelope.stream_id);
      stats.stream_close_frames += 1;
      return;
    }
    assert.equal(envelope.kind, 'data');
    assert.ok(ownedStreams.has(envelope.stream_id), 'data must follow stream_open');
    stats.mux_data_frames += 1;
    socket.send(JSON.stringify({
      protocol_version: 'ores.ws.mux/v1',
      stream_id: envelope.stream_id,
      kind: 'data',
      payload: { echo: envelope.payload },
    }));
  });

  socket.on('close', () => {
    sockets.delete(socket);
    stats.active_physical -= 1;
    for (const streamId of ownedStreams) stats.active_streams.delete(streamId);
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.equal(typeof address, 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

async function readStats() {
  const response = await fetch(`${baseUrl}/stats`, { cache: 'no-store' });
  assert.equal(response.ok, true);
  return response.json();
}

async function waitFor(label, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timeout waiting for ${label}; last=${JSON.stringify(last)}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const muxPages = [];

try {
  for (let index = 0; index < 10; index += 1) {
    const page = await context.newPage();
    muxPages.push(page);
    await page.goto(`${baseUrl}/?key=session-a&tab=${index}`);
  }
  await Promise.all(muxPages.map((page) => page.waitForFunction(() => window.__ores?.opens === 1)));

  await waitFor('one physical mux socket and ten logical streams', async () => {
    const current = await readStats();
    return current.active_physical === 1 && current.active_logical_streams === 10 ? current : false;
  });

  for (let index = 0; index < muxPages.length; index += 1) {
    await muxPages[index].evaluate((tab) => window.oresSend({ tab, message: `hello-${tab}` }), index);
  }
  await Promise.all(muxPages.map((page) => page.waitForFunction(() => window.__ores?.messages.length === 1)));
  for (let index = 0; index < muxPages.length; index += 1) {
    const messages = await muxPages[index].evaluate(() => window.__ores.messages);
    assert.deepEqual(messages, [{ echo: { tab: index, message: `hello-${index}` } }], 'reply leaked across logical streams');
  }

  const crossOriginResult = await muxPages[0].evaluate(() => window.oresTryCrossOrigin());
  assert.match(crossOriginResult, /allow_cross_origin=true/);
  const wrongProtocolResult = await muxPages[0].evaluate(() => window.oresTryWrongProtocol());
  assert.match(wrongProtocolResult, /requires exactly websocket subprotocol ores\.ws\.mux\.v1/);

  const partitionPage = await context.newPage();
  await partitionPage.goto(`${baseUrl}/?key=session-b`);
  await partitionPage.waitForFunction(() => window.__ores?.opens === 1);
  await waitFor('second physical socket for a different auth partition', async () => {
    const current = await readStats();
    return current.active_physical === 2 && current.active_logical_streams === 11 ? current : false;
  });
  await partitionPage.evaluate(() => window.oresClose());
  await partitionPage.waitForFunction(() => window.__ores?.closes.length >= 1);
  await partitionPage.close();
  await waitFor('idle partition pool teardown', async () => {
    const current = await readStats();
    return current.active_physical === 1 && current.active_logical_streams === 10 ? current : false;
  }, 12_000);

  const beforeReconnect = await readStats();
  await fetch(`${baseUrl}/disconnect`, { method: 'POST' });
  await Promise.all(muxPages.map((page) => page.waitForFunction(() => window.__ores?.reconnects >= 1)));
  await Promise.all(muxPages.map((page) => page.waitForFunction(() => window.__ores?.opens >= 2)));
  const afterReconnect = await waitFor('single-flight reconnect and stream re-announcement', async () => {
    const current = await readStats();
    return current.active_physical === 1 && current.active_logical_streams === 10 ? current : false;
  });
  assert.equal(
    afterReconnect.total_physical_opened,
    beforeReconnect.total_physical_opened + 1,
    'ten logical tabs must produce exactly one replacement physical socket',
  );

  for (let index = 0; index < 5; index += 1) {
    await muxPages[index].evaluate(() => window.oresClose());
    await muxPages[index].waitForFunction(() => window.__ores?.closes.length >= 1);
    await muxPages[index].close();
  }
  muxPages.splice(0, 5);
  await waitFor('five remaining logical streams', async () => {
    const current = await readStats();
    return current.active_physical === 1 && current.active_logical_streams === 5 ? current : false;
  });

  const physicalBeforeReplacementTabs = (await readStats()).total_physical_opened;
  for (let index = 0; index < 5; index += 1) {
    const page = await context.newPage();
    muxPages.push(page);
    await page.goto(`${baseUrl}/?key=session-a&replacement=${index}`);
    await page.waitForFunction(() => window.__ores?.opens === 1);
  }
  const replacementStats = await waitFor('replacement tabs reuse existing physical socket', async () => {
    const current = await readStats();
    return current.active_logical_streams === 10 ? current : false;
  });
  assert.equal(replacementStats.total_physical_opened, physicalBeforeReplacementTabs);

  for (const page of muxPages) {
    await page.evaluate(() => window.oresClose());
    await page.close();
  }
  muxPages.length = 0;
  await waitFor('mux pool idle close', async () => (await readStats()).active_physical === 0);

  const sendOnlyPages = [];
  for (let index = 0; index < 10; index += 1) {
    const page = await context.newPage();
    sendOnlyPages.push(page);
    await page.goto(`${baseUrl}/?key=telemetry-session&mode=send_only&tab=${index}`);
  }
  await Promise.all(sendOnlyPages.map((page) => page.waitForFunction(() => window.__ores?.opens === 1)));
  const sendOnlyStart = await waitFor('one shared send-only telemetry socket', async () => {
    const current = await readStats();
    return current.active_physical === 1 && current.protocol_counts['ores.ws.send-only.v1'] >= 1 ? current : false;
  });
  const physicalBeforeTelemetry = sendOnlyStart.total_physical_opened;
  for (let index = 0; index < sendOnlyPages.length; index += 1) {
    await sendOnlyPages[index].evaluate((tab) => window.oresSend({ tab, level: 'info', message: `telemetry-${tab}` }), index);
  }
  const telemetryStats = await waitFor('ten telemetry frames over one physical socket', async () => {
    const current = await readStats();
    return current.send_only_frames >= 10 ? current : false;
  });
  assert.equal(telemetryStats.total_physical_opened, physicalBeforeTelemetry);

  for (const page of sendOnlyPages) {
    await page.evaluate(() => window.oresClose());
    await page.close();
  }

  const finalStats = await readStats();
  assert.ok(finalStats.stream_open_frames >= 25, 'expected initial, reconnect, and replacement stream opens');
  assert.ok(finalStats.stream_close_frames >= 15, 'expected explicit logical stream closes');
  assert.ok(finalStats.mux_data_frames >= 10, 'expected mux data frames');
  assert.ok(finalStats.send_only_frames >= 10, 'expected send-only telemetry frames');
  console.log(JSON.stringify({ result: 'ok', stats: finalStats }, null, 2));
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  for (const socket of [...sockets]) socket.terminate();
  await new Promise((resolve) => server.close(resolve));
  wss.close();
}
