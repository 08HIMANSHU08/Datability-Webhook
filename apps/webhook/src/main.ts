import { logger } from '../../../libs/common/src/logger';
import { config } from '../../../libs/common/src/config';
import { createDatabasePool } from '../../../libs/database/src/pool';
import { createApp } from './app';
import { WebhookRepository } from './webhook.repository';

async function main() {
  const pool = createDatabasePool();
  try {
    await pool.query('SELECT 1 FROM schema_migrations LIMIT 1');
    const app = createApp(new WebhookRepository(pool), config.delivery);
    const server = app.listen(config.port, () => logger.info('Webhook API listening', { port: config.port }));
    server.on('error', (error) => {
      logger.error('HTTP server failed', { errorType: error.name });
      void pool.end();
      process.exitCode = 1;
    });
    const shutdown = () => {
      logger.info('Shutting down Webhook API');
      server.close(() => { void pool.end(); });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    await pool.end();
    throw error;
  }
}
main().catch((error) => {
  logger.error('Startup failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
  process.exitCode = 1;
});
