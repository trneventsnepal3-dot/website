import { GetObjectCommand } from '@aws-sdk/client-s3';
import { neon } from '@neondatabase/serverless';
import { createStorage } from '../server/storage.mjs';

const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required to read Neon.');
if (!base || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required to write Supabase.');

const sql = neon(process.env.DATABASE_URL);
const storage = createStorage();
const headers = extra => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'x-client-info': 'trn-server',
  ...extra,
});
const publicUrl = (bucket, pathname) => `${base}/storage/v1/object/public/${bucket}/${pathname.split('/').map(encodeURIComponent).join('/')}`;
const galleryBase = `${base}/storage/v1/object/public/${process.env.SUPABASE_MEDIA_BUCKET || 'media'}`;
const isSyncMarker = name => String(name || '').startsWith('trn_sync:');

async function check(response, action) {
  if (response.ok) return response;
  throw new Error(`${action} failed (${response.status}): ${await response.text()}`);
}

async function upsert(table, rows, onConflict = 'id') {
  if (!rows.length) return;
  await check(fetch(`${base}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  }), `Copying ${table}`);
  console.log(`${table}: ${rows.length} row(s) copied`);
}

async function ensureBuckets() {
  for (const name of ['media', 'song', 'herosectionvideo']) {
    const response = await fetch(`${base}/storage/v1/bucket`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name, public: true }),
    });
    const text = await response.text();
    if (!response.ok && !text.includes('BucketAlreadyExists')) throw new Error(`Supabase bucket setup failed (${response.status}): ${text}`);
  }
}

async function copyMedia() {
  const rows = await sql.query('SELECT * FROM trn_media ORDER BY created_at,id');
  const supabaseRows = [];
  for (const row of rows) {
    const bucket = row.storage_bucket || storage.bucket(row.kind);
    let url = row.url;
    try {
      const object = await storage.getClient().send(new GetObjectCommand({ Bucket: bucket, Key: row.pathname }));
      const bytes = await object.Body.transformToByteArray();
      await check(fetch(`${base}/storage/v1/object/${bucket}/${row.pathname.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'PUT',
        headers: headers({ 'Content-Type': row.content_type || 'application/octet-stream', 'x-upsert': 'true' }),
        body: bytes,
      }), `Uploading ${row.pathname}`);
      url = publicUrl(bucket, row.pathname);
      console.log(`${row.pathname}: copied`);
    } catch (error) {
      console.warn(`${row.pathname}: file skipped (${error.message})`);
    }
    supabaseRows.push({ ...row, url, storage_bucket: bucket });
  }
  await upsert('trn_media', supabaseRows);
}

async function main() {
  try {
    await sql.query('select 1');
  } catch (error) {
    const status = error.statusCode || error.status || /HTTP status (\d+)/.exec(error.message || '')?.[1] || 'database error';
    throw new Error(`Neon cannot be read right now (${status}). Upgrade or restore the Neon quota, then rerun this command. Your Neon data is still there.`);
  }

  await ensureBuckets();
  await copyMedia();

  const settings = await sql.query('SELECT * FROM trn_settings WHERE id=1');
  if (settings.length) await upsert('trn_settings', [{ ...settings[0], gallery_base_url: galleryBase }]);

  const albums = await sql.query('SELECT * FROM trn_albums ORDER BY position,id');
  await upsert('trn_albums', albums.map(({ position, ...row }) => row));

  const gallery = await sql.query('SELECT * FROM trn_gallery ORDER BY position,id');
  await upsert('trn_gallery', gallery.map(({ position, ...row }) => row));

  const events = await sql.query('SELECT * FROM trn_events ORDER BY id');
  await upsert('trn_events', events);

  const migrations = await sql.query('SELECT * FROM trn_migrations ORDER BY name');
  await upsert('trn_migrations', migrations.filter(row => !isSyncMarker(row.name)), 'name');

  console.log('Neon data and media have been copied to Supabase. Future changes are kept in sync by the queued sync.');
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
