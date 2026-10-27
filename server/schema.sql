CREATE TABLE IF NOT EXISTS trn_settings (
 id integer PRIMARY KEY CHECK (id = 1), revision integer NOT NULL DEFAULT 0,
 effects_enabled boolean NOT NULL DEFAULT true, popup_enabled boolean NOT NULL DEFAULT false,
 audio_enabled boolean NOT NULL DEFAULT false, hero_video_enabled boolean NOT NULL DEFAULT true,
 popup_id uuid, audio_id uuid, popup_alt text NOT NULL DEFAULT '', popup_link text NOT NULL DEFAULT '',
 audio_volume real NOT NULL DEFAULT 0.35 CHECK (audio_volume BETWEEN 0 AND 1)
);
INSERT INTO trn_settings(id) VALUES (1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS trn_sessions (
 token text PRIMARY KEY, credential text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS trn_login_limits (
 key text PRIMARY KEY, attempts integer NOT NULL, resets_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS trn_media (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('popup','audio','hero','event')),
 pathname text UNIQUE NOT NULL, owner text NOT NULL, name text NOT NULL,
 url text, content_type text, size integer, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE trn_media DROP CONSTRAINT IF EXISTS trn_media_kind_check;
ALTER TABLE trn_media ADD CONSTRAINT trn_media_kind_check CHECK(kind IN ('popup','audio','hero','event'));
ALTER TABLE trn_media ADD COLUMN IF NOT EXISTS storage_bucket text;
ALTER TABLE trn_settings ADD COLUMN IF NOT EXISTS hero_id uuid;
ALTER TABLE trn_settings ADD COLUMN IF NOT EXISTS gallery_base_url text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS trn_events (
 id uuid PRIMARY KEY, revision integer NOT NULL DEFAULT 0,
 name text NOT NULL, location text NOT NULL, event_date date NOT NULL,
 image_id uuid NOT NULL REFERENCES trn_media(id), published boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS trn_migrations (name text PRIMARY KEY);
INSERT INTO trn_media(id,kind,pathname,owner,name,url,content_type,size,storage_bucket)
 SELECT '00000000-0000-4000-8000-000000000002','event','trn/original/IMG_0674.JPG.jpeg','event-seed','IMG_0674.JPG.jpeg',
 COALESCE(NULLIF(gallery_base_url,''),'/media') || '/IMG_0674.JPG.jpeg','image/jpeg',164477,'media'
 FROM trn_settings WHERE id=1 ON CONFLICT DO NOTHING;
INSERT INTO trn_events(id,name,location,event_date,image_id)
 SELECT '00000000-0000-4000-8000-000000000001','Sushant KC Live','United Kingdom','2027-03-28',id
 FROM trn_media WHERE pathname='trn/original/IMG_0674.JPG.jpeg'
 AND NOT EXISTS(SELECT 1 FROM trn_migrations WHERE name='seed-live-events-2027') ON CONFLICT DO NOTHING;
INSERT INTO trn_migrations(name) VALUES('seed-live-events-2027') ON CONFLICT DO NOTHING;
