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

## Copying the real Neon content

Neon is still the source of truth. Once its quota is restored, run:

```bash
npm run supabase:migrate-neon
```

That copies every `trn_*` row (live events, past events, gallery, albums, settings and media) and every stored file from Neon into Supabase. It rewrites media URLs to Supabase public URLs so the site keeps working while Neon is unavailable.

## Configuration

These values are already in `.env.local` for local development:

```env
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SECRET_KEY=...
```

For Vercel, add the same three variables (server-side only). Do **not** expose `SUPABASE_SECRET_KEY` with a `NEXT_PUBLIC_` or `VITE_` prefix.
