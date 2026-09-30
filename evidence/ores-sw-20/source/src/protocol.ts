export const WORKER_PROTOCOL_VERSION = 'ores.sw.worker/v1' as const;

export type WorkerKind = 'controller' | 'sync' | 'validation' | 'compute' | 'jobs' | 'socket';

export interface WorkerRequest {
  protocol_version: typeof WORKER_PROTOCOL_VERSION;
  request_id: string;
  worker: WorkerKind;
  action: string;
  payload?: unknown;
}

export interface WorkerResponse {
  protocol_version: typeof WORKER_PROTOCOL_VERSION;
  request_id: string;
  worker: WorkerKind;
  ok: boolean;
  payload?: unknown;
  error?: string;
}

const WORKER_KINDS = new Set<WorkerKind>(['controller', 'sync', 'validation', 'compute', 'jobs', 'socket']);
export const MAX_REQUEST_ID_BYTES = 256;
const MAX_ACTION_BYTES = 128;
const MAX_ERROR_LENGTH = 1024;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const ACTION_PATTERN = /^[a-z][a-z0-9_]*$/;

export function isWorkerRequestId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_REQUEST_ID_BYTES
    && REQUEST_ID_PATTERN.test(value);
}

export function isWorkerAction(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ACTION_BYTES
    && ACTION_PATTERN.test(value);
}

export function isWorkerRequest(value: unknown): value is WorkerRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.protocol_version === WORKER_PROTOCOL_VERSION
    && isWorkerRequestId(candidate.request_id)
    && typeof candidate.worker === 'string'
    && WORKER_KINDS.has(candidate.worker as WorkerKind)
    && isWorkerAction(candidate.action);
}

export function ok(request: WorkerRequest, payload?: unknown): WorkerResponse {
  return {
    protocol_version: WORKER_PROTOCOL_VERSION,
    request_id: request.request_id,
    worker: request.worker,
    ok: true,
    ...(payload === undefined ? {} : { payload })
  };
}

export function fail(request: WorkerRequest, error: string): WorkerResponse {
  return {
    protocol_version: WORKER_PROTOCOL_VERSION,
    request_id: request.request_id,
    worker: request.worker,
    ok: false,
    error: error.slice(0, MAX_ERROR_LENGTH)
  };
}
