import pg from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import { adaptSqlForPostgres, toPgParams } from './sql.js';
import { logger } from '../logger.js';

const { Pool } = pg;

let pool = null;
export const pgTxStore = new AsyncLocalStorage();

function sslConfig() {
  if (process.env.PGSSL !== 'true') return undefined;
  if (process.env.PGSSL_REJECT_UNAUTHORIZED === 'true') {
    return { rejectUnauthorized: true };
  }
  // Shared / self-signed remote endpoints
  return { rejectUnauthorized: false };
}

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required for Postgres mode');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig(),
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
    });
    pool.on('error', (err) => {
      logger.error('postgres_pool_error', { message: err.message });
    });
  }
  return pool;
}

function activeClient() {
  return pgTxStore.getStore() || null;
}

export async function pgQuery(sql, params = [], client = null) {
  const adapted = adaptSqlForPostgres(sql);
  const { text, values } = toPgParams(adapted, params);
  const runner = client || activeClient() || getPool();
  if (process.env.DEBUG_SQL === '1') {
    logger.debug('pg_query', { text });
  }
  return runner.query(text, values);
}

export async function pgRun(sql, params = [], client = null) {
  let statement = sql.trim();
  const isInsert = /^INSERT\s+/i.test(statement);
  if (isInsert && !/\bRETURNING\b/i.test(statement)) {
    statement = `${statement.replace(/;?\s*$/, '')} RETURNING id`;
  }
  const result = await pgQuery(statement, params, client);
  const row = result.rows?.[0];
  return {
    lastInsertRowid: row?.id ?? null,
    changes: result.rowCount ?? 0,
    rows: result.rows,
  };
}

export async function pgGet(sql, params = [], client = null) {
  const result = await pgQuery(sql, params, client);
  return result.rows[0] || undefined;
}

export async function pgAll(sql, params = [], client = null) {
  const result = await pgQuery(sql, params, client);
  return result.rows;
}

export async function pgTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const tx = {
      driver: 'postgres',
      run: (sql, params) => pgRun(sql, params, client),
      get: (sql, params) => pgGet(sql, params, client),
      all: (sql, params) => pgAll(sql, params, client),
      query: (sql, params) => pgQuery(sql, params, client),
      prepare(sql) {
        return {
          all: async (...args) => pgAll(sql, normalizeParams(args), client),
          get: async (...args) => pgGet(sql, normalizeParams(args), client),
          run: async (...args) => pgRun(sql, normalizeParams(args), client),
        };
      },
    };
    const result = await pgTxStore.run(client, () => fn(tx));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

function normalizeParams(args) {
  if (args.length === 0) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

export async function pingDatabase() {
  const result = await pgQuery('SELECT 1 AS ok');
  return result.rows?.[0]?.ok === 1;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
