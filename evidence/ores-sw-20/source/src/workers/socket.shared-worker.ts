import { fail, isWorkerRequest, ok, type WorkerRequest } from '../protocol.js';
import {
  ORES_SOCKET_EVENT_PROTOCOL_VERSION,
  buildSocketPoolIdentity,
  decodeSocketMuxEnvelope,
  encodeSocketMuxEnvelope,
  encodeSocketMuxStreamClose,
  encodeSocketMuxStreamOpen,
  isSocketEndpointSameOrigin,
  isSocketMode,
  isSocketStreamId,
  normalizeSocketCloseReason,
  normalizeSocketEndpoint,
  normalizeSocketPoolKey,
  normalizeSocketProtocolsForMode,
  type OresSocketMode
} from '../socket-protocol.js';

const worker = globalThis as unknown as SharedWorkerGlobalScope;
const MAX_PORTS = 256;
const MAX_POOLS = 64;
const MAX_STREAMS = 1024;
const MAX_STREAMS_PER_POOL = 256;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_PENDING_FRAMES_PER_POOL = 512;
const MAX_PENDING_BYTES_PER_POOL = 4 * 1024 * 1024;
const SOCKET_BUFFER_HIGH_WATER_BYTES = 1024 * 1024;
const POOL_IDLE_MS = 5_000;
const STREAM_LEASE_MS = 180_000;
const LEASE_SWEEP_MS = 30_000;
const FLUSH_RETRY_MS = 25;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30_000;

type SocketEventName = 'open' | 'reconnecting' | 'message' | 'error' | 'close';

interface OpenStreamPayload {
  stream_id: string;
  endpoint: string;
  pool_key: string;
  mode: OresSocketMode;
  protocols: string[];
  allow_cross_origin: boolean;
}

interface StreamBinding {
  stream_id: string;
  port: MessagePort;
  pool: SocketPool;
  last_seen_ms: number;
}

interface PendingFrame {
  stream_id: string | null;
  data: string;
  bytes: number;
  retain_after_detach: boolean;
}

interface SocketPool {
  identity: string;
  endpoint: string;
  mode: OresSocketMode;
  protocols: string[];
  socket: WebSocket | undefined;
  streams: Map<string, StreamBinding>;
  queue: PendingFrame[];
  queued_bytes: number;
  reconnect_attempt: number;
  deliberately_closing: boolean;
  idle_timer: ReturnType<typeof setTimeout> | undefined;
  reconnect_timer: ReturnType<typeof setTimeout> | undefined;
  flush_timer: ReturnType<typeof setTimeout> | undefined;
}

const pools = new Map<string, SocketPool>();
const streams = new Map<string, StreamBinding>();
const streamsByPort = new Map<MessagePort, Set<string>>();

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseOpenPayload(value: unknown): OpenStreamPayload {
  const payload = record(value);
  if (!payload) throw new Error('open_stream payload must be an object');
  if (!isSocketStreamId(payload.stream_id)) throw new Error('open_stream stream_id is invalid');
  if (typeof payload.endpoint !== 'string') throw new Error('open_stream endpoint is required');
  if (typeof payload.pool_key !== 'string') throw new Error('open_stream pool_key is required');
  if (!isSocketMode(payload.mode)) throw new Error('open_stream mode is invalid');
  if (payload.protocols !== undefined) {
    if (!Array.isArray(payload.protocols) || !payload.protocols.every((item) => typeof item === 'string')) {
      throw new Error('open_stream protocols must be an array of strings');
    }
  }

  const endpoint = normalizeSocketEndpoint(payload.endpoint, worker.location.href);
  const allowCrossOrigin = payload.allow_cross_origin === true;
  if (!allowCrossOrigin && !isSocketEndpointSameOrigin(endpoint, worker.location.href)) {
    throw new Error('cross-origin websocket endpoints require allow_cross_origin=true');
  }

  return {
    stream_id: payload.stream_id,
    endpoint,
    pool_key: normalizeSocketPoolKey(payload.pool_key),
    mode: payload.mode,
    protocols: normalizeSocketProtocolsForMode(payload.mode, payload.protocols as string[] | undefined),
    allow_cross_origin: allowCrossOrigin
  };
}

