import { env } from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

const threshold = LEVELS[env.LOG_LEVEL];

/** Keys whose values must never reach a log sink. */
const SECRET_KEYS = new Set([
  'accesstoken',
  'access_token',
  'token',
  'password',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'hmac',
  'signature',
  'encryptedtoken',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

function emit(level: Level, bindings: Record<string, unknown>, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(redact(bindings) as Record<string, unknown>),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  };
  const line = JSON.stringify(record);
  if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

function make(bindings: Record<string, unknown>): Logger {
  return {
    debug: (m, f) => emit('debug', bindings, m, f),
    info: (m, f) => emit('info', bindings, m, f),
    warn: (m, f) => emit('warn', bindings, m, f),
    error: (m, f) => emit('error', bindings, m, f),
    child: (extra) => make({ ...bindings, ...extra }),
  };
}

export const logger: Logger = make({});
