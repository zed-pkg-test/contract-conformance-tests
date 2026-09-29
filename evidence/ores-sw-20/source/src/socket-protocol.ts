export const ORES_SOCKET_MUX_PROTOCOL_VERSION = 'ores.ws.mux/v1' as const;
export const ORES_SOCKET_EVENT_PROTOCOL_VERSION = 'ores.sw.socket-event/v1' as const;
export const ORES_SOCKET_MUX_SUBPROTOCOL = 'ores.ws.mux.v1' as const;
export const ORES_SOCKET_SEND_ONLY_SUBPROTOCOL = 'ores.ws.send-only.v1' as const;

export type OresSocketMode = 'ores_mux_v1' | 'send_only';
export type SocketMuxKind = 'stream_open' | 'data' | 'stream_close' | 'broadcast';

export interface OresSocketMuxEnvelope {
  protocol_version: typeof ORES_SOCKET_MUX_PROTOCOL_VERSION;
  stream_id: string;
  kind: SocketMuxKind;
  payload?: unknown;
  close_code?: number;
  close_reason?: string;
}

const SUBPROTOCOL_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const STREAM_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const MAX_ENDPOINT_BYTES = 2048;
const MAX_POOL_KEY_BYTES = 256;
const MAX_STREAM_ID_BYTES = 256;
const MAX_SUBPROTOCOLS = 8;
const MAX_SUBPROTOCOL_BYTES = 128;
const MAX_CLOSE_REASON_BYTES = 123;
const ALLOWED_MUX_KEYS = new Set([
  'protocol_version',
  'stream_id',
  'kind',
  'payload',
  'close_code',
  'close_reason'
]);

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function isSocketMode(value: unknown): value is OresSocketMode {
  return value === 'ores_mux_v1' || value === 'send_only';
}

export function isSocketStreamId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && encodedBytes(value) <= MAX_STREAM_ID_BYTES
    && STREAM_ID_PATTERN.test(value);
}

export function normalizeSocketEndpoint(
  endpoint: string,
  baseHref = globalThis.location?.href ?? 'http://localhost/'
): string {
  if (typeof endpoint !== 'string' || endpoint.length === 0 || encodedBytes(endpoint) > MAX_ENDPOINT_BYTES) {
    throw new Error('socket endpoint must be a non-empty bounded URL');
  }

  const base = new URL(baseHref);
  const url = new URL(endpoint, base);
  if (url.username || url.password) throw new Error('socket endpoint must not contain URL credentials');
  if (url.hash) throw new Error('socket endpoint must not contain a fragment');

  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`unsupported socket endpoint protocol: ${url.protocol}`);
  }
  if (base.protocol === 'https:' && url.protocol !== 'wss:') {
    throw new Error('secure pages may only open wss websocket endpoints');
  }
  return url.href;
}

export function socketEndpointHttpOrigin(endpoint: string): string {
  const url = new URL(endpoint);
  if (url.protocol === 'ws:') url.protocol = 'http:';
  else if (url.protocol === 'wss:') url.protocol = 'https:';
  else throw new Error(`unsupported socket endpoint protocol: ${url.protocol}`);
  return url.origin;
}

export function isSocketEndpointSameOrigin(
  endpoint: string,
  baseHref = globalThis.location?.href ?? 'http://localhost/'
): boolean {
  const normalized = normalizeSocketEndpoint(endpoint, baseHref);
  return socketEndpointHttpOrigin(normalized) === new URL(baseHref).origin;
}

export function normalizeSocketProtocols(protocols: string | readonly string[] | undefined): string[] {
  if (protocols === undefined) return [];
  const values = typeof protocols === 'string' ? [protocols] : [...protocols];
  if (values.length > MAX_SUBPROTOCOLS) throw new Error('too many websocket subprotocols');

  const seen = new Set<string>();
  for (const protocol of values) {
    if (
      typeof protocol !== 'string'
      || protocol.length === 0
      || encodedBytes(protocol) > MAX_SUBPROTOCOL_BYTES
      || !SUBPROTOCOL_PATTERN.test(protocol)
    ) {
      throw new Error(`invalid websocket subprotocol: ${String(protocol)}`);
    }
    if (seen.has(protocol)) throw new Error(`duplicate websocket subprotocol: ${protocol}`);
    seen.add(protocol);
  }
  return values;
}

export function socketSubprotocolForMode(mode: OresSocketMode): string {
  return mode === 'ores_mux_v1'
    ? ORES_SOCKET_MUX_SUBPROTOCOL
    : ORES_SOCKET_SEND_ONLY_SUBPROTOCOL;
}