function post(binding: StreamBinding, event: SocketEventName, fields: Record<string, unknown> = {}): void {
  binding.port.postMessage({
    protocol_version: ORES_SOCKET_EVENT_PROTOCOL_VERSION,
    stream_id: binding.stream_id,
    event,
    ...fields
  });
}

function postPool(pool: SocketPool, event: SocketEventName, fields: Record<string, unknown> = {}): void {
  for (const binding of pool.streams.values()) post(binding, event, fields);
}

function releasePortStream(binding: StreamBinding): void {
  const owned = streamsByPort.get(binding.port);
  owned?.delete(binding.stream_id);
  if (owned?.size === 0) streamsByPort.delete(binding.port);
}

function clearTimer(timer: ReturnType<typeof setTimeout> | undefined): void {
  if (timer !== undefined) clearTimeout(timer);
}

function clearPoolTimers(pool: SocketPool): void {
  clearTimer(pool.idle_timer);
  clearTimer(pool.reconnect_timer);
  clearTimer(pool.flush_timer);
  pool.idle_timer = undefined;
  pool.reconnect_timer = undefined;
  pool.flush_timer = undefined;
}

function queuedFrameBytes(data: string): number {
  const bytes = new TextEncoder().encode(data).byteLength;
  if (bytes > MAX_FRAME_BYTES) throw new Error('socket frame exceeds 1 MiB limit');
  return bytes;
}

function enqueueFrame(
  pool: SocketPool,
  streamId: string | null,
  data: string,
  retainAfterDetach = false
): void {
  const bytes = queuedFrameBytes(data);
  if (
    pool.queue.length >= MAX_PENDING_FRAMES_PER_POOL
    || pool.queued_bytes + bytes > MAX_PENDING_BYTES_PER_POOL
  ) {
    throw new Error('shared socket backpressure queue is full');
  }
  pool.queue.push({ stream_id: streamId, data, bytes, retain_after_detach: retainAfterDetach });
  pool.queued_bytes += bytes;
}

function scheduleFlush(pool: SocketPool): void {
  if (pool.flush_timer !== undefined || pool.queue.length === 0) return;
  pool.flush_timer = setTimeout(() => {
    pool.flush_timer = undefined;
    flushQueue(pool);
  }, FLUSH_RETRY_MS);
}

function flushQueue(pool: SocketPool): void {
  const socket = pool.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  while (pool.queue.length > 0 && socket.bufferedAmount <= SOCKET_BUFFER_HIGH_WATER_BYTES) {
    const frame = pool.queue.shift();
    if (!frame) break;
    pool.queued_bytes -= frame.bytes;
    if (
      frame.stream_id !== null
      && !frame.retain_after_detach
      && !pool.streams.has(frame.stream_id)
    ) {
      continue;
    }
    socket.send(frame.data);
  }
  if (pool.queue.length > 0) scheduleFlush(pool);
}

function sendFrame(
  pool: SocketPool,
  streamId: string | null,
  data: string,
  retainAfterDetach = false
): boolean {
  const bytes = queuedFrameBytes(data);
  const socket = pool.socket;
  if (
    !socket
    || socket.readyState !== WebSocket.OPEN
    || socket.bufferedAmount > SOCKET_BUFFER_HIGH_WATER_BYTES
  ) {
    if (
      pool.queue.length >= MAX_PENDING_FRAMES_PER_POOL
      || pool.queued_bytes + bytes > MAX_PENDING_BYTES_PER_POOL
    ) {
      throw new Error('shared socket backpressure queue is full');
    }
    pool.queue.push({ stream_id: streamId, data, bytes, retain_after_detach: retainAfterDetach });
    pool.queued_bytes += bytes;
    if (socket?.readyState === WebSocket.OPEN) scheduleFlush(pool);
    return true;
  }
  socket.send(data);
  return false;
}

function removeQueuedStreamData(pool: SocketPool, streamId: string): void {
  let removedBytes = 0;
  pool.queue = pool.queue.filter((frame) => {
    if (frame.stream_id === streamId && !frame.retain_after_detach) {
      removedBytes += frame.bytes;
      return false;
    }
    return true;
  });
  pool.queued_bytes -= removedBytes;
}

