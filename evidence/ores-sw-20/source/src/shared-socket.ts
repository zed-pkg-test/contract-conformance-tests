import {
  ORES_SOCKET_EVENT_PROTOCOL_VERSION,
  isApplicationCloseCode,
  isSocketEndpointSameOrigin,
  isSocketMode,
  normalizeSocketCloseReason,
  normalizeSocketEndpoint,
  normalizeSocketPoolKey,
  normalizeSocketProtocolsForMode,
  type OresSocketMode
} from './socket-protocol.js';
import { WORKER_PROTOCOL_VERSION, type WorkerRequest, type WorkerResponse } from './protocol.js';

export interface OresSharedSocketOptions {
  worker_url?: string;
  worker_name?: string;
  pool_key: string;
  mode?: OresSocketMode;
  protocols?: string | readonly string[];
  allow_cross_origin?: boolean;
}

interface SocketWorkerEvent {
  protocol_version: typeof ORES_SOCKET_EVENT_PROTOCOL_VERSION;
  stream_id: string;
  event: 'open' | 'reconnecting' | 'message' | 'error' | 'close';
  payload?: unknown;
  protocol?: string;
  code?: number;
  reason?: string;
  was_clean?: boolean;
  retry_in_ms?: number;
  attempt?: number;
}

interface PendingAction {
  action: string;
  stream_id?: string;
}

function identifier(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const words = new Uint32Array(4);
    crypto.getRandomValues(words);
    return `${prefix}-${Array.from(words, (word) => word.toString(16).padStart(8, '0')).join('')}`;
  }
  throw new Error('cryptographically secure randomness is required for shared socket stream identifiers');
}

function isSocketWorkerEvent(value: unknown, streamId: string): value is SocketWorkerEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.protocol_version === ORES_SOCKET_EVENT_PROTOCOL_VERSION
    && candidate.stream_id === streamId
    && (candidate.event === 'open'
      || candidate.event === 'reconnecting'
      || candidate.event === 'message'
      || candidate.event === 'error'
      || candidate.event === 'close');
}

function isWorkerResponse(value: unknown): value is WorkerResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.protocol_version === WORKER_PROTOCOL_VERSION
    && candidate.worker === 'socket'
    && typeof candidate.request_id === 'string'
    && typeof candidate.ok === 'boolean';
}

function payloadStreamId(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const value = (payload as Record<string, unknown>).stream_id;
  return typeof value === 'string' ? value : undefined;
}

