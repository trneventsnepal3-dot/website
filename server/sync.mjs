import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { neon } from '@neondatabase/serverless';
import { createStorage } from './storage.mjs';

const MARKER_PREFIX = 'trn_sync:pending:';
const TOMB_PREFIX = 'trn_sync:tomb:';
export const TABLES = [
  { name: 'trn_settings', pk: ['id'] },
  { name: 'trn_sessions', pk: ['token'] },
  { name: 'trn_login_limits', pk: ['key'] },
  { name: 'trn_media', pk: ['id'] },
  { name: 'trn_albums', pk: ['id'] },
  { name: 'trn_gallery', pk: ['id'] },
  { name: 'trn_events', pk: ['id'] },
  { name: 'trn_migrations', pk: ['name'] },
];
const JSONB_COLUMNS = new Set(['stops']);
const IDENTITY_COLUMNS = new Set(['position']);

const cleanBase = value => String(value || '').replace(/\/$/, '');
const markerName = source => `${MARKER_PREFIX}${source}`;
const attemptPrefix = source => `trn_sync:attempt:${source}:`;
const tombstonePrefix = source => `${TOMB_PREFIX}${source}:`;
export const tombstoneName = (source, deletion) => `${tombstonePrefix(source)}${Buffer.from(JSON.stringify(deletion)).toString('base64url')}`;
export const decodeTombstone = (source, name) => {
  try {
    const value = JSON.parse(Buffer.from(name.slice(tombstonePrefix(source).length), 'base64url').toString('utf8'));
    return TABLES.find(config => config.name === value.table && config.pk[0] === value.pk && value.value !== undefined) ? value : null;
  } catch { return null; }
};
const quote = value => `"${String(value).replace(/"/g, '""')}"`;

function supabaseConfigured(env) {
  return Boolean(env.SUPABASE_URL && (env.SUPABASE_SECRET_KEY || env.SUPABASE_PUBLISHABLE_KEY));
}

function supabaseHeaders(env, extra = {}) {
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'x-client-info': 'trn-sync', ...extra };
}