function scheduleIdleClose(pool: SocketPool): void {
  if (pool.streams.size !== 0 || pool.idle_timer !== undefined) return;
  pool.idle_timer = setTimeout(() => {
    pool.idle_timer = undefined;
    if (pool.streams.size !== 0) return;
    pool.deliberately_closing = true;
    pools.delete(pool.identity);
    clearPoolTimers(pool);
    pool.queue = [];
    pool.queued_bytes = 0;
    const socket = pool.socket;
    pool.socket = undefined;
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
      socket.close(1000, 'idle');
    }
  }, POOL_IDLE_MS);
}

function detach(
  binding: StreamBinding,
  code: number,
  reason: string,
  wasClean: boolean,
  emitClose: boolean,
  notifyServer = true,
  scheduleClose = true
): void {
  if (!streams.has(binding.stream_id)) return;
  const pool = binding.pool;
  if (notifyServer && pool.mode === 'ores_mux_v1') {
    try {
      removeQueuedStreamData(pool, binding.stream_id);
      sendFrame(pool, binding.stream_id, encodeSocketMuxStreamClose(binding.stream_id, code, reason), true);
    } catch {
      removeQueuedStreamData(pool, binding.stream_id);
    }
  } else {
    removeQueuedStreamData(pool, binding.stream_id);
  }
  streams.delete(binding.stream_id);
  pool.streams.delete(binding.stream_id);
  if (emitClose) post(binding, 'close', { code, reason, was_clean: wasClean });
  releasePortStream(binding);
  if (scheduleClose) scheduleIdleClose(pool);
}

function closePool(pool: SocketPool, code: number, reason: string, wasClean: boolean): void {
  pools.delete(pool.identity);
  pool.deliberately_closing = true;
  clearPoolTimers(pool);
  pool.queue = [];
  pool.queued_bytes = 0;
  for (const binding of [...pool.streams.values()]) {
    detach(binding, code, reason, wasClean, true, false, false);
  }
}

function poolIdentity(payload: OpenStreamPayload): string {
  return buildSocketPoolIdentity({
    endpoint: payload.endpoint,
    pool_key: payload.pool_key,
    mode: payload.mode,
    protocols: payload.protocols,
    base_href: worker.location.href
  });
}

function protocolViolation(pool: SocketPool, code: number, message: string): void {
  postPool(pool, 'error', { payload: message });
  const socket = pool.socket;
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    pool.deliberately_closing = true;
    socket.close(code, message.slice(0, 123));
  } else {
    closePool(pool, code, message, false);
  }
}

function handleIncoming(pool: SocketPool, data: unknown): void {
  if (pool.mode === 'send_only') return;
  if (typeof data !== 'string') {
    protocolViolation(pool, 1003, 'ores_mux_v1 requires text frames');
    return;
  }
  if (new TextEncoder().encode(data).byteLength > MAX_FRAME_BYTES) {
    protocolViolation(pool, 1009, 'ores_mux_v1 frame exceeds 1 MiB');
    return;
  }
  const envelope = decodeSocketMuxEnvelope(data);
  if (!envelope) {
    protocolViolation(pool, 1002, 'invalid ores.ws.mux/v1 frame');
    return;
  }
  if (envelope.kind === 'broadcast') {
    postPool(pool, 'message', { payload: envelope.payload });
    return;
  }
  if (envelope.kind === 'stream_open') {
    protocolViolation(pool, 1002, 'server must not open client logical streams');
    return;
  }
  const binding = pool.streams.get(envelope.stream_id);
  if (!binding) return;
  if (envelope.kind === 'stream_close') {
    detach(
      binding,
      envelope.close_code ?? 1000,
      envelope.close_reason ?? '',
      true,
      true,
      false
    );
    return;
  }
  post(binding, 'message', { payload: envelope.payload });
}

function reconnectDelayMs(attempt: number): number {
  const base = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * (2 ** Math.min(attempt, 6)));
  return Math.max(250, Math.floor(base * (0.75 + Math.random() * 0.5)));
}

function shouldReconnect(code: number): boolean {
  return code === 1001 || code === 1006 || code === 1011 || code === 1012 || code === 1013 || code === 1014;
}

