# Supabase fallback

`DB_PRIMARY=supabase` is set in `.env.local`, so Supabase is the active backend now. Remove that line (or set `DB_PRIMARY=neon`) to return to Neon-first behaviour. Without the override, Neon is tried first and Supabase is used automatically during quota/network errors, with a Neon retry every 60 seconds.

## One-time Supabase setup

1. Open the Supabase SQL Editor for this project.
2. Paste the entire contents of `server/schema.sql` and run it. This creates the `trn_*` tables.
3. Return here and run:

```bash
npm run supabase:setup
```

That command creates the public `media`, `song` and `herosectionvideo` buckets, uploads the bundled media, and seeds the same starter event/gallery/album rows used by the local site. It is safe to rerun: existing settings revisions, events, albums, captions and uploaded media are preserved.

## Keeping Neon and Supabase in sync

Both adapters are active. Every successful database write queues a sync from the database that accepted the write to the other one. The sync copies all `trn_*` rows, revisions and media files, so shared records converge to the same values. Future deletes are recorded as tombstones and applied to the other database. Writes are never blocked when Neon is unavailable: Supabase keeps accepting changes, and Neon is reconciled on the next request once it is reachable.

Sync attempts are throttled to once per minute (`SYNC_RETRY_MS`). A failed media copy keeps the item queued, so it is retried instead of being silently skipped. You can trigger a sync manually:

```bash
npm run db:sync
npm run db:verify
```

`db:verify` compares every table and reports row, revision, media path, size and URL differences without changing anything. Legacy rows that already existed on only one side are preserved; the initial divergence is never deleted automatically. Once you choose a source of truth, you can make the mirror strict by deleting target rows that are missing from the source.

## Copying the original Neon content

If you later decide Neon should be the source of truth for the older records, restore its quota and run:

```bash
npm run supabase:migrate-neon
```

That copies every `trn_*` row (live events, past events, gallery, albums, settings and media) and every stored file from Neon into Supabase. It rewrites media URLs to Supabase public URLs so the site keeps working while Neon is unavailable. Sync marker rows are excluded.

## Configuration

These values are already in `.env.local` for local development:

```env
DB_PRIMARY=supabase
DB_SYNC_ENABLED=true
SYNC_RETRY_MS=60000
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
```

For Vercel, add the variables shown above (server-side only). `DATABASE_URL` must remain configured so the sync can reach Neon. Do **not** expose `SUPABASE_SECRET_KEY` with a `NEXT_PUBLIC_` or `VITE_` prefix.
