import { createPool } from 'mysql2/promise';
import { config } from '../../common/src/config';
export function createDatabasePool() { return createPool(config.database); }