function scheduleReconnect(pool: SocketPool, closeCode: number, closeReason: string): void {
  if (pool.deliberately_closing || pool.streams.size === 0 || pool.reconnect_timer !== undefined) return;
  const delay = reconnectDelayMs(pool.reconnect_attempt);
  pool.reconnect_attempt += 1;
  postPool(pool, 'reconnecting', {
    code: closeCode,
    reason: closeReason,
    retry_in_ms: delay,
    attempt: pool.reconnect_attempt
  });
  pool.reconnect_timer = setTimeout(() => {
    pool.reconnect_timer = undefined;
    if (pool.streams.size === 0 || pool.deliberately_closing) return;
    connectPool(pool);
  }, delay);
}

function connectPool(pool: SocketPool): void {
  if (pool.deliberately_closing || pool.streams.size === 0) return;
  const socket = pool.protocols.length === 0
    ? new WebSocket(pool.endpoint)
    : new WebSocket(pool.endpoint, pool.protocols);
  pool.socket = socket;

  socket.onopen = () => {
    if (pool.socket !== socket || pool.deliberately_closing) return;
    if (pool.protocols.length > 0 && !pool.protocols.includes(socket.protocol)) {
      protocolViolation(pool, 1002, 'websocket subprotocol negotiation failed');
      return;
    }
    pool.reconnect_attempt = 0;
    if (pool.mode === 'ores_mux_v1') {
      try {
        for (const binding of pool.streams.values()) {
          socket.send(encodeSocketMuxStreamOpen(binding.stream_id));
        }
      } catch {
        socket.close(1011, 'failed to initialize logical streams');
        return;
      }
    }
    postPool(pool, 'open', { protocol: socket.protocol });
    flushQueue(pool);
  };
  socket.onmessage = (message) => handleIncoming(pool, message.data);
  socket.onerror = () => postPool(pool, 'error', { payload: 'physical websocket error' });
  socket.onclose = (event) => {
    if (pool.socket !== socket) return;
    pool.socket = undefined;
    if (
      !pool.deliberately_closing
      && pool.streams.size > 0
      && shouldReconnect(event.code)
    ) {
      scheduleReconnect(pool, event.code, event.reason);
      return;
    }
    closePool(pool, event.code, event.reason, event.wasClean);
  };
}

function createPool(payload: OpenStreamPayload): SocketPool {
  if (pools.size >= MAX_POOLS) throw new Error('shared socket pool limit reached');
  const identity = poolIdentity(payload);
  const pool: SocketPool = {
    identity,
    endpoint: payload.endpoint,
    mode: payload.mode,
    protocols: payload.protocols,
    socket: undefined,
    streams: new Map(),
    queue: [],
    queued_bytes: 0,
    reconnect_attempt: 0,
    deliberately_closing: false,
    idle_timer: undefined,
    reconnect_timer: undefined,
    flush_timer: undefined
  };
  pools.set(identity, pool);
  return pool;
}

function acquirePool(payload: OpenStreamPayload): SocketPool {
  const identity = poolIdentity(payload);
  const existing = pools.get(identity);
  if (existing && !existing.deliberately_closing) {
    clearTimer(existing.idle_timer);
    existing.idle_timer = undefined;
    return existing;
  }
  if (existing) pools.delete(identity);
  return createPool(payload);
}

function attach(port: MessagePort, payload: OpenStreamPayload): StreamBinding {
  const existingBinding = streams.get(payload.stream_id);
  if (existingBinding) {
    if (existingBinding.port !== port || existingBinding.pool.identity !== poolIdentity(payload)) {
      throw new Error('stream_id is already active');
    }
    existingBinding.last_seen_ms = Date.now();
    return existingBinding;
  }
  if (!streamsByPort.has(port) && streamsByPort.size >= MAX_PORTS) {
    throw new Error('shared socket active port limit reached');
  }
  if (streams.size >= MAX_STREAMS) throw new Error('shared socket stream limit reached');

  const pool = acquirePool(payload);
  if (pool.streams.size >= MAX_STREAMS_PER_POOL) throw new Error('shared socket per-pool stream limit reached');

  const binding: StreamBinding = {
    stream_id: payload.stream_id,
    port,
    pool,
    last_seen_ms: Date.now()
  };
  streams.set(binding.stream_id, binding);
  pool.streams.set(binding.stream_id, binding);
  const owned = streamsByPort.get(port) ?? new Set<string>();
  owned.add(binding.stream_id);
  streamsByPort.set(port, owned);

  const socket = pool.socket;
  if (!socket || socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
    connectPool(pool);
  } else if (socket.readyState === WebSocket.OPEN) {
    if (pool.mode === 'ores_mux_v1') sendFrame(pool, binding.stream_id, encodeSocketMuxStreamOpen(binding.stream_id));
    post(binding, 'open', { protocol: socket.protocol });
  }
  return binding;
}