async function supabaseRequest(env, path, options = {}) {
  const response = await fetch(`${cleanBase(env.SUPABASE_URL)}/${path.replace(/^\//, '')}`, {
    method: options.method || 'GET',
    headers: supabaseHeaders(env, options.headers),
    body: options.body,
  });
  if (!response.ok) throw new Error(`Supabase ${options.method || 'GET'} ${path} failed (${response.status}): ${await response.text()}`);
  if (response.status === 204) return [];
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

function bucketForKind(env, kind) {
  return ({ popup: env.NEON_MEDIA_BUCKET || 'media', event: env.NEON_MEDIA_BUCKET || 'media', gallery: env.NEON_MEDIA_BUCKET || 'media', audio: env.NEON_SONG_BUCKET || 'song', hero: env.NEON_HERO_BUCKET || 'herosectionvideo' })[kind] || 'media';
}

function mediaBucket(env, row) {
  return row.storage_bucket || bucketForKind(env, row.kind);
}

function mediaPath(row) {
  return String(row.pathname || '').split('/').map(encodeURIComponent).join('/');
}

function supabaseMediaUrl(env, row) {
  const bucket = mediaBucket(env, row);
  return `${cleanBase(env.SUPABASE_URL)}/storage/v1/object/public/${bucket}/${mediaPath(row)}`;
}

function normalizeRow(table, row) {
  const value = JSON.parse(JSON.stringify(row, (_key, item) => item instanceof Date ? item.toISOString() : item));
  if (table === 'trn_events') {
    if (value.event_date) value.event_date = String(value.event_date).slice(0, 10);
    if (value.end_date) value.end_date = String(value.end_date).slice(0, 10);
  }
  for (const column of IDENTITY_COLUMNS) {
    if (value[column] !== null && value[column] !== undefined) value[column] = Number(value[column]);
  }
  return value;
}

function withoutMarkers(rows) {
  return rows.filter(row => !String(row.name || '').startsWith('trn_sync:'));
}

async function fetchSupabaseSnapshot(env) {
  const snapshot = {};
  for (const { name } of TABLES) {
    const rows = await supabaseRequest(env, `rest/v1/${name}?select=*`);
    snapshot[name] = (name === 'trn_migrations' ? withoutMarkers(rows) : rows).map(row => normalizeRow(name, row));
  }
  return snapshot;
}

async function upsertSupabaseRows(env, table, rows, config) {
  if (!rows.length) return;
  const values = rows.map(row => Object.fromEntries(Object.entries(row)
    .filter(([column]) => !IDENTITY_COLUMNS.has(column))
    .map(([column, value]) => [column, value])));
  await supabaseRequest(env, `rest/v1/${table}?on_conflict=${config.pk.join(',')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(values),
  });
}

async function applyDeletions(env, sql, target, deletions) {
  for (const deletion of deletions) {
    if (target === 'supabase') {
      await supabaseRequest(env, `rest/v1/${deletion.table}?${deletion.pk}=eq.${encodeURIComponent(deletion.value)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    } else {
      await sql.query(`DELETE FROM ${quote(deletion.table)} WHERE ${quote(deletion.pk)}=$1`, [deletion.value]);
    }
  }
}

async function downloadSupabaseObject(env, row) {
  const response = await fetch(`${cleanBase(env.SUPABASE_URL)}/storage/v1/object/${mediaBucket(env, row)}/${mediaPath(row)}`, { headers: supabaseHeaders(env) });
  if (!response.ok) throw new Error(`Supabase object ${row.pathname} failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

async function uploadSupabaseObject(env, row, bytes) {
  await supabaseRequest(env, `storage/v1/object/${mediaBucket(env, row)}/${mediaPath(row)}`, {
    method: 'PUT',
    headers: { 'Content-Type': row.content_type || 'application/octet-stream', 'x-upsert': 'true' },
    body: bytes,
  });
}

async function writeSupabaseMarker(env, name, present) {
  if (present) {
    await supabaseRequest(env, 'rest/v1/trn_migrations?on_conflict=name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ name }),
    });
  } else {
    await supabaseRequest(env, `rest/v1/trn_migrations?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' });
  }
}

async function readSupabaseMarkers(env) {
  const rows = await supabaseRequest(env, 'rest/v1/trn_migrations?select=name');
  return rows.map(row => String(row.name || ''));
}

async function fetchNeonSnapshot(sql) {
  const snapshot = {};
  for (const { name } of TABLES) {
    const rows = await sql.query(`SELECT * FROM ${name}`);
    snapshot[name] = (name === 'trn_migrations' ? withoutMarkers(rows) : rows).map(row => normalizeRow(name, row));
  }
  return snapshot;
}

export async function upsertNeonRows(sql, table, rows, config) {
  if (!rows.length) return;
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(column => !IDENTITY_COLUMNS.has(column) || config.identity);
  const placeholders = rows.map((_row, rowIndex) => `(${columns.map((column, columnIndex) => {
    const position = rowIndex * columns.length + columnIndex + 1;
    return JSONB_COLUMNS.has(column) ? `$${position}::jsonb` : `$${position}`;
  }).join(',')})`);
  const updates = columns.filter(column => !config.pk.includes(column) && !IDENTITY_COLUMNS.has(column)).map(column => `${quote(column)}=EXCLUDED.${quote(column)}`);
  const override = config.identity ? ' OVERRIDING SYSTEM VALUE' : '';
  const conflict = updates.length ? `DO UPDATE SET ${updates.join(',')}` : 'DO NOTHING';
  const statement = `INSERT INTO ${table} (${columns.map(quote).join(',')})${override} VALUES ${placeholders.join(', ')} ON CONFLICT (${config.pk.map(quote).join(',')}) ${conflict}`;
  const params = rows.flatMap(row => columns.map(column => {
    const value = row[column] ?? null;
    return JSONB_COLUMNS.has(column) && value !== null && typeof value !== 'string' ? JSON.stringify(value) : value;
  }));
  await sql.query(statement, params);
}

async function downloadNeonObject(storage, env, row) {
  const object = await storage.getClient().send(new GetObjectCommand({ Bucket: mediaBucket(env, row), Key: row.pathname }));
  return Buffer.from(await object.Body.transformToByteArray());
}

async function uploadNeonObject(storage, env, row, bytes) {
  await storage.getClient().send(new PutObjectCommand({ Bucket: mediaBucket(env, row), Key: row.pathname, Body: bytes, ContentType: row.content_type || 'application/octet-stream' }));
}

async function writeNeonMarker(sql, name, present) {
  if (present) await sql.query('INSERT INTO trn_migrations(name) VALUES($1) ON CONFLICT(name) DO NOTHING', [name]);
  else await sql.query('DELETE FROM trn_migrations WHERE name=$1', [name]);
}

async function readNeonMarkers(sql) {
  const rows = await sql.query('SELECT name FROM trn_migrations');
  return rows.map(row => String(row.name || ''));
}

async function syncSnapshot(env, sql, source, target) {
  const snapshot = source === 'supabase' ? await fetchSupabaseSnapshot(env) : await fetchNeonSnapshot(sql);

  if (target === 'supabase') {
    const galleryBase = `${cleanBase(env.SUPABASE_URL)}/storage/v1/object/public/${env.SUPABASE_MEDIA_BUCKET || 'media'}`;
    snapshot.trn_settings = snapshot.trn_settings.map(row => ({ ...row, gallery_base_url: galleryBase }));
    snapshot.trn_media = snapshot.trn_media.map(row => ({ ...row, url: supabaseMediaUrl(env, row) }));
  }

  for (const config of TABLES) {
    if (target === 'supabase') await upsertSupabaseRows(env, config.name, snapshot[config.name], config);
    else await upsertNeonRows(sql, config.name, snapshot[config.name], { ...config, identity: config.name === 'trn_albums' || config.name === 'trn_gallery' });
  }

  const storage = createStorage(env);
  const failures = [];
  for (const row of snapshot.trn_media) {
    if (!row.pathname) continue;
    try {
      const bytes = source === 'supabase' ? await downloadSupabaseObject(env, row) : await downloadNeonObject(storage, env, row);
      if (target === 'supabase') await uploadSupabaseObject(env, row, bytes);
      else await uploadNeonObject(storage, env, row, bytes);
    } catch (error) {
      failures.push(`${row.pathname}: ${error.message}`);
      console.warn(`TRN sync skipped media ${row.pathname}: ${error.message}`);
    }
  }
  return failures;
}

export function createSync(env = process.env, { query } = {}) {
  const enabled = !query && Boolean(env.DATABASE_URL && supabaseConfigured(env)) && String(env.DB_SYNC_ENABLED ?? 'true').toLowerCase() !== 'false';
  const sql = enabled ? neon(env.DATABASE_URL) : null;
  const retryMs = Number(env.SYNC_RETRY_MS || 60_000);
  const io = enabled ? {
    supabase: { read: () => readSupabaseMarkers(env), write: (name, present) => writeSupabaseMarker(env, name, present) },
    neon: { read: () => readNeonMarkers(sql), write: (name, present) => writeNeonMarker(sql, name, present) },
  } : {};
  const sources = () => String(env.DB_PRIMARY || '').toLowerCase() === 'supabase' ? ['supabase'] : ['supabase', 'neon'];

  return {
    enabled,
    snapshot: source => source === 'supabase' ? fetchSupabaseSnapshot(env) : fetchNeonSnapshot(sql),
    async mark(source, deletion) {
      if (!enabled || !io[source]) return;
      try {
        if (deletion) await io[source].write(tombstoneName(source, deletion), true);
        await io[source].write(markerName(source), true);
      } catch (error) { console.warn(`TRN sync could not queue ${source} changes: ${error.message}`); }
    },
    async flush() {
      if (!enabled) return { enabled: false, synced: false, results: [] };
      const results = [];
      for (const source of sources()) {
        let markers;
        try { markers = await io[source].read(); }
        catch (error) {
          console.warn(`TRN sync could not check ${source}: ${error.message}`);
          continue;
        }
        const tombstones = markers.filter(name => name.startsWith(tombstonePrefix(source)));
        const deletions = tombstones.map(name => decodeTombstone(source, name)).filter(Boolean);
        if (!markers.includes(markerName(source)) && !deletions.length) continue;
        const attempts = markers.filter(name => name.startsWith(attemptPrefix(source)));
        const lastAttempt = Math.max(0, ...attempts.map(name => Number(name.slice(attemptPrefix(source).length)) || 0));
        if (Date.now() - lastAttempt < retryMs) continue;
        const target = source === 'supabase' ? 'neon' : 'supabase';
        try {
          for (const name of attempts) await io[source].write(name, false);
          await io[source].write(`${attemptPrefix(source)}${Date.now()}`, true);
          if (deletions.length) await applyDeletions(env, sql, target, deletions);
          const failures = await syncSnapshot(env, sql, source, target);
          if (failures.length) {
            const error = `Media copy failed: ${failures.join('; ')}`;
            results.push({ source, target, ok: false, error });
            console.warn(`TRN sync failed (${source} -> ${target}): ${error}`);
            continue;
          }
          await io[source].write(markerName(source), false);
          for (const name of tombstones) await io[source].write(name, false);
          results.push({ source, target, ok: true });
        } catch (error) {
          results.push({ source, target, ok: false, error: error.message });
          console.warn(`TRN sync failed (${source} -> ${target}): ${error.message}`);
        }
      }
      return { enabled: true, synced: results.some(result => result.ok), results };
    },
  };
}
