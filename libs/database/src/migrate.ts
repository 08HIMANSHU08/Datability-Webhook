import { logger } from '../../common/src/logger';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Pool } from 'mysql2/promise';
import { createDatabasePool } from './pool';

export async function migrate(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(255) PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)))');
    const directory = resolve('apps/webhook/database/migrations');
    for (const name of readdirSync(directory)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      const [applied] = await connection.query('SELECT name FROM schema_migrations WHERE name = ?', [name]);
      if ((applied as unknown[]).length) continue;
      for (const sql of readFileSync(resolve(directory, name), 'utf8')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean))
        await connection.query(sql);
      await connection.execute('INSERT INTO schema_migrations (name) VALUES (?)', [name]);
      logger.info('Migration applied', { migration: name });
    }
  } finally {
    connection.release();
  }
}
if (require.main === module) {
  const pool = createDatabasePool();
  migrate(pool)
    .catch((error) => {
      logger.error('Migration failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