export class OresSharedSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = OresSharedSocket.CONNECTING;
  readonly OPEN = OresSharedSocket.OPEN;
  readonly CLOSING = OresSharedSocket.CLOSING;
  readonly CLOSED = OresSharedSocket.CLOSED;

  readonly url: string;
  readonly pool_key: string;
  readonly mode: OresSocketMode;

  readyState = OresSharedSocket.CONNECTING;
  protocol = '';

  onopen: ((this: OresSharedSocket, event: Event) => unknown) | null = null;
  onreconnecting: ((this: OresSharedSocket, event: CustomEvent) => unknown) | null = null;
  onmessage: ((this: OresSharedSocket, event: MessageEvent) => unknown) | null = null;
  onerror: ((this: OresSharedSocket, event: Event) => unknown) | null = null;
  onclose: ((this: OresSharedSocket, event: CloseEvent) => unknown) | null = null;

  private readonly sharedWorker: SharedWorker;
  private readonly port: MessagePort;
  private readonly protocols: string[];
  private readonly allowCrossOrigin: boolean;
  private readonly pendingActions = new Map<string, PendingAction>();
  private readonly heartbeatTimer: ReturnType<typeof setInterval>;
  private currentStreamId: string;
  private opening = false;
  private suspended = false;
  private manualClose = false;
  private finalized = false;

  get stream_id(): string {
    return this.currentStreamId;
  }

  private readonly pageHideHandler = () => {
    if (this.manualClose || this.finalized) return;
    this.suspended = true;
    this.closeLogical(1001, 'pagehide');
  };

  private readonly pageShowHandler = () => {
    if (this.manualClose || this.finalized || !this.suspended) return;
    this.suspended = false;
    this.opening = false;
    this.currentStreamId = identifier('stream');
    this.openStream();
  };

  constructor(address: string | URL, options: OresSharedSocketOptions) {
    super();
    if (!('SharedWorker' in globalThis)) throw new Error('SharedWorker is not supported in this browser');
    if (!options || typeof options.pool_key !== 'string' || options.pool_key.length === 0) {
      throw new Error('OresSharedSocket requires an explicit non-secret pool_key for auth/session isolation');
    }

    const mode = options.mode ?? 'ores_mux_v1';
    if (!isSocketMode(mode)) throw new Error(`unsupported ORES shared socket mode: ${String(mode)}`);

    this.url = normalizeSocketEndpoint(String(address));
    this.currentStreamId = identifier('stream');
    this.pool_key = normalizeSocketPoolKey(options.pool_key);
    this.mode = mode;
    this.protocols = normalizeSocketProtocolsForMode(mode, options.protocols);
    this.allowCrossOrigin = options.allow_cross_origin === true;
    if (!this.allowCrossOrigin && !isSocketEndpointSameOrigin(this.url)) {
      throw new Error('cross-origin websocket endpoints require allow_cross_origin=true');
    }

    this.sharedWorker = new SharedWorker(
      options.worker_url ?? '/ores-workers/socket.shared-worker.js',
      { type: 'module', name: options.worker_name ?? 'ores-sockets' }
    );
    this.port = this.sharedWorker.port;
    this.sharedWorker.onerror = () => {
      if (this.finalized) return;
      this.readyState = OresSharedSocket.CLOSED;
      this.emitError('shared socket worker failed to load or terminated with an error');
      this.finalize();
    };
    this.port.start();
    this.port.onmessage = (message) => this.handleWorkerMessage(message.data);
    this.port.onmessageerror = () => this.emitError('socket worker message could not be decoded');

    globalThis.addEventListener?.('pagehide', this.pageHideHandler);
    globalThis.addEventListener?.('pageshow', this.pageShowHandler);
    this.heartbeatTimer = setInterval(() => {
      if (!this.manualClose && !this.finalized && !this.suspended) {
        this.post('heartbeat', { stream_id: this.stream_id });
      }
    }, 30_000);
    this.openStream();
  }

  send(data: unknown): void {
    if (this.readyState !== OresSharedSocket.OPEN) {
      throw new DOMException('shared socket is not open', 'InvalidStateError');
    }
    this.post('send', { stream_id: this.stream_id, data });
  }

  close(code = 1000, reason = ''): void {
    if (this.finalized || this.manualClose) return;
    if (!isApplicationCloseCode(code)) {
      throw new DOMException('close code must be 1000 or an application code from 3000 through 4999', 'InvalidAccessError');
    }
    normalizeSocketCloseReason(reason);
    this.manualClose = true;
    this.closeLogical(code, reason);
  }

  private openStream(): void {
    if (this.manualClose || this.finalized || this.suspended || this.opening) return;
    this.opening = true;
    this.readyState = OresSharedSocket.CONNECTING;
    this.post('open_stream', {
      stream_id: this.stream_id,
      endpoint: this.url,
      pool_key: this.pool_key,
      mode: this.mode,
      protocols: this.protocols,
      allow_cross_origin: this.allowCrossOrigin
    });
  }

  private closeLogical(code: number, reason: string): void {
    if (this.finalized) return;
    this.readyState = OresSharedSocket.CLOSING;
    this.post('close_stream', { stream_id: this.stream_id, code, reason });
  }

  private post(action: string, payload: unknown): string {
    const requestId = identifier('socket-req');
    const request: WorkerRequest = {
      protocol_version: WORKER_PROTOCOL_VERSION,
      request_id: requestId,
      worker: 'socket',
      action,
      payload
    };
    const streamId = payloadStreamId(payload);
    this.pendingActions.set(requestId, streamId === undefined ? { action } : { action, stream_id: streamId });
    this.port.postMessage(request);
    return requestId;
  }

  private handleWorkerMessage(value: unknown): void {
    if (isWorkerResponse(value)) {
      const pending = this.pendingActions.get(value.request_id);
      this.pendingActions.delete(value.request_id);
      if (!pending) return;
      if (pending.stream_id !== undefined && pending.stream_id !== this.stream_id) return;

      if (pending.action === 'open_stream') this.opening = false;
      if (!value.ok) {
        if (pending.action === 'heartbeat' && !this.manualClose && !this.suspended && !this.finalized) {
          this.openStream();
          return;
        }
        if (pending.action === 'close_stream' && (this.manualClose || this.suspended)) {
          this.handleLogicalClose(1000, 'logical stream already closed', true);
          return;
        }
        this.emitError(value.error ?? 'shared socket worker request failed');
        if (pending.action === 'open_stream') {
          this.readyState = OresSharedSocket.CLOSED;
        }
      }
      return;
    }
    if (!isSocketWorkerEvent(value, this.stream_id)) return;

    switch (value.event) {
      case 'open': {
        this.opening = false;
        if (this.suspended || this.manualClose || this.finalized) {
          this.closeLogical(this.manualClose ? 1000 : 1001, this.suspended ? 'pagehide' : 'closed');
          return;
        }
        this.readyState = OresSharedSocket.OPEN;
        this.protocol = value.protocol ?? '';
        const event = new Event('open');
        this.dispatchEvent(event);
        this.onopen?.call(this, event);
        return;
      }
      case 'reconnecting': {
        if (this.manualClose || this.finalized) return;
        this.readyState = OresSharedSocket.CONNECTING;
        const event = new CustomEvent('reconnecting', {
          detail: {
            code: value.code ?? 1006,
            reason: value.reason ?? '',
            retry_in_ms: value.retry_in_ms ?? 0,
            attempt: value.attempt ?? 0
          }
        });
        this.dispatchEvent(event);
        this.onreconnecting?.call(this, event);
        return;
      }
      case 'message': {
        if (this.readyState !== OresSharedSocket.OPEN) return;
        const event = new MessageEvent('message', { data: value.payload });
        this.dispatchEvent(event);
        this.onmessage?.call(this, event);
        return;
      }
      case 'error':
        this.emitError(typeof value.payload === 'string' ? value.payload : 'shared websocket error');
        return;
      case 'close':
        this.handleLogicalClose(
          value.code ?? 1006,
          value.reason ?? '',
          value.was_clean ?? false
        );
    }
  }

  private handleLogicalClose(code: number, reason: string, wasClean: boolean): void {
    this.opening = false;
    this.readyState = OresSharedSocket.CLOSED;
    const event = new CloseEvent('close', { code, reason, wasClean });
    this.dispatchEvent(event);
    this.onclose?.call(this, event);
    if (this.manualClose || !this.suspended) this.finalize();
  }

  private finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    clearInterval(this.heartbeatTimer);
    globalThis.removeEventListener?.('pagehide', this.pageHideHandler);
    globalThis.removeEventListener?.('pageshow', this.pageShowHandler);
    this.pendingActions.clear();
    this.port.close();
  }

  private emitError(message: string): void {
    const event = new CustomEvent('error', { detail: { message } });
    this.dispatchEvent(event);
    this.onerror?.call(this, event);
  }
}

export function createOresSharedSocket(
  address: string | URL,
  options: OresSharedSocketOptions
): OresSharedSocket {
  return new OresSharedSocket(address, options);
}
