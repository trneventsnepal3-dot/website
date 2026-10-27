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
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('popup','audio','hero')),
 pathname text UNIQUE NOT NULL, owner text NOT NULL, name text NOT NULL,
 url text, content_type text, size integer, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE trn_media DROP CONSTRAINT IF EXISTS trn_media_kind_check;
ALTER TABLE trn_media ADD CONSTRAINT trn_media_kind_check CHECK(kind IN ('popup','audio','hero'));
ALTER TABLE trn_media ADD COLUMN IF NOT EXISTS storage_bucket text;
ALTER TABLE trn_settings ADD COLUMN IF NOT EXISTS hero_id uuid;
ALTER TABLE trn_settings ADD COLUMN IF NOT EXISTS gallery_base_url text NOT NULL DEFAULT '';
