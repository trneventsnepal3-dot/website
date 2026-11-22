import { neon } from '@neondatabase/serverless';
import { createSupabaseQuery } from './supabase.mjs';

const NEON_RETRY_MS = Number(process.env.NEON_RETRY_MS || 60_000);

function isNeonOutage(error) {
  const status = error?.statusCode ?? error?.status ?? Number(/HTTP status (\d+)/.exec(error?.message || '')?.[1] || 0);
  if (status === 402 || status >= 500) return true;
  return /fetch failed|timeout|timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up/i.test(error?.message || '');
}

export function createDatabase(env = process.env, query) {
  if (query) return async (statement, values = []) => query(statement, values);

  const neonSql = env.DATABASE_URL ? neon(env.DATABASE_URL) : null;
  const supabase = env.SUPABASE_URL && (env.SUPABASE_SECRET_KEY || env.SUPABASE_PUBLISHABLE_KEY)
    ? createSupabaseQuery(env)
    : null;

  if (!neonSql && !supabase) {
    return async () => { throw new Error('Add DATABASE_URL or Supabase credentials before starting the server.'); };
  }

  const forceSupabase = String(env.DB_PRIMARY || '').toLowerCase() === 'supabase' && Boolean(supabase);
  let active = forceSupabase || !neonSql ? 'supabase' : 'neon';
  let retryNeonAt = 0;

  return async function db(statement, values = []) {
    if (active === 'neon') {
      try {
        return await neonSql.query(statement, values);
      } catch (error) {
        if (!supabase || !isNeonOutage(error)) throw error;
        active = 'supabase';
        retryNeonAt = Date.now() + NEON_RETRY_MS;
        console.warn('Neon is unavailable; using Supabase until Neon recovers.');
        return supabase(statement, values);
      }
    }

    if (!forceSupabase && neonSql && Date.now() >= retryNeonAt) {
      try {
        const rows = await neonSql.query(statement, values);
        active = 'neon';
        console.log('Neon is available again; primary database restored.');
        return rows;
      } catch (error) {
        retryNeonAt = Date.now() + NEON_RETRY_MS;
        if (!isNeonOutage(error)) throw error;
      }
    }

    if (!supabase) throw new Error('Supabase is not configured.');
    return supabase(statement, values);
  };
}
