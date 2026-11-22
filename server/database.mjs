import { neon } from '@neondatabase/serverless';
import { createSupabaseQuery } from './supabase.mjs';

const NEON_RETRY_MS = Number(process.env.NEON_RETRY_MS || 60_000);

function isNeonOutage(error) {
  const status = error?.statusCode ?? error?.status ?? Number(/HTTP status (\d+)/.exec(error?.message || '')?.[1] || 0);
  if (status === 402 || status >= 500) return true;
  return /fetch failed|timeout|timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up/i.test(error?.message || '');
}

function deletedKey(statement, values, rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const sql = String(statement).replace(/\s+/g, ' ').trim();
  const entity = /^DELETE FROM (trn_(?:events|gallery|albums)) WHERE id=\$1(?: AND revision=\$2)?(?: RETURNING id)?$/i.exec(sql);
  if (entity) return { table: entity[1], pk: 'id', value: values[0] };
  if (/^DELETE FROM trn_sessions WHERE token=\$1$/i.test(sql)) return { table: 'trn_sessions', pk: 'token', value: values[0] };
  return null;
}

export function createDatabase(env = process.env, query, onWrite) {
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
    const write = /^\s*(INSERT|UPDATE|DELETE)\b/i.exec(statement)?.[1]?.toLowerCase() || '';
    const finish = async (rows, source) => {
      if (write && onWrite) {
        try { await onWrite(source, write === 'delete' ? deletedKey(statement, values, rows) : null); }
        catch (error) { console.warn(`TRN sync could not queue ${source} changes: ${error.message}`); }
      }
      return rows;
    };

    if (active === 'neon') {
      let rows;
      try { rows = await neonSql.query(statement, values); }
      catch (error) {
        if (!supabase || !isNeonOutage(error)) throw error;
        active = 'supabase';
        retryNeonAt = Date.now() + NEON_RETRY_MS;
        console.warn('Neon is unavailable; using Supabase until Neon recovers.');
        return finish(await supabase(statement, values), 'supabase');
      }
      return finish(rows, 'neon');
    }

    if (!forceSupabase && neonSql && Date.now() >= retryNeonAt) {
      try {
        const rows = await neonSql.query(statement, values);
        active = 'neon';
        console.log('Neon is available again; primary database restored.');
        return finish(rows, 'neon');
      } catch (error) {
        retryNeonAt = Date.now() + NEON_RETRY_MS;
        if (!isNeonOutage(error)) throw error;
      }
    }

    if (!supabase) throw new Error('Supabase is not configured.');
    return finish(await supabase(statement, values), 'supabase');
  };
}
