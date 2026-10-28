# TRN Events Nepal

React + Vite website with a password-protected `/admin` panel, hosted on Vercel. Settings and sessions use Neon Postgres. Files use your public-read Neon Object Storage buckets:

- `media`: popup images, original gallery photos, and the hero poster.
- `song`: looping audio.
- `herosectionvideo`: opening film.

Vercel Blob is no longer used.

## Setup

1. Run `npm install`. `.env` has been created locally; `.env.example` is the template for other environments.
2. Add your Neon Postgres connection string as `DATABASE_URL`.
3. Run `npm run admin:password` in your terminal. It prompts for a password without displaying it. Add the generated `ADMIN_PASSWORD_HASH` to `.env`.
4. Add the storage credentials from the **same Neon branch as your buckets**:

   ```dotenv
   AWS_ENDPOINT_URL_S3=https://your-branch-storage-endpoint
   AWS_REGION=your-region
   AWS_ACCESS_KEY_ID=your-storage-access-key-id
   AWS_SECRET_ACCESS_KEY=your-storage-secret-key
   NEON_MEDIA_BUCKET=media
   NEON_SONG_BUCKET=song
   NEON_HERO_BUCKET=herosectionvideo
   ```

   The credential needs `storage:read` and `storage:write`. Obtain the S3 endpoint, region and scoped credentials from Neon; the Postgres connection string is separate. Do not prefix any of these values with `VITE_`.
5. Run `npm run db:migrate`. It is safe to rerun when updating this project.
6. Run `npm run storage:check` to verify that all three buckets are accessible.
7. Allow browser uploads from your website origins:

   ```sh
   npm run storage:cors -- https://your-site.vercel.app http://localhost:5190
   ```

   Use your actual production/custom domains and local development port. The command merges this project's origins into its named CORS rule and preserves other rules. It allows GET, HEAD and PUT. It does not change the buckets' public-read access level.
8. Run `npm run dev -- --port 5190`. Visit `/admin` to sign in. Restart development after changing `.env`.

Neon's [storage quickstart](https://neon.com/docs/storage/get-started) explains credentials. Its [S3 compatibility reference](https://neon.com/docs/storage/s3-compatibility) documents path-style addressing, signed uploads and CORS.

## Move the existing website media to Neon

Run `npm run storage:sync` after storage and the database are configured. It uploads the nine existing gallery photos and poster into `media/trn/original/`, and the original film into `herosectionvideo/trn/original/`. It skips existing keys, verifies anonymous public access, then publishes the gallery's Neon base URL and the original hero selection in the database. It preserves a custom hero already selected in admin and retains all local source files. No song is uploaded automatically.

Until this command is run, the original gallery and hero continue using the local assets. New popup, song and hero uploads from admin always use Neon. Replacing the hero through admin overrides the original film. **Use original film** restores the bundled original.

## Vercel deployment

Import this repository as a Vite project using Node 22 or newer. Copy the environment variables from `.env.example` into Vercel project environment settings, with their real values. Run the migration against the target Neon database and configure the deployed domain with `storage:cors`. The API runs in one Vercel Node function: `vercel.json` rewrites all `/api/*` paths to `api/router.js`, including nested admin and event routes, and serves React at `/admin`. Do not replace this with a Next.js-style catch-all filename; this is a Vite application.

Files upload directly from the browser to Neon using a short-lived signed URL issued only to signed-in administrators. File size and content type are checked before authorization and verified again against storage before registration. Secrets stay on the server. Stored URLs are public and stable; no media bytes pass through Vercel's upload body limit.

## Site controls

In **Site media → Gallery photos**, administrators can upload an image, then **Save photo** to publish it. Existing photos can be selected and removed from the gallery. No captions or descriptions need to be entered. Photos upload to the `media` bucket and save separately from the media switches. The public gallery scrolls horizontally in the original large/tall/stacked-photo pattern, with touch, trackpad, keyboard and arrow controls. Clicking any photo opens the full-size viewer. The nine original photos are seeded once; later migrations preserve edits and removals.

The **Live events** tab lets administrators add, edit, hide and remove listings. Each event has a photo uploaded to the `media` bucket, an event name, a location, and a full date including the year. Events save separately from site-media settings. Visible listings appear in chronological order; an empty list hides the public events section. The initial Sushant KC Live listing is dated **28 March 2027**. The migration seeds it once and preserves subsequent edits or removal.

- **Site media** turns the popup, soundtrack and hero film off together while retaining their individual settings.
- **Announcement popup** accepts a JPG, PNG, WebP or GIF up to 10 MB, a description and optional HTTPS link. It appears once per browser tab for each uploaded image.
- **Looping soundtrack** accepts audio up to 30 MB and a starting volume. Visitors can play/pause it. Browsers that block automatic audio require the visitor to press play.
- **Hero film** accepts an MP4 or WebM up to 100 MB and has its own switch. When off, the poster stays visible.

Uploads are staged. **Save changes** publishes all edits together. Open visitor pages refresh settings every 30 seconds while visible. Removing or replacing media removes it from the website; the old file remains in its Neon bucket. Sessions expire after 12 hours; changing `ADMIN_PASSWORD_HASH` invalidates existing sessions. Login attempts are limited to eight per 15 minutes per IP.

## Validation

`npm run build` checks TypeScript and creates the production bundle. `npm test` exercises the HTTP API against isolated PGlite Postgres, including authentication, CSRF protection, exact upload metadata validation, publication, concurrent-edit conflicts, password rotation and login throttling. Storage tests check Neon bucket mapping and signed request headers without contacting the real storage service.
