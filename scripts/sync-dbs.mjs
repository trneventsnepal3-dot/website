import { createSync } from '../server/sync.mjs';

const sync = createSync();
if (!sync.enabled) {
  console.log('Sync is disabled. Add DATABASE_URL, SUPABASE_URL and SUPABASE_SECRET_KEY, and do not set DB_SYNC_ENABLED=false.');
} else {
  const result = await sync.flush();
  if (!result.results.length) console.log('Databases are already queued and up to date. No sync was needed.');
  for (const item of result.results) {
    if (item.ok) console.log(`${item.source} -> ${item.target}: synced.`);
    else { console.error(`${item.source} -> ${item.target}: ${item.error}`); process.exitCode = 1; }
  }
}
