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
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('popup','audio','hero','event','gallery')),
 pathname text UNIQUE NOT NULL, owner text NOT NULL, name text NOT NULL,
 url text, content_type text, size integer, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE trn_media DROP CONSTRAINT IF EXISTS trn_media_kind_check;
ALTER TABLE trn_media ADD CONSTRAINT trn_media_kind_check CHECK(kind IN ('popup','audio','hero','event','gallery'));
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
CREATE TABLE IF NOT EXISTS trn_gallery (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), revision integer NOT NULL DEFAULT 0,
 media_id uuid NOT NULL UNIQUE REFERENCES trn_media(id),
 caption text NOT NULL DEFAULT '', alt text NOT NULL,
 position bigint GENERATED ALWAYS AS IDENTITY
);
INSERT INTO trn_media(id,kind,pathname,owner,name,url,content_type,storage_bucket)
 SELECT gen_random_uuid(),'gallery','trn/original/' || file,'gallery-seed',file,
 COALESCE(NULLIF(s.gallery_base_url,''),'/media') || '/' || file,'image/jpeg','media'
 FROM trn_settings s CROSS JOIN (VALUES
 ('IMG_0675.JPG.jpeg'),('IMG_0665.JPEG'),('IMG_0662.JPEG'),('IMG_0661.JPEG'),('IMG_0666.JPEG'),
 ('IMG_0669.JPEG'),('IMG_0673.JPEG'),('IMG_0674.JPG.jpeg'),('IMG_0676.JPG.jpeg')
 ) AS originals(file) WHERE s.id=1 ON CONFLICT DO NOTHING;
INSERT INTO trn_gallery(media_id,caption,alt)
 SELECT m.id,originals.caption,originals.alt FROM (VALUES
 (1,'IMG_0675.JPG.jpeg','The stage is yours.','A performer in a red jacket at the end of a stage surrounded by fans'),
 (2,'IMG_0665.JPEG','Closer to the music.','A singer leans towards the audience at the front of the stage'),
 (3,'IMG_0662.JPEG','Every voice in the room.','The front rows sing along as a performer kneels beside the crowd'),
 (4,'IMG_0661.JPEG','A night turned all the way up.','Flames rise above the stage as a performer faces the crowd'),
 (5,'IMG_0666.JPEG','A moment shared.','Two performers on stage in front of a packed audience'),
 (6,'IMG_0669.JPEG','Under the stage lights.','Performers and a camera operator lit by stage pyrotechnics'),
 (7,'IMG_0673.JPEG','Front-row energy.','The crowd raises their hands beside a plume of stage fire'),
 (8,'IMG_0674.JPG.jpeg','One more song.','A singer holds the microphone while facing a crowd of phone lights'),
 (9,'IMG_0676.JPG.jpeg','The whole crowd, together.','A wide view of the concert stage and audience at night')
 ) AS originals(position,file,caption,alt) JOIN trn_media m ON m.pathname='trn/original/' || originals.file
 WHERE NOT EXISTS(SELECT 1 FROM trn_migrations WHERE name='seed-gallery-photos')
 ORDER BY originals.position ON CONFLICT DO NOTHING;
INSERT INTO trn_migrations(name) VALUES('seed-gallery-photos') ON CONFLICT DO NOTHING;