function ownedBinding(port: MessagePort, streamId: unknown): StreamBinding {
  if (!isSocketStreamId(streamId)) throw new Error('stream_id is invalid');
  const binding = streams.get(streamId);
  if (!binding || binding.port !== port) throw new Error('stream_id is not owned by this client');
  binding.last_seen_ms = Date.now();
  return binding;
}

function serialize(pool: SocketPool, binding: StreamBinding, data: unknown): string {
  const encoded = pool.mode === 'ores_mux_v1'
    ? encodeSocketMuxEnvelope(binding.stream_id, data)
    : (typeof data === 'string' ? data : JSON.stringify(data));
  if (encoded === undefined) throw new Error('socket payload is not serializable');
  queuedFrameBytes(encoded);
  return encoded;
}

async function handle(port: MessagePort, request: WorkerRequest) {
  switch (request.action) {
    case 'ping':
      return ok(request, { pools: pools.size, streams: streams.size });
    case 'stats':
      return ok(request, {
        pools: pools.size,
        streams: streams.size,
        active_ports: streamsByPort.size,
        physical_connections: [...pools.values()].filter((pool) => pool.socket?.readyState === WebSocket.OPEN).length,
        reconnecting_pools: [...pools.values()].filter((pool) => pool.reconnect_timer !== undefined).length,
        queued_frames: [...pools.values()].reduce((sum, pool) => sum + pool.queue.length, 0),
        queued_bytes: [...pools.values()].reduce((sum, pool) => sum + pool.queued_bytes, 0)
      });
    case 'open_stream': {
      const binding = attach(port, parseOpenPayload(request.payload));
      return ok(request, {
        stream_id: binding.stream_id,
        pooled_streams: binding.pool.streams.size,
        physical_state: binding.pool.socket?.readyState ?? WebSocket.CLOSED
      });
    }
    case 'heartbeat': {
      const payload = record(request.payload);
      if (!payload) return fail(request, 'heartbeat payload must be an object');
      ownedBinding(port, payload.stream_id);
      return ok(request, { alive: true });
    }
    case 'send': {
      const payload = record(request.payload);
      if (!payload) return fail(request, 'send payload must be an object');
      const binding = ownedBinding(port, payload.stream_id);
      const queued = sendFrame(binding.pool, binding.stream_id, serialize(binding.pool, binding, payload.data));
      return ok(request, { accepted: true, queued });
    }
    case 'close_stream': {
      const payload = record(request.payload);
      if (!payload) return fail(request, 'close_stream payload must be an object');
      const binding = ownedBinding(port, payload.stream_id);
      const code = typeof payload.code === 'number' && Number.isInteger(payload.code) && payload.code >= 1000 && payload.code <= 4999
        ? payload.code
        : 1000;
      const reason = normalizeSocketCloseReason(payload.reason);
      detach(binding, code, reason, true, true);
      return ok(request, { closed: true });
    }
    default:
      return fail(request, `unsupported socket action: ${request.action}`);
  }
}

function cleanupPort(port: MessagePort): void {
  for (const streamId of [...(streamsByPort.get(port) ?? [])]) {
    const binding = streams.get(streamId);
    if (binding) detach(binding, 1001, 'client port closed', true, false);
  }
  streamsByPort.delete(port);
}

setInterval(() => {
  const cutoff = Date.now() - STREAM_LEASE_MS;
  for (const binding of [...streams.values()]) {
    if (binding.last_seen_ms < cutoff) {
      detach(binding, 1001, 'client lease expired', false, false);
    }
  }
}, LEASE_SWEEP_MS);

worker.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  if (!port) return;
  port.start();
  port.onmessage = (message) => {
    const request = message.data;
    if (!isWorkerRequest(request) || request.worker !== 'socket') return;
    void handle(port, request)
      .then((response) => port.postMessage(response))
      .catch((error: unknown) => port.postMessage(fail(request, error instanceof Error ? error.message : String(error))));
  };
  port.onmessageerror = () => cleanupPort(port);
};
