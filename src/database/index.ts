import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

export const pool =
  global.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== 'production') global.__pgPool = pool;

export const db = drizzle(pool);
