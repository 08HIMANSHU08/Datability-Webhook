import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envFile = resolve('.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

function integer(name: string, fallback: number, min: number, max: number): number {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

export interface DeliveryConfig {
  timeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  concurrency: number;
}
export const config = {
  port: integer('PORT', 3000, 1, 65535),
  database: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: integer('DB_PORT', 3306, 1, 65535),
    user: process.env.DB_USER ?? 'webhook',
    password: process.env.DB_PASSWORD ?? 'webhook_local',
    database: process.env.DB_NAME ?? 'webhook_api',
    connectionLimit: integer('DB_CONNECTION_LIMIT', 10, 1, 100),
    connectTimeout: 5000,
    timezone: 'Z',
    dateStrings: true,
  },
  delivery: {
    timeoutMs: integer('DELIVERY_TIMEOUT_MS', 5000, 1, 60000),
    maxAttempts: integer('DELIVERY_MAX_ATTEMPTS', 3, 1, 3),
    retryDelayMs: integer('DELIVERY_RETRY_DELAY_MS', 100, 0, 60000),
    concurrency: integer('DELIVERY_CONCURRENCY', 10, 1, 100),
  } satisfies DeliveryConfig,
};