export function normalizeSocketProtocolsForMode(
  mode: OresSocketMode,
  protocols: string | readonly string[] | undefined
): string[] {
  const required = socketSubprotocolForMode(mode);
  const values = normalizeSocketProtocols(protocols ?? [required]);
  if (values.length !== 1 || values[0] !== required) {
    throw new Error(`socket mode ${mode} requires exactly websocket subprotocol ${required}`);
  }
  return values;
}

export function normalizeSocketPoolKey(poolKey: string): string {
  if (
    typeof poolKey !== 'string'
    || poolKey.length === 0
    || encodedBytes(poolKey) > MAX_POOL_KEY_BYTES
    || !STREAM_ID_PATTERN.test(poolKey)
  ) {
    throw new Error('socket pool_key must be a bounded ASCII identifier');
  }
  return poolKey;
}

export function buildSocketPoolIdentity(input: {
  endpoint: string;
  pool_key: string;
  mode: OresSocketMode;
  protocols?: string | readonly string[];
  base_href?: string;
}): string {
  const endpoint = normalizeSocketEndpoint(input.endpoint, input.base_href);
  const poolKey = normalizeSocketPoolKey(input.pool_key);
  if (!isSocketMode(input.mode)) throw new Error('socket mode is invalid');
  const protocols = normalizeSocketProtocolsForMode(input.mode, input.protocols);
  return JSON.stringify([endpoint, poolKey, input.mode, protocols]);
}

export function isApplicationCloseCode(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && (value === 1000 || (value >= 3000 && value <= 4999));
}

export function normalizeSocketCloseReason(reason: unknown): string {
  if (reason === undefined) return '';
  if (typeof reason !== 'string') throw new Error('socket close_reason must be a string');
  if (encodedBytes(reason) > MAX_CLOSE_REASON_BYTES) throw new Error('socket close_reason exceeds 123 byte limit');
  return reason;
}

export function encodeSocketMuxEnvelope(streamId: string, payload: unknown): string {
  if (!isSocketStreamId(streamId)) throw new Error('socket stream_id is invalid');
  return JSON.stringify({
    protocol_version: ORES_SOCKET_MUX_PROTOCOL_VERSION,
    stream_id: streamId,
    kind: 'data',
    payload
  } satisfies OresSocketMuxEnvelope);
}

export function encodeSocketMuxStreamOpen(streamId: string): string {
  if (!isSocketStreamId(streamId)) throw new Error('socket stream_id is invalid');
  return JSON.stringify({
    protocol_version: ORES_SOCKET_MUX_PROTOCOL_VERSION,
    stream_id: streamId,
    kind: 'stream_open'
  } satisfies OresSocketMuxEnvelope);
}

export function encodeSocketMuxStreamClose(streamId: string, code: number, reason = ''): string {
  if (!isSocketStreamId(streamId)) throw new Error('socket stream_id is invalid');
  if (!Number.isInteger(code) || code < 1000 || code > 4999) throw new Error('socket logical close code is invalid');
  return JSON.stringify({
    protocol_version: ORES_SOCKET_MUX_PROTOCOL_VERSION,
    stream_id: streamId,
    kind: 'stream_close',
    close_code: code,
    close_reason: normalizeSocketCloseReason(reason)
  } satisfies OresSocketMuxEnvelope);
}

export function isSocketMuxEnvelope(value: unknown): value is OresSocketMuxEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !ALLOWED_MUX_KEYS.has(key))) return false;
  if (
    candidate.protocol_version !== ORES_SOCKET_MUX_PROTOCOL_VERSION
    || !isSocketStreamId(candidate.stream_id)
    || (candidate.kind !== 'stream_open'
      && candidate.kind !== 'data'
      && candidate.kind !== 'stream_close'
      && candidate.kind !== 'broadcast')
  ) {
    return false;
  }
  if (candidate.kind === 'stream_close') {
    if (
      candidate.close_code !== undefined
      && (typeof candidate.close_code !== 'number'
        || !Number.isInteger(candidate.close_code)
        || candidate.close_code < 1000
        || candidate.close_code > 4999)
    ) {
      return false;
    }
    if (candidate.close_reason !== undefined) {
      if (typeof candidate.close_reason !== 'string' || encodedBytes(candidate.close_reason) > MAX_CLOSE_REASON_BYTES) return false;
    }
  } else if (candidate.close_code !== undefined || candidate.close_reason !== undefined) {
    return false;
  }
  return true;
}

export function decodeSocketMuxEnvelope(value: unknown): OresSocketMuxEnvelope | null {
  let decoded = value;
  if (typeof value === 'string') {
    try {
      decoded = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return isSocketMuxEnvelope(decoded) ? decoded : null;
}
