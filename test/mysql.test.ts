import { after } from 'node:test';
import { createPool } from 'mysql2/promise';
import { config } from '../libs/common/src/config';
import { migrate } from '../libs/database/src/migrate';
import { WebhookRepository } from '../apps/webhook/src/webhook.repository';
import { webhookContract } from './contract';

const database = process.env.TEST_DB_NAME ?? 'webhook_api_test';
if (!database.endsWith('_test')) throw new Error('TEST_DB_NAME must end in _test; tests delete records in this database');
if (database.toLowerCase() === config.database.database.toLowerCase()) throw new Error('TEST_DB_NAME must differ from DB_NAME; tests delete records in this database');
const pool = createPool({ ...config.database, database });
let initialized = false;
webhookContract('API and delivery contract (real MySQL)', async () => {
  if (!initialized) {
    await migrate(pool);
    initialized = true;
  }
  await pool.query('DELETE FROM deliveries');
  await pool.query('DELETE FROM endpoint_subscriptions');
  await pool.query('DELETE FROM events');
  await pool.query('DELETE FROM webhook_endpoints');
  return { repository: new WebhookRepository(pool) };
});
after(async () => {
  await pool.end();
});
